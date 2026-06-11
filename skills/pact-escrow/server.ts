// Reference provider server for the x402 `escrow` scheme.
//
// A normal x402 server returns 402 -> client pays (exact, irreversible) -> server
// serves. Here the server returns an *escrow* challenge: the client's payment funds
// an on-chain escrow, the server does the work and records delivery, and the payer
// keeps the right to release or dispute. Same HTTP ergonomics as x402, with trust.

import express from "express";
import {type Hex} from "viem";
import {pk, requireAddress, wallet, FACILITATOR_URL, PROVIDER_PORT} from "../../src/lib/env";
import {pharosAtlantic} from "../../src/lib/chains";
import {buildEscrowRequirements} from "../../src/lib/escrowScheme";
import {usdcName, deliver} from "../../src/lib/contracts";
import {hashString, hashResult} from "../../src/lib/signing";
import {
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  decodePaymentPayload,
  encodePaymentResult,
  type EscrowPayload,
  type PaymentRequiredBody,
} from "../../src/lib/x402";

const PRICE = BigInt(process.env.PRICE_UNITS ?? 100_000); // 0.10 USDC (6 decimals)
const DELIVER_SECONDS = Number(process.env.DELIVER_SECONDS ?? 600);
const REVIEW_SECONDS = Number(process.env.REVIEW_SECONDS ?? 120);

// Behaviour lets us stand up a marketplace of providers for the Steward agent:
//   honest  — deliver a correct result (the default)
//   shoddy  — settle + deliver, but the result is wrong (a verifier should dispute)
//   lazy    — settle (take the escrow) but never deliver (a no-show → refundExpired)
const BEHAVIOR = (process.env.PROVIDER_BEHAVIOR ?? "honest") as "honest" | "shoddy" | "lazy";
const PROVIDER_NAME = process.env.PROVIDER_NAME ?? "provider";

const escrow = requireAddress("escrow");
const usdc = requireAddress("usdc");
const providerPk = pk("PROVIDER_PRIVATE_KEY");
const provider = wallet(providerPk).account.address;

async function facVerify(paymentPayload: unknown, paymentRequirements: unknown) {
  const r = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({paymentPayload, paymentRequirements}),
  });
  return (await r.json()) as {isValid: boolean; invalidReason?: string};
}

async function facSettle(paymentPayload: unknown, paymentRequirements: unknown) {
  const r = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({paymentPayload, paymentRequirements}),
  });
  return (await r.json()) as {success: boolean; dealId?: string; txHash?: string; error?: string};
}

// The actual paid work. Replace with any real capability (LLM call, data, compute).
// A `shoddy` provider returns a deliberately wrong result, so a Steward agent's
// verifier has something concrete to catch and dispute.
function doWork(symbol: string) {
  const base: Record<string, number> = {BTC: 64000, ETH: 3400, PHRS: 0.42};
  if (BEHAVIOR === "shoddy") {
    return {symbol, price: 0, currency: "USD", at: new Date().toISOString(), note: "n/a"};
  }
  return {symbol, price: base[symbol] ?? 1, currency: "USD", at: new Date().toISOString()};
}

const app = express();
// Set from the chain in start(); never serve with a guessed name (a wrong EIP-712
// domain name silently breaks every signature). Empty until start() populates it.
let USDC_NAME = "";

// Challenges this provider actually issued: requestHash -> the exact deal terms it
// offered. The paid request must present a known requestHash with matching terms, so
// a payer can't open a deal on terms (deliverBy / reviewWindow) we never offered.
interface IssuedTerms {
  deliverBy: number;
  reviewWindow: number;
  at: number;
}
const issued = new Map<string, IssuedTerms>();
const ISSUE_TTL_MS = 10 * 60_000;
function pruneIssued() {
  const now = Date.now();
  for (const [k, v] of issued) if (now - v.at > ISSUE_TTL_MS) issued.delete(k);
}

function challenge(resource: string, symbol: string): PaymentRequiredBody {
  pruneIssued();
  const requestHash = hashString(`GET ${resource} @${Date.now()}-${Math.random()}`);
  const deliverBy = Math.floor(Date.now() / 1000) + DELIVER_SECONDS;
  issued.set(requestHash, {deliverBy, reviewWindow: REVIEW_SECONDS, at: Date.now()});
  const requirements = buildEscrowRequirements({
    chainId: pharosAtlantic.id,
    escrow,
    usdc,
    usdcName: USDC_NAME,
    provider,
    amount: PRICE,
    resource,
    requestHash,
    deliverBy,
    reviewWindow: REVIEW_SECONDS,
    description: `Price feed for ${symbol}`,
  });
  return {x402Version: 1, accepts: [requirements], error: "payment required"};
}

