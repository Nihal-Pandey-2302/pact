// Phase 2 — the Steward agent in a live marketplace.
//
//   npm run steward
//
// Boots a facilitator and two competing providers — "Acme" (honest) and "Sketchy"
// (delivers garbage) — then turns the Steward loose on a stream of tasks. With no
// prior history the Steward gives each provider one job to bootstrap reputation;
// after that it routes every job to whoever earned the higher score. Acme compounds;
// Sketchy gets disputed and starved. That's the agent economy's trust flywheel,
// running on-chain, end to end.
//
// Deterministic by default (the policy verifier needs no API key). Set
// ANTHROPIC_API_KEY to let Claude (claude-opus-4-8) make the accept/dispute call.

import "../../src/lib/loadEnv";
import {spawn, type ChildProcess} from "node:child_process";
import {privateKeyToAccount} from "viem/accounts";
import {type Hex} from "viem";
import {pk, requireAddress, FACILITATOR_URL} from "../../src/lib/env";
import {balanceOf, mint, getScore, getRecord} from "../../src/lib/contracts";
import {Steward} from "./steward";
import {type Provider} from "./registry";
import {type Task} from "./verify";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FAC_PORT = 4030;
const escrow = requireAddress("escrow");
const reputation = requireAddress("reputation");
const arbiter = requireAddress("arbiter");
const usdc = requireAddress("usdc");

// Dedicated, otherwise-unused anvil accounts so the providers start with clean
// reputation even on a chain that has seen earlier demos. (Public test keys.)
const ACME_PK = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as Hex; // acct 6
const SKETCHY_PK = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as Hex; // acct 7
const LAZY_PK = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as Hex; // acct 8

const acme: Provider = {name: "Acme", url: "http://localhost:4031/price", address: privateKeyToAccount(ACME_PK).address};
const sketchy: Provider = {name: "Sketchy", url: "http://localhost:4032/price", address: privateKeyToAccount(SKETCHY_PK).address};
const lazy: Provider = {name: "Lazy", url: "http://localhost:4033/price", address: privateKeyToAccount(LAZY_PK).address};
const providers = [acme, sketchy, lazy];

const children: ChildProcess[] = [];
function boot(name: string, file: string, extraEnv: Record<string, string>): ChildProcess {
  const child = spawn("node_modules/.bin/tsx", [file], {
    env: {...process.env, ...extraEnv},
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(child);
  return child;
}
function shutdown() {
  for (const c of children) c.kill("SIGTERM");
}

async function waitFor(url: string, label: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

async function repTable(): Promise<string> {
  const rows = await Promise.all(
    providers.map(async (p) => {
      const score = await getScore(reputation, p.address);
      const rec = (await getRecord(reputation, p.address)) as {completed: bigint; faulted: bigint; noShows: bigint};
      return `      ${p.name.padEnd(8)} score=${String(score).padStart(5)}  completed=${rec.completed}  faulted=${rec.faulted}  noShows=${rec.noShows}`;
    }),
  );
  return rows.join("\n");
}

async function main() {
  console.log("=== Steward — autonomous, reputation-routed agent commerce on Pharos ===\n");
  console.log(`provider Acme    ${acme.address}  (honest)`);
  console.log(`provider Sketchy ${sketchy.address}  (delivers garbage)`);

  const payerPk = pk("PAYER_PRIVATE_KEY");
  const jurorPk = pk("DEPLOYER_PRIVATE_KEY");
  const steward = new Steward({payerPk, jurorPk, escrow, reputation, arbiter});
  console.log(`steward  ${steward.address()}  (the buyer)\n`);

  // Make sure the Steward can fund deals.
  if ((await balanceOf(usdc, steward.address())) < 5_000_000n) {
    await mint(payerPk, usdc, steward.address(), 100_000_000n);
  }

  console.log("booting facilitator + 3 providers…");
  boot("facilitator", "src/facilitator/server.ts", {FACILITATOR_PORT: String(FAC_PORT)});
  boot("acme", "skills/pact-escrow/server.ts", {
    PROVIDER_PORT: "4031", PROVIDER_PRIVATE_KEY: ACME_PK, PROVIDER_BEHAVIOR: "honest",
    PROVIDER_NAME: "Acme", FACILITATOR_URL: `http://localhost:${FAC_PORT}`,
  });
  boot("sketchy", "skills/pact-escrow/server.ts", {
    PROVIDER_PORT: "4032", PROVIDER_PRIVATE_KEY: SKETCHY_PK, PROVIDER_BEHAVIOR: "shoddy",
    PROVIDER_NAME: "Sketchy", FACILITATOR_URL: `http://localhost:${FAC_PORT}`,
  });
  boot("lazy", "skills/pact-escrow/server.ts", {
    PROVIDER_PORT: "4033", PROVIDER_PRIVATE_KEY: LAZY_PK, PROVIDER_BEHAVIOR: "lazy",
    PROVIDER_NAME: "Lazy", DELIVER_SECONDS: "8", FACILITATOR_URL: `http://localhost:${FAC_PORT}`,
  });

  await waitFor(`http://localhost:${FAC_PORT}/supported`, "facilitator");
  await waitFor("http://localhost:4031/", "Acme");
  await waitFor("http://localhost:4032/", "Sketchy");
  await waitFor("http://localhost:4033/", "Lazy");
  console.log(`up. verifier: ${process.env.ANTHROPIC_API_KEY ? `Claude (${process.env.STEWARD_MODEL ?? "claude-opus-4-8"})` : "deterministic policy"}\n`);
  void FACILITATOR_URL;

  const symbols = ["BTC", "ETH", "PHRS", "BTC", "ETH", "BTC", "ETH"];
  const tasks: Task[] = symbols.map((s) => ({symbol: s, description: `get the current USD price of ${s}`}));

  const won: Record<string, number> = {};
  console.log("start reputation:\n" + (await repTable()) + "\n");

  for (const task of tasks) {
    const out = await steward.runTask(task, providers);
    if (out.action === "released") won[out.provider] = (won[out.provider] ?? 0) + 1;
    console.log(await repTable());
  }

  console.log("\n── flywheel ──");
  console.log(`  jobs won:  ${providers.map((p) => `${p.name}=${won[p.name] ?? 0}`).join("   ")}`);
  console.log("  The shoddy provider was disputed and the no-show was refunded — both routed out.");
  console.log("  Reputation earned (or lost) on-chain now decides who gets paid next.");

  shutdown();
  await sleep(200);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(1);
});

main().catch((e) => {
  console.error(e);
  shutdown();
  process.exit(1);
});
