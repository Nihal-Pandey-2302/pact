// Gateway — a thin HTTP/SSE API over the proven Pact backend, for the web UI.
//
//   npm run gateway
//
// On startup it boots the facilitator and two providers (honest "Acme",
// shoddy "Sketchy"), then serves a small API the Next.js app calls:
//   GET  /api/config           — addresses, providers, buyer
//   GET  /api/state            — live reputations, balances, deals
//   POST /api/buy              — pay an escrow-protected endpoint (returns dealId + a verdict)
//   POST /api/settle           — release or dispute a deal
//   GET  /api/steward/stream   — SSE: run the Steward over a task stream, stream outcomes
//
// All heavy logic is reused from the same modules the CLI demos use — the UI is
// pure presentation over a backend that's already verified end to end.

import "../lib/loadEnv";
import express from "express";
import {spawn, type ChildProcess} from "node:child_process";
import {privateKeyToAccount} from "viem/accounts";
import {parseSignature, type Address, type Hex} from "viem";
import {IS_PRODUCTION} from "../lib/loadEnv";
import {pk, requireAddress, publicClient, RPC} from "../lib/env";
import {pactEscrowAbi} from "../lib/abi";
import {authNonce, RECEIVE_TYPES_FIELDS, EIP712_DOMAIN_FIELDS} from "../lib/signing";
import {balanceOf, mint, getScore, getRecord, getDeal, release, dispute, rule, STATE} from "../lib/contracts";
import {
  encodePaymentPayload,
  decodePaymentResult,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  X402_VERSION,
  type PaymentPayload,
  type EscrowPayload,
  type PaymentRequirements,
} from "../lib/x402";
import {payAndFetch} from "../../skills/pact-escrow/client";
import {Steward} from "../../agent/steward/steward";
import {verifyDelivery, type Task} from "../../agent/steward/verify";

const PORT = Number(process.env.GATEWAY_PORT ?? 4040);
const FAC_PORT = 4030;

const escrow = requireAddress("escrow");
const reputation = requireAddress("reputation");
const arbiter = requireAddress("arbiter");
const usdc = requireAddress("usdc");

const ACME_PK = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as Hex; // acct 6
const SKETCHY_PK = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as Hex; // acct 7
const acme = {name: "Acme", url: "http://localhost:4031/price", address: privateKeyToAccount(ACME_PK).address};
const sketchy = {name: "Sketchy", url: "http://localhost:4032/price", address: privateKeyToAccount(SKETCHY_PK).address};
const providers = [acme, sketchy];
const byName = (n: string) => providers.find((p) => p.name.toLowerCase() === n.toLowerCase());
const nameOf = (addr: string) => providers.find((p) => p.address.toLowerCase() === addr.toLowerCase())?.name ?? "—";

const payerPk = pk("PAYER_PRIVATE_KEY");
const jurorPk = pk("DEPLOYER_PRIVATE_KEY");
const buyer = privateKeyToAccount(payerPk).address;
const steward = new Steward({payerPk, jurorPk, escrow, reputation, arbiter});

const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);

// --- boot backend services --------------------------------------------------
const kids: ChildProcess[] = [];
function boot(file: string, env: Record<string, string>) {
  kids.push(spawn("node_modules/.bin/tsx", [file], {env: {...process.env, ...env}, stdio: ["ignore", "ignore", "inherit"]}));
}
function bootServices() {
  boot("src/facilitator/server.ts", {FACILITATOR_PORT: String(FAC_PORT)});
  boot("skills/pact-escrow/server.ts", {PROVIDER_PORT: "4031", PROVIDER_PRIVATE_KEY: ACME_PK, PROVIDER_BEHAVIOR: "honest", PROVIDER_NAME: "Acme", FACILITATOR_URL: `http://localhost:${FAC_PORT}`});
  boot("skills/pact-escrow/server.ts", {PROVIDER_PORT: "4032", PROVIDER_PRIVATE_KEY: SKETCHY_PK, PROVIDER_BEHAVIOR: "shoddy", PROVIDER_NAME: "Sketchy", FACILITATOR_URL: `http://localhost:${FAC_PORT}`});
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error(`service not up: ${url}`);
}

