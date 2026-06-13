<div align="center">

# Pact

### Conditional settlement for the agent economy — the missing **`escrow`** scheme for x402.

**x402 lets agents pay over HTTP. Pact lets them pay _on delivery_** — funds locked on a single signature, released only when the work is delivered and accepted, refunded on a no-show, split by an arbiter on dispute, with reputation earned on-chain.

![Live on Pharos Atlantic](https://img.shields.io/badge/Live-Pharos_Atlantic-5b8cff?style=for-the-badge)
![chain 688689](https://img.shields.io/badge/chain-688689-1f6feb?style=for-the-badge)
![x402 escrow scheme](https://img.shields.io/badge/x402-escrow_scheme-2ea043?style=for-the-badge)
![Foundry 19 passing](https://img.shields.io/badge/Foundry-19_tests_passing-3fb950?style=for-the-badge)
![MIT](https://img.shields.io/badge/license-MIT-lightgrey?style=for-the-badge)

**[Live contracts ↗](https://atlantic.pharosscan.xyz/address/0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7)** · **[Deployment record](DEPLOYMENTS.md)** · **[Runbook](RUNBOOK.md)** · **[The escrow scheme spec](skills/pact-escrow/references/escrow-scheme.md)**

🎥 _Demo video: add link_ &nbsp;|&nbsp; Built for the **Pharos × Anvita Flow Skill-to-Agent Dual Cascade Hackathon**

</div>

---

## 🟢 Deployed & proven on Pharos Atlantic

Not a localhost prototype — **the whole escrow lifecycle ran on-chain** on Pharos Atlantic (chain `688689`).

| Contract | Address | |
|---|---|---|
| **PactEscrow** | `0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7` | [explorer ↗](https://atlantic.pharosscan.xyz/address/0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7) |
| **PactReputation** | `0x0E8F77A0aFbB10f09D1e1C70FF669A135FAFfA95` | [explorer ↗](https://atlantic.pharosscan.xyz/address/0x0E8F77A0aFbB10f09D1e1C70FF669A135FAFfA95) |
| **PactArbiter** | `0x728cC2c144f16B2ea93A754607a590289456101c` | [explorer ↗](https://atlantic.pharosscan.xyz/address/0x728cC2c144f16B2ea93A754607a590289456101c) |
| **MockUSDC** (EIP-3009) | `0xBe39C0e0Ec029aaab71224ad73eFfCEEDA677427` | [explorer ↗](https://atlantic.pharosscan.xyz/address/0xBe39C0e0Ec029aaab71224ad73eFfCEEDA677427) |

`ENV=production npm run demo` drove all three terminal states live; reputation moved **`0 → 10000 → 3333 → 2000`** as deals settled:

| Deal | Outcome | On-chain effect |
|---|---|---|
| honest provider | **release** | provider paid 0.10 USDC · score → **10000** |
| no-show | **refund** | payer made whole after deadline · score → **3333** |
| bad delivery | **dispute → arbiter** | funds split to payer · provider `faulted` · score → **2000** |

> With x402's `exact` scheme, the last two are impossible — the money was already gone.

---

## The insight

x402's production scheme, **`exact`**, is a *push payment* — irreversible the moment it executes. The agent pays first and hopes. That's fine for a $0.001 API call; it's reckless when one agent pays another to do real work.

Pact adds the primitive x402 is missing: **`escrow`, a conditional settlement scheme** that keeps x402's exact ergonomics — a `402` challenge, an `X-PAYMENT` header, a facilitator with `/verify` `/settle` `/supported`, and a single gasless EIP-3009 signature from the payer — and changes only **what that signature funds**: an on-chain escrow bound to the request, instead of the provider's wallet.

x402 is explicitly scheme-extensible (`PaymentRequirements.scheme` + a facilitator that supports the `(scheme, network)` pair). `exact` already exists; **Pact registers `escrow` alongside it.** That's the foundational-layer contribution — we extend the exact rail the Pharos agent economy is being built on, rather than fork it.

---

## What's inside

A complete vertical slice — contracts, protocol, skills, an autonomous agent, and a UI — that all compose:

| Layer | What it is |
|---|---|
| **Contracts** | `PactEscrow` (conditional vault) · `PactReputation` (earned, unfakeable) · `PactArbiter` (dispute rulings) · EIP-3009 `MockUSDC`. 19 Foundry tests incl. fuzzing. |
| **The `escrow` x402 scheme** | A facilitator (`/verify` `/settle` `/supported`), a provider server, a client, and a typed SDK — the conditional scheme running over real x402 ergonomics. |
| **3 composable Skills** | [`pact-escrow`](skills/pact-escrow/SKILL.md) · [`pact-reputation`](skills/pact-reputation/SKILL.md) · [`pact-arbiter`](skills/pact-arbiter/SKILL.md) — Anthropic-format `SKILL.md` (the official Pharos Skill format), with bundled `assets/` + the wire spec. |
| **The Steward agent** (Phase 2) | [`agent/steward`](agent/steward/AGENT.md) — an autonomous buyer built *only* from the three Skills: reputation → escrow → verify → release/dispute. |
| **Web UI** | A Next.js app: a **Buyer** flow (with real **MetaMask** signing) and a live **Steward dashboard** (reputation cards + SSE task feed + flywheel). |

---

## Quickstart

Every command below is verified — locally against an anvil pinned to Pharos' chain id, and live on Atlantic. Full copy-paste steps (incl. live deploy) in **[RUNBOOK.md](RUNBOOK.md)**.

```bash
git clone --recursive https://github.com/Nihal-Pandey-2302/pact && cd pact
npm install                            # cloned without --recursive? git submodule update --init --recursive
cd contracts && forge test             # 19 passing: lifecycle, gasless EIP-3009, dispute, fuzz

# run the whole story locally in ~60s (anvil pinned to Pharos' chain id)
anvil --chain-id 688689 &
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
cd .. && npm run demo                   # honest→released · no-show→refunded · bad→disputed→arbiter
```

Then drive it like an agent would:

```bash
npm run facilitator                                      # /verify /settle /supported (exact + escrow)
npm run provider                                         # an escrow-protected price API
npm run client -- "http://localhost:4021/price?symbol=BTC" --release   # pay-on-delivery
npm run reputation -- 0x<provider>                       # read earned, escrow-gated reputation
```

> The payer **never pays gas to fund a deal** — the facilitator relays the EIP-3009 signature. It only signs `release`/`dispute`.

---

## Architecture

```text
            ┌──────────────┐   402 + escrow requirements    ┌───────────────┐
            │  Caller      │ ─────────────────────────────► │  Provider     │
            │  agent       │ ◄───────────────────────────── │  (skill API)  │
            └──────┬───────┘   result + dealId (X-PAYMENT-RESP)└──────┬───────┘
                   │ signs EIP-3009 (no gas)            verify│settle │ deliver()
                   ▼                                          ▼       ▼
            ┌───────────────┐   /verify  /settle      ┌──────────────────────┐
            │  Facilitator  │ ──────────────────────► │  PactEscrow (Pharos) │
            └───────────────┘  openWithAuthorization  │  holds USDC per deal │
                                                       └─────────┬────────────┘
                              release / refund / resolve         │ writes
                                                                 ▼
                                       ┌───────────────┐   ┌──────────────────┐
                                       │ PactArbiter   │──►│ PactReputation   │
                                       │ dispute ruling│   │ earned scores    │
                                       └───────────────┘   └──────────────────┘
```

**The lifecycle, every path terminal (funds can never be trapped):**

| Action | Who | When | Result |
|---|---|---|---|
| `release` | payer (or anyone post-window) | result accepted | provider paid (minus fee) |
| `refundExpired` | anyone | provider no-show | payer refunded in full |
| `dispute` → `resolve` | payer → arbiter | result is wrong | funds split by ruling |
| `resolveTimeout` | anyone | arbiter absent | neutral 50/50 |

---

## Phase 2 — the **Steward** agent (the cascade)

The Skills compose into **[Steward](agent/steward/AGENT.md)**, an autonomous buyer built *only* from Phase 1. Per task it **checks reputation** → **escrows** payment → **verifies** the result (deterministic policy gate, plus **Claude `claude-opus-4-8`** as an optional judge when `ANTHROPIC_API_KEY` is set) → **releases or disputes**, and every outcome feeds the next decision.

```bash
npm run steward     # boots an honest + a shoddy provider; runs the Steward over a task stream
```

**Verified run:** the Steward bootstraps each provider once — the honest one earns a perfect score, the shoddy one (it returns `price: 0`) is caught, **disputed, and marked at fault** — then every remaining job routes to the honest provider. **Final tally: honest 5, shoddy 0.** That's the agent-economy trust flywheel: deliver well and win the next job; deliver junk once and get routed out.

---

## Web UI

A live app over the same verified backend — a thin gateway exposes it; the UI is pure presentation.

```bash
npm run gateway                          # facilitator + both providers + API on :4040
cd web && npm install && npm run dev     # http://localhost:3000
```

- **Buyer** — pick a provider, watch `402 → escrow → result → verdict`, then **Release** or **Dispute**. Signs with a real **MetaMask** wallet (gasless EIP-3009 funding; you send `release`/`dispute` yourself) or a zero-friction burner.
- **Steward dashboard** — provider reputation cards, a live **SSE** task feed, and the flywheel bar.

For a pristine recording: `bash scripts/reset-demo.sh` (fresh chain + redeploy → reputation from zero). For live: fill `.env.production` and run anything with `ENV=production`.

---

## Built for the Skill-to-Agent Dual Cascade Hackathon

| Judging axis | How Pact answers it |
|---|---|
| **Originality** | A new x402 *scheme* — the conditional-settlement trust layer x402 lacks. Not another price bot. |
| **Reusability / composability** | Three independent `SKILL.md` Skills every paying agent needs; reputation is invoked around every deal. |
| **Technical quality** | Gasless EIP-3009 with deal-bound nonces, reentrancy-safe settlement, no-trapped-funds invariants, 19-test Foundry suite with fuzzing — and a security pass with fixes applied. |
| **Pharos alignment** | Agent payments + agent-social trust + A2A commerce, **deployed and exercised on Pharos Atlantic** via x402. |
| **The cascade** | Phase 1 Skills that *visibly become* a Phase 2 Agent — the Steward is built from nothing but those Skills. |

---

## Security

- **Deal-bound nonce.** The EIP-3009 `nonce` is bound to `(chainId, escrow, payer, provider, token, amount, requestHash, deliverBy, reviewWindow)` — a relayed authorization can only ever open the exact deal it was signed for.
- **Issued-challenge binding.** A provider only settles deals for challenges it actually issued, on the terms it offered (one-shot, TTL'd).
- **Best-effort reputation.** Reputation writes are `try/catch`'d — a misbehaving reputation contract can never freeze a settlement or trap funds.
- **Always a terminal exit.** `release` / `refundExpired` / `resolve` / `resolveTimeout` — no path locks funds.
- **Reviewed.** A multi-angle code review was run and its findings fixed (loopback-only gateway, origin allowlist, canonical result hashing, fail-loud config, and more).

---

## Repo layout

```text
contracts/        Foundry: PactEscrow / PactReputation / PactArbiter / MockUSDC + tests + deploy
src/lib/          the x402 escrow scheme — chains, ABIs, EIP-3009 signing, scheme, contract helpers
src/facilitator/  facilitator service (/supported /verify /settle)
skills/           pact-escrow · pact-reputation · pact-arbiter   (SKILL.md + assets + wire spec)
src/gateway/      HTTP/SSE gateway over the backend, for the web UI
agent/steward/    Phase 2 — the Steward agent (reputation-routed, escrow-paying, self-verifying)
web/              Next.js app — Buyer flow (MetaMask) + live Steward dashboard
scripts/          reset-demo.sh — pristine chain + redeploy for a clean recording
```

## License

MIT
