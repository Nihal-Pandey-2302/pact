# Pact — conditional settlement for x402 agent payments

**x402 lets agents pay over HTTP. Pact lets them pay *on delivery*.**

x402's production scheme, `exact`, is a push payment — irreversible the moment it
executes. An agent pays first and hopes the counterparty is honest and delivers.
That's fine for a $0.001 API call; it's reckless when one agent pays another to do
real work. Pact adds the missing primitive: **`escrow`, a conditional settlement
scheme for x402 on Pharos**, plus the reputation and arbitration that make
agent-to-agent commerce trustworthy.

> Built for the Skill-to-Agent Dual Cascade Hackathon (Pharos × Anvita Flow).
> Phase 1 ships three composable Skills; they cascade into the Phase 2 **Steward** agent.

---

## The idea in one paragraph

A paying agent's USDC is locked in an on-chain escrow bound to a specific request.
The provider delivers a result; funds **release** on the payer's acceptance (or
auto-release after a review window), **refund** if the provider no-shows, or **split
by an arbiter** on dispute. Every outcome writes **reputation that is earned, never
self-reported** — because only the escrow contract can write it. It keeps x402's
exact ergonomics (a `402` challenge, an `X-PAYMENT` header, a facilitator with
`/verify` `/settle` `/supported`); the payer still signs once (EIP-3009) and sends
no transaction. The only thing that changes is *what the signature funds*.

## Why it fits x402 (not a fork)

x402 is explicitly scheme-extensible: a *scheme* is just "a logical way of moving
money," advertised in `PaymentRequirements.scheme` and matched by a facilitator that
supports the `(scheme, network)` pair. `exact` already exists. Pact registers
**`escrow`** alongside it — same protocol, new settlement behaviour. That's the
foundational-layer contribution: we extend the rail the whole Pharos agent economy
is being built on.

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

## The Skills (Phase 1)

| Skill | What it gives an agent |
|---|---|
| [`pact-escrow`](skills/pact-escrow/SKILL.md) | Call or offer an escrow-protected endpoint — pay-on-delivery over x402. |
| [`pact-reputation`](skills/pact-reputation/SKILL.md) | Check a counterparty's earned, sybil-resistant score *before* paying. |
| [`pact-arbiter`](skills/pact-arbiter/SKILL.md) | Open a dispute, or (as a juror) rule on one. |

Each is an Anthropic-format `SKILL.md` (the same format as the official Pharos
`x402-pharos` skill) and is consumable by Claude Code / Open Code / Anvita Flow.

## Contracts (`contracts/src`)

- [`PactEscrow.sol`](contracts/src/PactEscrow.sol) — the escrow vault. Direct funding (`open`) and **gasless** funding (`openWithAuthorization`, EIP-3009 with the nonce bound to the exact deal). Lifecycle: deliver → release / refundExpired / dispute → resolve / resolveTimeout. Funds can never be trapped.
- [`PactReputation.sol`](contracts/src/PactReputation.sol) — writable only by the escrow; scores are a byproduct of settled deals.
- [`PactArbiter.sol`](contracts/src/PactArbiter.sol) — whitelisted-juror rulings, swappable for a staked panel later.
- [`MockUSDC.sol`](contracts/src/mocks/MockUSDC.sol) — 6-decimal test USDC with EIP-2612 + **EIP-3009**, so the gasless path runs exactly as it would against real USDC.

Network: **Pharos Atlantic** (chain `688689`, RPC `https://atlantic.dplabs-internal.com`, explorer `https://atlantic.pharosscan.xyz`).

## Quickstart

Verified end-to-end on a local anvil running as Pharos Atlantic (chain `688689`).
Full, copy-pasteable steps — including the live-testnet path — are in
[RUNBOOK.md](RUNBOOK.md).

```bash
git clone --recursive https://github.com/Nihal-Pandey-2302/pact && cd pact
npm install                           # (if cloned without --recursive: git submodule update --init --recursive)
cd contracts && forge test            # 19 passing: lifecycle, gasless, dispute, fuzz

# Local in 60s: run anvil on Pharos' chain id, deploy, point .env at it.
anvil --chain-id 688689 &             # (or use the live RPC + a faucet-funded key)
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
cd ..                                 # copy printed addresses into .env (see RUNBOOK)

npm run facilitator                   # terminal 1 — /supported /verify /settle (exact + escrow)
npm run provider                      # terminal 2 — an escrow-protected price API
npm run client -- "http://localhost:4021/price?symbol=BTC" --release   # pay-on-delivery
npm run reputation -- 0x<provider>    # read earned, escrow-gated reputation

npm run demo                          # the whole story: honest→released, no-show→refunded, bad→disputed
```