// --- chain reads ------------------------------------------------------------
async function providerState() {
  return Promise.all(providers.map(async (p) => {
    const rec = (await getRecord(reputation, p.address)) as {completed: bigint; noShows: bigint; faulted: bigint; volume: bigint};
    return {
      name: p.name, address: p.address, url: p.url,
      score: await getScore(reputation, p.address),
      completed: Number(rec.completed), faulted: Number(rec.faulted), noShows: Number(rec.noShows),
      volume: fmt(rec.volume),
    };
  }));
}
const DEALS_WINDOW = 25; // the UI only shows a handful; bound the per-poll RPC fan-out
async function dealsState() {
  const last = Number(await publicClient.readContract({address: escrow, abi: pactEscrowAbi, functionName: "lastDealId"}));
  const from = Math.max(1, last - DEALS_WINDOW + 1);
  const ids = Array.from({length: Math.max(0, last - from + 1)}, (_, i) => BigInt(from + i));
  const deals = await Promise.all(ids.map(async (id) => {
    const d = await getDeal(escrow, id);
    return {id: id.toString(), state: STATE[d.state], provider: nameOf(d.provider), amount: fmt(d.amount)};
  }));
  return deals.reverse(); // newest first
}
async function fullState() {
  const [provs, deals, bal] = await Promise.all([providerState(), dealsState(), balanceOf(usdc, buyer)]);
  return {buyer: {address: buyer, usdc: fmt(bal)}, providers: provs, deals};
}

// --- HTTP -------------------------------------------------------------------
// This server signs with funded payer + juror keys, so CORS is an explicit origin
// allowlist (not `*`) and it binds to loopback only (see app.listen). For a remote
// demo, set GATEWAY_ALLOWED_ORIGINS to the UI origin.
const ALLOWED_ORIGINS = (process.env.GATEWAY_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const allowOrigin = (origin?: string): string | null => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : null);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const o = allowOrigin(req.headers.origin);
  if (o) res.header("Access-Control-Allow-Origin", o);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/api/health", (_req, res) => res.json({ok: true}));

app.get("/api/config", (_req, res) =>
  res.json({
    chainId: 688689, escrow, usdc, arbiter, reputation, buyer,
    env: IS_PRODUCTION ? "production" : "local",
    rpc: RPC,
    providers: providers.map((p) => ({name: p.name, address: p.address})),
    verifier: process.env.ANTHROPIC_API_KEY ? `Claude (${process.env.STEWARD_MODEL ?? "claude-opus-4-8"})` : "deterministic policy",
  }),
);

app.get("/api/state", async (_req, res) => {
  try { res.json(await fullState()); }
  catch (e) { res.status(500).json({error: (e as Error).message}); }
});

// Pay an escrow-protected endpoint. Funds land in escrow; we return a verdict
// (policy + optional Claude) but do NOT release/dispute — that's the user's call.
app.post("/api/buy", async (req, res) => {
  try {
    const {provider, symbol} = req.body as {provider: string; symbol: string};
    const p = byName(provider);
    if (!p) return res.status(400).json({error: "unknown provider"});
    const sym = (symbol || "BTC").toUpperCase();

    if ((await balanceOf(usdc, buyer)) < 5_000_000n) await mint(payerPk, usdc, buyer, 100_000_000n);

    const paid = await payAndFetch(`${p.url}?symbol=${sym}`, payerPk);
    const dealId = paid.payment?.dealId;
    if (paid.status !== 200 || !dealId) {
      return res.json({ok: false, provider: p.name, detail: `no deal opened (HTTP ${paid.status})`, body: paid.body});
    }
    const body = paid.body as {result?: unknown; escrow?: {resultHash?: string}};
    const deal = await getDeal(escrow, BigInt(dealId));
    const task: Task = {symbol: sym, description: `get the current USD price of ${sym}`};
    const verdict = STATE[deal.state] === "Delivered" ? await verifyDelivery(task, body.result, body.escrow?.resultHash) : null;

    res.json({ok: true, provider: p.name, dealId, dealState: STATE[deal.state], result: body.result ?? null, verdict});
  } catch (e) { res.status(500).json({error: (e as Error).message}); }
});

