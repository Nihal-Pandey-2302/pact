---
name: pact-escrow
description: Conditional settlement (the "escrow" scheme) for x402 agent payments on Pharos. Use when an agent must pay for a task/API but only wants funds to be released after the result is delivered and accepted — pay-on-delivery instead of x402's pay-first-and-pray. Covers both calling an escrow-protected endpoint and offering one.
license: MIT
requires:
  anyBins:
  - node
metadata:
  author: pact
  version: "0.1.0"
  network: eip155:688689
  scheme: escrow
  composesWith: [pact-reputation, pact-arbiter]
  assets: [assets/networks.json, assets/abi/]
  references: [references/escrow-scheme.md]
---

# Pact — the escrow scheme for x402

x402's production scheme, `exact`, is a **push payment: irreversible once executed**.
An agent pays first and hopes the counterparty delivers. Pact adds `escrow`, a
conditional x402 scheme on Pharos: the payer's USDC is locked in an on-chain
escrow, the provider delivers, and funds **release on acceptance** (or auto-release
after a review window), **refund** if the provider no-shows, or **split by an
arbiter** on dispute. Every outcome updates on-chain reputation (see
[pact-reputation](../pact-reputation/SKILL.md)).

It keeps x402's ergonomics exactly: a `402` challenge, an `X-PAYMENT` header, and a
facilitator with `/verify` `/settle` `/supported`. The payer still signs once
(EIP-3009) and sends no transaction — the facilitator relays it. The only thing
that changes is *what the signature funds*: an escrow, not the provider's wallet.

## When to use

- An agent is paying another agent/service for a **task whose result can fail** (data, compute, an LLM/tool call, a delegated job).
- You are **building** a paid endpoint and want callers to trust it before it has a track record.
- You need payments that are **reversible on non-delivery** without a chargeback intermediary.

For trivial, instantly-verifiable, low-value calls, plain x402 `exact` is fine — use `escrow` when delivery risk matters.

## Prerequisites

1. Deployed Pact contracts on Pharos Atlantic (`PACT_ESCROW`, `USDC_ADDRESS`, …) — see the repo's deploy script.
2. A running Pact facilitator (`npm run facilitator`) reachable at `FACILITATOR_URL`.
3. `.env` with the relevant key: `PAYER_PRIVATE_KEY` (caller) or `PROVIDER_PRIVATE_KEY` (provider).

## Role A — call an escrow-protected endpoint (pay-on-delivery)

Use the helper in [`client.ts`](client.ts):

```ts
import {payAndFetch} from "./client";
import {release, dispute} from "../../src/lib/contracts";

// 1. Request → 402 → sign funding authorization → retry with X-PAYMENT → get result.
const out = await payAndFetch("http://provider/price?symbol=BTC", PAYER_PRIVATE_KEY);
const dealId = BigInt(out.payment!.dealId!);   // funds now sit in escrow

// 2. Inspect the result. Decide:
if (resultLooksGood(out.body)) {
  await release(PAYER_PRIVATE_KEY, ESCROW, dealId);   // provider gets paid
} else {
  await dispute(PAYER_PRIVATE_KEY, ESCROW, dealId);   // arbiter will rule (pact-arbiter)
}
// 3. Do nothing → funds auto-release to the provider once the review window elapses.
```

Decision guidance for an autonomous agent: **release** when the result satisfies the
request; **dispute** only with a concrete reason (wrong/empty/late result) — frivolous
disputes you lose are recorded against *your* reputation.

## Role B — offer an escrow-protected endpoint

See [`server.ts`](server.ts). The middleware is:

1. No `X-PAYMENT` header → reply `402` with escrow `PaymentRequirements`
   (`scheme: "escrow"`, plus `extra`: escrow address, `requestHash`, `deliverBy`, `reviewWindow`).
2. With `X-PAYMENT` → `POST /verify` then `POST /settle` to the facilitator (this funds the escrow and returns a `dealId`).
3. Do the work, then `deliver(dealId, keccak256(result))` on-chain to start the review window.
4. Return `200` with the result and an `X-PAYMENT-RESPONSE` header containing the `dealId`.

```bash
npm run facilitator     # terminal 1
npm run provider        # terminal 2  (this skill's server.ts)
tsx skills/pact-escrow/client.ts "http://localhost:4021/price?symbol=BTC" --release
```

## How the trust works (why this is safe)

- The payer signs **EIP-3009 `ReceiveWithAuthorization`**; the signed `nonce` is bound to the exact deal (`chainId, escrow, payer, provider, token, amount, requestHash, deliverBy, reviewWindow`). A relayer cannot redirect the funds.
- Funds can never be stuck: `release` (payer or post-window), `refundExpired` (no-show), `resolve` (arbiter), or `resolveTimeout` (50/50 if the arbiter is absent) always terminate a deal.
- Settlement never depends on the reputation hook (it is best-effort), so a failing reputation contract cannot trap funds.

## Bundled resources

Self-contained, for any agent/runtime consuming this skill (the same layout as the
official `pharos-skill-engine`):

- [`assets/networks.json`](assets/networks.json) — Pharos Atlantic + local network config, x402 network id, and the deployed contract addresses to fill in after deploy.
- [`assets/abi/`](assets/abi/) — the on-chain ABIs (`PactEscrow`, `PactReputation`, `PactArbiter`, `MockUSDC`), extracted from the compiled contracts.
- [`references/escrow-scheme.md`](references/escrow-scheme.md) — the full wire format of the `escrow` scheme (402 challenge, `X-PAYMENT`, `/verify` `/settle`, `X-PAYMENT-RESPONSE`) — read this to implement a client or facilitator from scratch.

## Composes with

- [pact-reputation](../pact-reputation/SKILL.md) — check a provider's score *before* paying.
- [pact-arbiter](../pact-arbiter/SKILL.md) — resolve disputes.