> Gas: payer, provider, facilitator and deployer each need a little PHRS on testnet.
> The payer never pays gas to *fund* a deal — that's the facilitator's job — but does
> sign release/dispute in this reference flow.

## Phase 1 → Phase 2 cascade: the Steward agent

The Skills compose into **[Steward](agent/steward/AGENT.md)**, the Agent Arena entry —
an autonomous buyer built *only* from the Phase 1 Skills. Per task it **checks
reputation** (`pact-reputation`), **escrows** payment (`pact-escrow`), gets the
result, **verifies** it (a deterministic policy gate, plus Claude `claude-opus-4-8`
when `ANTHROPIC_API_KEY` is set), then **releases or disputes** (`pact-arbiter`) — and
every outcome updates reputation for the next decision.

```bash
npm run steward     # boots an honest + a shoddy provider, runs the Steward over a task stream
```

Verified run (deterministic verifier, no key needed): the Steward bootstraps each
provider once, the honest one earns a perfect score and the shoddy one (it delivers
`price: 0`) gets **disputed and marked at fault** — then the Steward routes every
remaining job to the honest provider. **Final tally: honest 5 jobs, shoddy 0.** That's
the agent-economy trust flywheel: deliver well and win the next job; deliver junk once
and get routed out.

## Web UI

A live app over the same backend: a **Buyer** page (request → `402` → escrow → result
→ release/dispute, with the on-chain verdict) and a **Steward** dashboard (reputation
cards + a live SSE task feed + the flywheel). A thin gateway reuses the exact code the
CLI demos use, so the UI is presentation over a backend that's already verified.

```bash
npm run gateway              # boots facilitator + both providers, serves the API on :4040
cd web && npm install && npm run dev   # Next.js on http://localhost:3000
```

The Buyer page supports a real **MetaMask** wallet (sign the EIP-3009 funding auth +
send `release`/`dispute` yourself; the gateway relays and the arbiter rules) and falls
back to a zero-friction burner the gateway signs with. For a pristine recording,
`bash scripts/reset-demo.sh` (fresh chain + redeploy → reputation from zero). For the
live testnet, fill `.env.production` and run with `ENV=production`.

## How it maps to the judging criteria

- **Originality** — the trust layer x402 lacks; a new x402 *scheme*, not another DeFi/price bot.
- **Reusability / composability** — three independent Skills every paying agent needs; reputation is invoked around every deal.
- **Technical quality** — EIP-3009 gasless funding with deal-bound nonces, reentrancy-safe settlement, no-trapped-funds invariants, full Foundry suite incl. fuzzing.
- **Pharos alignment** — agent payments + agent-social/trust + A2A + compliance, on Pharos Atlantic via x402.
- **Cascade** — Skills (Phase 1) that visibly become an Agent (Phase 2).

## Repo layout

```text
contracts/        Foundry: PactEscrow / PactReputation / PactArbiter / MockUSDC + tests + deploy
src/lib/          x402 escrow scheme (chains, abi, signing, escrowScheme, contracts helpers)
src/facilitator/  the facilitator service (/supported /verify /settle)
skills/           pact-escrow · pact-reputation · pact-arbiter  (SKILL.md + scripts)
                  pact-escrow/{assets,references}  — networks.json, ABIs, the escrow-scheme wire spec
src/demo/         end-to-end narrative
src/gateway/      HTTP/SSE gateway over the backend, for the web UI
agent/steward/    Phase 2 — the Steward agent: reputation-routed, escrow-paying, self-verifying
web/              Next.js app — Buyer flow + live Steward dashboard
```

## Security notes

- EIP-3009 `nonce` is bound to `(chainId, escrow, payer, provider, token, amount, requestHash, deliverBy, reviewWindow)` — a relayed authorization can only open the exact deal it was signed for.
- Reputation writes are best-effort (`try/catch`): a misbehaving reputation contract can never freeze a settlement.
- Every deal has a terminal exit (`release` / `refundExpired` / `resolve` / `resolveTimeout`) — no path traps funds.
- `MockUSDC` is for testnet only; on mainnet, point `USDC_ADDRESS` at canonical USDC (same EIP-3009 surface).

## License

MIT
