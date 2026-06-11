---
name: steward
description: Autonomous agent that buys work from other agents safely — it checks reputation, escrows payment, verifies the delivered result, then releases or disputes. The Phase 2 Agent Arena entry, composed entirely from the Phase 1 Pact Skills.
license: MIT
metadata:
  author: pact
  version: "0.1.0"
  network: eip155:688689
  composes: [pact-reputation, pact-escrow, pact-arbiter]
---

# Steward — trust-minimised agent-to-agent commerce

When one agent pays another to do a job, two things can go wrong: the money can
vanish (pay-first-and-pray), or the work can be junk. **Steward** is an autonomous
buyer that handles both. It is the Phase 2 cascade of the Pact Skills — it does not
introduce new on-chain machinery, it *composes* the three Phase 1 Skills into an
agent that can transact on Pharos without trusting its counterparties.

## The loop

For each task, Steward runs:

1. **Discover** candidate providers (here a static registry; in production an
   [Anvita Flow](https://flow.anvita.xyz) agent lookup).
2. **Choose** — [`pact-reputation`](../../skills/pact-reputation/SKILL.md): give an
   untried provider one bootstrap job, otherwise route to the highest on-chain score.
3. **Pay on delivery** — [`pact-escrow`](../../skills/pact-escrow/SKILL.md): one
   signed EIP-3009 authorization funds an escrow (no gas, no tx from the Steward);
   the provider delivers and the result comes back with a `dealId`.
4. **Verify** — [`verify.ts`](verify.ts): a deterministic policy gate (the body must
   match the on-chain `resultHash`, the symbol must match, the value must be
   plausible) and, if `ANTHROPIC_API_KEY` is set, **Claude** (`claude-opus-4-8`)
   makes the final accept/dispute call on results that pass the hard checks.
5. **Settle** —
   - accept → `release`: the provider is paid, `completed`/`volume` rise.
   - reject → `dispute` then [`pact-arbiter`](../../skills/pact-arbiter/SKILL.md): a
     juror rules in line with the verifier's finding; the provider is marked
     `faulted` and the Steward is refunded.

Every outcome writes reputation, which feeds step 2 of the *next* task. That is the
flywheel: deliver well and you win the next job; deliver junk once and you're
routed out.

## Run it

```bash
npm run steward        # boots a facilitator + an honest and a shoddy provider, then
                       # turns the Steward loose on a stream of tasks
```

Deterministic by default (the policy verifier needs no key). Add a key to let Claude
judge result quality:

```bash
ANTHROPIC_API_KEY=sk-ant-...  npm run steward
# STEWARD_MODEL overrides the model (default claude-opus-4-8)
```

## Why this is the right Phase 2

- It is built **only** from Phase 1 Skills — the cascade the hackathon is designed around.
- It is genuinely autonomous: discovery → selection → payment → verification → settlement, no human in the loop.
- It closes the economic loop Pharos is building: agents paying agents, with trust
  earned on-chain rather than assumed — and it is x402-native, so it slots into the
  same payment rail (`escrow` scheme) the rest of the ecosystem speaks.

## Files

- [`steward.ts`](steward.ts) — the agent: `chooseProvider` (reputation routing) + `runTask` (the full loop).
- [`verify.ts`](verify.ts) — the decision brain: `policyCheck` (deterministic) + `llmJudge` (Claude) → `verifyDelivery`.
- [`registry.ts`](registry.ts) — provider discovery type (Anvita Flow stand-in).
- [`demo.ts`](demo.ts) — the marketplace: two competing providers and the flywheel, end to end.