// --- Wallet (MetaMask) path -------------------------------------------------
// The browser holds the key; the gateway never signs for it. prepare() builds the
// exact EIP-712 ReceiveWithAuthorization the escrow expects (deal-bound nonce and
// all), the wallet signs it, submit() relays the resulting X-PAYMENT to the
// provider (which settles via the facilitator). release/dispute are sent straight
// from the wallet; only the arbiter ruling stays server-side (separate authority).

// Typed-data field shapes are imported from signing.ts (single source of truth) so
// the wallet signs exactly what the facilitator and contract verify.
const RECEIVE_TYPES = RECEIVE_TYPES_FIELDS;
const EIP712_DOMAIN = EIP712_DOMAIN_FIELDS;

// 1) Fetch the provider's 402 challenge and return the typed data for the wallet to sign.
app.post("/api/buy/prepare", async (req, res) => {
  try {
    const {provider, symbol, payer} = req.body as {provider: string; symbol: string; payer: Address};
    const p = byName(provider);
    if (!p) return res.status(400).json({error: "unknown provider"});
    const sym = (symbol || "BTC").toUpperCase();

    const challenge = await fetch(`${p.url}?symbol=${sym}`);
    const required = (await challenge.json()) as {accepts: PaymentRequirements[]};
    const requirements = required.accepts[0];
    if (!requirements) return res.status(502).json({error: "provider returned no requirements"});
    const extra = requirements.extra as {escrow: Address; requestHash: Hex; deliverBy: number; reviewWindow: number; usdcName: string};

    const nonce = authNonce(688689, extra.escrow, {
      payer, provider: requirements.payTo as Address, token: requirements.asset as Address,
      amount: BigInt(requirements.maxAmountRequired), requestHash: extra.requestHash,
      deliverBy: BigInt(extra.deliverBy), reviewWindow: extra.reviewWindow,
    });
    const validAfter = "0";
    const validBefore = String(Math.floor(Date.now() / 1000) + 3600);

    const typedData = {
      types: {EIP712Domain: EIP712_DOMAIN, ReceiveWithAuthorization: RECEIVE_TYPES},
      primaryType: "ReceiveWithAuthorization",
      domain: {name: extra.usdcName, version: "1", chainId: 688689, verifyingContract: requirements.asset},
      message: {from: payer, to: extra.escrow, value: requirements.maxAmountRequired, validAfter, validBefore, nonce},
    };
    res.json({typedData, requirements, validAfter, validBefore, symbol: sym});
  } catch (e) { res.status(500).json({error: (e as Error).message}); }
});

// 2) Relay the wallet-signed authorization: assemble X-PAYMENT, call the provider, return the deal.
app.post("/api/buy/submit", async (req, res) => {
  try {
    const {provider, symbol, requirements, validAfter, validBefore, signature, payer} = req.body as {
      provider: string; symbol: string; requirements: PaymentRequirements;
      validAfter: string; validBefore: string; signature: Hex; payer: Address;
    };
    const p = byName(provider);
    if (!p) return res.status(400).json({error: "unknown provider"});
    const sym = (symbol || "BTC").toUpperCase();
    const extra = requirements.extra as {requestHash: Hex; deliverBy: number; reviewWindow: number};

    const sig = parseSignature(signature);
    const v = 27 + (sig.yParity ?? 0);
    const escrowPayload: EscrowPayload = {
      payer, amount: requirements.maxAmountRequired, requestHash: extra.requestHash,
      deliverBy: extra.deliverBy, reviewWindow: extra.reviewWindow,
      authorization: {validAfter, validBefore, v, r: sig.r, s: sig.s},
    };
    const payload: PaymentPayload = {x402Version: X402_VERSION, scheme: "escrow", network: requirements.network, payload: escrowPayload};

    const paid = await fetch(`${p.url}?symbol=${sym}`, {headers: {[PAYMENT_HEADER]: encodePaymentPayload(payload)}});
    const body = (await paid.json()) as {result?: unknown; escrow?: {resultHash?: string}};
    const respHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
    const dealId = respHeader ? decodePaymentResult(respHeader).dealId : undefined;
    if (paid.status !== 200 || !dealId) return res.json({ok: false, provider: p.name, detail: `settle failed (HTTP ${paid.status})`, body});

    const deal = await getDeal(escrow, BigInt(dealId));
    const task: Task = {symbol: sym, description: `get the current USD price of ${sym}`};
    const verdict = STATE[deal.state] === "Delivered" ? await verifyDelivery(task, body.result, body.escrow?.resultHash) : null;
    res.json({ok: true, provider: p.name, dealId, dealState: STATE[deal.state], result: body.result ?? null, verdict});
  } catch (e) { res.status(500).json({error: (e as Error).message}); }
});

