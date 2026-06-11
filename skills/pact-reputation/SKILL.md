---
name: pact-reputation
description: On-chain reputation for agents on Pharos, earned only from settled escrow deals. Use when an agent needs to decide whether to trust a counterparty before paying it — query a provider's score and track record, or read your own. Pairs with pact-escrow.
license: MIT
metadata:
  author: pact
  version: "0.1.0"
  network: eip155:688689
---

# Pact — agent reputation

A score that **cannot be faked, bought, or self-attested**. `PactReputation` is
writable only by the `PactEscrow` contract, so every data point is the byproduct of
a real, funded, settled deal:

- `completed` — delivered and released (incl. disputes won as provider)
- `noShows` — funded but never delivered (refunded to the payer)
- `faulted` — disputes an arbiter resolved mostly against the provider
- `volume` — total USDC actually settled to the provider
- payer-side: `paid`, and `frivolous` (disputes the payer raised and lost)

`score(agent)` returns 0–10000 basis points; one failure is weighted ~2x a success,
and `0` means "no history yet."

## When to use

Call this **before** opening an escrow deal (or before any payment) to size up a
counterparty, and **after** to confirm an outcome was recorded. It is the cheap
read that makes [pact-escrow](../pact-escrow/SKILL.md) decisions smarter.

## Usage

```ts
import {checkReputation} from "./check";

const rep = await checkReputation(providerAddress);
// { score: 9200, completed: 23, noShows: 0, faulted: 1, volumeUsdc: 412.5, recommendation: "trust" }

if (rep.recommendation === "avoid") {
  // pick a different provider, or lower the escrow amount and shorten deliverBy
}
```

CLI:

```bash
tsx skills/pact-reputation/check.ts 0xProviderAddress
```

## Recommendation thresholds (tune per risk appetite)

| recommendation | meaning |
|---|---|
| `trust` | score ≥ 8000 with history |
| `caution` | 5000–7999 — consider smaller amounts / shorter windows |
| `avoid` | < 5000 — high failure rate |
| `unknown` | no settled deals yet — use a small first deal to bootstrap trust |

## Notes

- Reputation is **per-address**; a Sybil can only raise its score by actually completing paid deals, which costs real settlements.
- Because writes are escrow-gated, integrating this skill requires no trust in the reporter — only in the escrow contract.
