// Steward — the Phase 2 Agent Arena entry. An autonomous agent that buys work from
// other agents *safely*, by composing the three Pact Skills:
//
//   pact-reputation → which provider do I trust for this task?
//   pact-escrow     → pay on delivery (funds locked, not sent), get the result
//   verify          → did the result actually satisfy the task? (policy + Claude)
//   pact-escrow     → release (pay) on success, or
//   pact-arbiter    → dispute on failure → a juror rules → reputation updates
//
// Run it over many tasks and a flywheel emerges: providers that deliver earn
// reputation and win the next job; providers that don't get disputed and starved.

import {type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {payAndFetch} from "../../skills/pact-escrow/client";
import {release, dispute, refundExpired, rule, getScore, getRecord, getDeal, STATE} from "../../src/lib/contracts";
import {type Provider} from "./registry";
import {verifyDelivery, type Task, type Verdict} from "./verify";

export interface StewardConfig {
  payerPk: Hex; // the Steward's own wallet — pays for work
  jurorPk: Hex; // authorised juror that rules on the Steward's disputes
  escrow: Address;
  reputation: Address;
  arbiter: Address;
}

export interface Outcome {
  task: Task;
  provider: string;
  reason: string; // why this provider was chosen
  dealId?: string;
  verdict?: Verdict;
  action: "released" | "disputed" | "refunded" | "failed";
  detail: string;
}

const log = (m: string) => console.log(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Steward {
  constructor(private cfg: StewardConfig) {}

  /** Reputation-driven routing: bootstrap any untried provider once, then exploit
   *  the highest-scoring one. This is what makes good behaviour compound. */
  async chooseProvider(providers: Provider[]): Promise<{choice: Provider; reason: string}> {
    const stats = await Promise.all(
      providers.map(async (p) => {
        const rec = await getRecord(this.cfg.reputation, p.address);
        const r = rec as {completed: bigint; noShows: bigint; faulted: bigint};
        const deals = Number(r.completed + r.noShows + r.faulted);
        const score = await getScore(this.cfg.reputation, p.address);
        return {p, deals, score};
      }),
    );

    const untried = stats.filter((s) => s.deals === 0);
    if (untried.length > 0) {
      const pick = untried[0]!;
      return {choice: pick.p, reason: `bootstrapping ${pick.p.name} — no track record yet, give it one job`};
    }
    stats.sort((a, b) => b.score - a.score);
    const best = stats[0]!;
    return {
      choice: best.p,
      reason: `routing to ${best.p.name} — highest reputation (score ${best.score}/10000 over ${best.deals} deals)`,
    };
  }

  /** Run one task end-to-end: choose → pay into escrow → verify → release/dispute. */
  async runTask(task: Task, providers: Provider[]): Promise<Outcome> {
    const {choice, reason} = await this.chooseProvider(providers);
    log(`\n• task: ${task.description}`);
    log(`  ${reason}`);

    let paid;
    try {
      paid = await payAndFetch(`${choice.url}?symbol=${task.symbol}`, this.cfg.payerPk);
    } catch (e) {
      return {task, provider: choice.name, reason, action: "failed", detail: `request error: ${(e as Error).message}`};
    }

    const dealId = paid.payment?.dealId;
    if (paid.status !== 200 || !dealId) {
      return {task, provider: choice.name, reason, action: "failed", detail: `no deal opened (HTTP ${paid.status})`};
    }
    log(`  paid → deal #${dealId} funded into escrow (gasless), ${choice.name} responded`);

    const body = paid.body as {result?: unknown; escrow?: {resultHash?: string}};
    const deal = await getDeal(this.cfg.escrow, BigInt(dealId));

    // Provider settled but never delivered. refundExpired is permissionless but only
    // valid past deliverBy — reclaim now if the deadline has elapsed (which also
    // records the no-show against the provider's reputation), otherwise report the
    // truth: funds are recoverable but not yet, do NOT claim a refund that didn't happen.
    if (STATE[deal.state] !== "Delivered") {
      // Provider settled but never delivered. refundExpired is permissionless but only
      // valid past deliverBy — wait out a short deadline, then reclaim. The reclaim
      // records the no-show against the provider (so it's penalised and routed out,
      // not re-tried forever as "untried"). Don't block on far-future deadlines.
      const waitMs = (Number(deal.deliverBy) - Math.floor(Date.now() / 1000) + 2) * 1000;
      if (waitMs > 0 && waitMs <= 30_000) {
        log(`  ${choice.name} didn't deliver — waiting ${Math.ceil(waitMs / 1000)}s for the deadline, then reclaiming…`);
        await sleep(waitMs);
      }
      if (Math.floor(Date.now() / 1000) > Number(deal.deliverBy)) {
        await refundExpired(this.cfg.payerPk, this.cfg.escrow, BigInt(dealId));
        log(`  ${choice.name} no-show → refundExpired: payer refunded, provider penalised`);
        return {task, provider: choice.name, reason, dealId, action: "refunded", detail: "no delivery; refunded after the deadline"};
      }
      log(`  ${choice.name} took the escrow but did not deliver — refundable after deliverBy (${deal.deliverBy})`);
      return {task, provider: choice.name, reason, dealId, action: "failed", detail: `no delivery; reclaim after ${deal.deliverBy}`};
    }

    const verdict = await verifyDelivery(task, body.result, body.escrow?.resultHash);
    log(`  verified by ${verdict.by}: ${verdict.accept ? "ACCEPT" : "DISPUTE"} — ${verdict.reason}`);

    if (verdict.accept) {
      await release(this.cfg.payerPk, this.cfg.escrow, BigInt(dealId));
      log(`  released deal #${dealId} → ${choice.name} paid`);
      return {task, provider: choice.name, reason, dealId, verdict, action: "released", detail: verdict.reason};
    }

    // Dispute, then the authorised juror rules in line with the verifier's finding.
    await dispute(this.cfg.payerPk, this.cfg.escrow, BigInt(dealId));
    await rule(this.cfg.jurorPk, this.cfg.arbiter, BigInt(dealId), 9_000, `steward verifier: ${verdict.reason}`);
    log(`  disputed deal #${dealId} → juror refunded 90% to the Steward; ${choice.name} marked at fault`);
    return {task, provider: choice.name, reason, dealId, verdict, action: "disputed", detail: verdict.reason};
  }

  /** Reclaim a deal whose provider never delivered (callable after the deadline). */
  async reclaim(dealId: string): Promise<void> {
    await refundExpired(this.cfg.payerPk, this.cfg.escrow, BigInt(dealId));
  }

  address(): Address {
    return privateKeyToAccount(this.cfg.payerPk).address;
  }
}
