---
name: pact-arbiter
description: Dispute resolution for Pact escrow deals on Pharos. Use when a payer wants to challenge a delivery (open a dispute) or when a juror needs to rule on one by splitting the escrowed funds. The ruling feeds back into pact-reputation.
license: MIT
metadata:
  author: pact
  version: "0.1.0"
  network: eip155:688689
---

# Pact — arbitration

When a payer disputes a delivery within the review window, the escrowed funds are
frozen until a ruling. `PactArbiter` lets a whitelisted juror split the funds by
setting the payer's share in basis points, with an on-chain reason. The escrow only
ever knows a single `arbiter` address, so this contract can later be swapped for a
staked or multi-juror panel without migrating escrows.

## As a payer — open a dispute

Only the payer can dispute, and only during the review window (after delivery,
before auto-release):

```ts
import {dispute} from "../../src/lib/contracts";
await dispute(PAYER_PRIVATE_KEY, ESCROW, dealId);
```

Dispute only with cause (wrong, empty, or late result). If the arbiter rules
against you, it is recorded as a `frivolous` mark on your payer reputation.

## As a juror — rule on a dispute

```ts
import {rule} from "../../src/lib/contracts";
// payerBps: 0 = provider fully wins, 10000 = payer fully refunded, 5000 = split.
await rule(JUROR_PRIVATE_KEY, ARBITER, dealId, 7000, "delivered hash did not match the requested symbol");
```

Effects of a ruling:
- Funds split: `payerBps` to the payer, the remainder (minus protocol fee) to the provider.
- Reputation: `payerBps ≥ 5000` marks the provider `faulted`; `< 5000` counts as a completed delivery for the provider and a `frivolous` dispute for the payer.

## Safety valve — no permanent locks

If no juror rules before `resolveBy` (`arbiterWindow`, default 3 days), anyone may
call `resolveTimeout(dealId)` for a neutral 50/50 split, so disputed funds can never
be trapped:

```ts
import {publicClient} from "../../src/lib/env";
// after resolveBy:  escrow.resolveTimeout(dealId)
```

## Composes with

- [pact-escrow](../pact-escrow/SKILL.md) — the deals being disputed.
- [pact-reputation](../pact-reputation/SKILL.md) — where rulings land.