// Arbiter ruling — the juror is a separate authority, so this stays server-side even
// when the payer disputes from their own wallet.
app.post("/api/rule", async (req, res) => {
  try {
    const {dealId, payerBps} = req.body as {dealId: string; payerBps?: number};
    // Only rule on a deal that is actually disputed — don't let a caller drive the
    // juror key against an arbitrary deal.
    const pre = await getDeal(escrow, BigInt(dealId));
    if (STATE[pre.state] !== "Disputed") {
      return res.status(400).json({error: `deal #${dealId} is not disputed (state=${STATE[pre.state]})`});
    }
    await rule(jurorPk, arbiter, BigInt(dealId), payerBps ?? 9_000, "buyer disputed via Pact UI");
    const d = await getDeal(escrow, BigInt(dealId));
    res.json({ok: true, dealId, state: STATE[d.state]});
  } catch (e) { res.status(500).json({error: (e as Error).message}); }
});

app.post("/api/settle", async (req, res) => {
  try {
    const {dealId, action} = req.body as {dealId: string; action: "release" | "dispute"};
    if (action === "release") {
      await release(payerPk, escrow, BigInt(dealId));
    } else {
      await dispute(payerPk, escrow, BigInt(dealId));
      await rule(jurorPk, arbiter, BigInt(dealId), 9_000, "buyer disputed via Pact UI");
    }
    const d = await getDeal(escrow, BigInt(dealId));
    res.json({ok: true, dealId, state: STATE[d.state]});
  } catch (e) { res.status(500).json({error: (e as Error).message}); }
});

// SSE: run the Steward over a stream of tasks, emitting one event per task.
app.get("/api/steward/stream", async (req, res) => {
  const o = allowOrigin(req.headers.origin);
  res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...(o ? {"Access-Control-Allow-Origin": o} : {})});
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const rounds = Math.min(8, Math.max(1, Number(req.query.rounds ?? 6)));
    const symbols = ["BTC", "ETH", "PHRS", "BTC", "ETH", "BTC", "ETH", "PHRS"];
    if ((await balanceOf(usdc, buyer)) < 5_000_000n) await mint(payerPk, usdc, buyer, 100_000_000n);

    send("state", await fullState());
    for (let i = 0; i < rounds; i++) {
      const sym = symbols[i] ?? "BTC";
      const task: Task = {symbol: sym, description: `get the current USD price of ${sym}`};
      const outcome = await steward.runTask(task, providers);
      send("task", {round: i + 1, outcome, state: await fullState()});
    }
    send("done", {});
  } catch (e) { send("error", {message: (e as Error).message}); }
  res.end();
});

let stopped = false;
function shutdown() {
  if (stopped) return;
  stopped = true;
  for (const k of kids) k.kill("SIGTERM"); // best-effort: take the child services down with us
}
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
process.on("exit", shutdown);
process.on("uncaughtException", (e) => { console.error(e); shutdown(); process.exit(1); });

async function main() {
  console.log("gateway: booting facilitator + providers…");
  bootServices();
  await Promise.all([
    waitFor(`http://localhost:${FAC_PORT}/supported`),
    waitFor("http://localhost:4031/"),
    waitFor("http://localhost:4032/"),
  ]);
  // loopback-only: never expose the funded-key endpoints to the network.
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`Pact gateway on http://localhost:${PORT}  [${IS_PRODUCTION ? "PRODUCTION" : "local"} · ${RPC}]`);
    console.log(`  buyer ${buyer}`);
    console.log(`  providers: Acme(honest) ${acme.address}  Sketchy(shoddy) ${sketchy.address}`);
  });
  server.on("error", (e) => {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`port ${PORT} is in use — a previous gateway/provider may be orphaned. Free it (e.g. fuser -k ${PORT}/tcp 4030/tcp 4031/tcp 4032/tcp) and retry.`);
    } else console.error(e);
    shutdown();
    process.exit(1);
  });
}
main().catch((e) => { console.error(e); shutdown(); process.exit(1); });