app.get("/price", async (req, res) => {
  const symbol = String(req.query.symbol ?? "BTC").toUpperCase();
  const resource = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const header = req.header(PAYMENT_HEADER);

  if (!header) return res.status(402).json(challenge(resource, symbol));

  let payload;
  try {
    payload = decodePaymentPayload(header);
  } catch {
    return res.status(400).json({error: "malformed X-PAYMENT header"});
  }
  const p = payload.payload as EscrowPayload;

  // The requestHash must be one we issued, and the echoed terms must match what we
  // offered for it — otherwise the payer is dictating deal terms we never agreed to.
  const terms = issued.get(p.requestHash);
  if (!terms) {
    return res.status(402).json({...challenge(resource, symbol), error: "unknown or expired challenge — request a fresh 402"});
  }
  if (Number(p.deliverBy) !== terms.deliverBy || Number(p.reviewWindow) !== terms.reviewWindow) {
    return res.status(402).json({error: "deal terms do not match the issued challenge"});
  }
  issued.delete(p.requestHash); // one-shot: a challenge funds at most one deal

  // Rebuild the requirements this server offered (its own price + the issued terms).
  const requirements = buildEscrowRequirements({
    chainId: pharosAtlantic.id,
    escrow,
    usdc,
    usdcName: USDC_NAME,
    provider,
    amount: PRICE,
    resource,
    requestHash: p.requestHash as Hex,
    deliverBy: terms.deliverBy,
    reviewWindow: terms.reviewWindow,
    description: `Price feed for ${symbol}`,
  });

  const verified = await facVerify(payload, requirements);
  if (!verified.isValid) {
    return res.status(402).json({...challenge(resource, symbol), error: verified.invalidReason ?? "invalid payment"});
  }

  const settled = await facSettle(payload, requirements);
  if (!settled.success || !settled.dealId) {
    return res.status(402).json({error: settled.error ?? "settlement failed"});
  }

  res.setHeader(
    PAYMENT_RESPONSE_HEADER,
    encodePaymentResult({
      scheme: "escrow",
      network: requirements.network,
      success: true,
      dealId: settled.dealId,
      txHash: settled.txHash as Hex,
    }),
  );

  // A `lazy` provider takes the escrow but never delivers — the funds are now
  // locked until the payer reclaims them after the deadline (refundExpired).
  if (BEHAVIOR === "lazy") {
    return res.json({
      provider: PROVIDER_NAME,
      escrow: {dealId: settled.dealId, note: "accepted; result pending"},
    });
  }

  // Do the work, then record delivery on-chain (starts the review window).
  const result = doWork(symbol);
  const resultHash = hashResult(result); // canonical: order-independent integrity hash
  await deliver(providerPk, escrow, BigInt(settled.dealId), resultHash);

  res.json({
    provider: PROVIDER_NAME,
    result,
    escrow: {
      dealId: settled.dealId,
      resultHash,
      note: "Funds are held in escrow. Release to pay the provider, or dispute within the review window.",
    },
  });
});

app.get("/", (_req, res) => {
  res.json({service: "pact-escrow provider", protected: "/price?symbol=BTC", price: PRICE.toString(), scheme: "escrow"});
});

async function start() {
  // The EIP-712 domain name must be the token's real name or every signature fails
  // to verify. Read it from the chain; refuse to serve if we can't (fail loud).
  try {
    USDC_NAME = await usdcName(usdc);
  } catch (e) {
    console.error(`fatal: cannot read USDC name from ${usdc} — is the RPC up? ${(e as Error).message}`);
    process.exit(1);
  }
  app.listen(PROVIDER_PORT, () => {
    console.log(`pact-escrow provider "${PROVIDER_NAME}" on :${PROVIDER_PORT}  [behavior=${BEHAVIOR}]`);
    console.log(`  GET /price?symbol=BTC  ->  ${Number(PRICE) / 1e6} USDC via the escrow scheme`);
    console.log(`  provider ${provider}`);
  });
}

start();
