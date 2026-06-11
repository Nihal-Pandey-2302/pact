// Agent-facing reputation check: "should I trust this counterparty before paying?"
// Reputation is earned only through settled escrow deals (see PactReputation.sol),
// so it cannot be self-reported or bought.

import {type Address} from "viem";
import {requireAddress} from "../../src/lib/env";
import {getScore, getRecord} from "../../src/lib/contracts";

export interface RepView {
  agent: Address;
  score: number; // 0..10000 basis points (0 = no history)
  completed: number;
  noShows: number;
  faulted: number;
  volumeUsdc: number;
  recommendation: "trust" | "caution" | "avoid" | "unknown";
}

export async function checkReputation(agent: Address): Promise<RepView> {
  const reputation = requireAddress("reputation");
  const [score, rec] = await Promise.all([getScore(reputation, agent), getRecord(reputation, agent)]);
  const r = rec as {
    completed: bigint;
    noShows: bigint;
    faulted: bigint;
    volume: bigint;
    paid: bigint;
    frivolous: bigint;
  };

  const total = Number(r.completed + r.noShows + r.faulted);
  let recommendation: RepView["recommendation"];
  if (total === 0) recommendation = "unknown";
  else if (score >= 8000) recommendation = "trust";
  else if (score >= 5000) recommendation = "caution";
  else recommendation = "avoid";

  return {
    agent,
    score,
    completed: Number(r.completed),
    noShows: Number(r.noShows),
    faulted: Number(r.faulted),
    volumeUsdc: Number(r.volume) / 1e6,
    recommendation,
  };
}

async function main() {
  const agent = process.argv[2] as Address;
  if (!agent) throw new Error("usage: tsx skills/pact-reputation/check.ts <address>");
  console.log(JSON.stringify(await checkReputation(agent), null, 2));
}
if (process.argv[1]?.endsWith("check.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
