# Runbook

Every command below has been **run and verified** end-to-end against a local anvil
configured as Pharos Atlantic (chain id `688689`). Two paths: a self-contained local
demo (no faucet, runs in ~1 minute) and the live Pharos Atlantic deployment.

## 0. Install

```bash
git clone --recursive https://github.com/Nihal-Pandey-2302/pact
cd pact
npm install
# already cloned without --recursive? fetch the OpenZeppelin submodule:
git submodule update --init --recursive
```

## 1. Contracts — test

```bash
cd contracts
forge test            # 19 passing: lifecycle, gasless EIP-3009, dispute, fuzz
```

## 2a. Local quickstart (verified, no testnet needed)

Run anvil with Pharos' chain id so the EIP-712 domains line up:

```bash
anvil --chain-id 688689        # terminal 1 — keep running
```

Point `.env` at it and deploy. The local accounts are anvil's deterministic test
keys (safe to commit nowhere; they are public):

```bash
# .env  (DEPLOYER/PROVIDER/PAYER/FACILITATOR = anvil accounts 0/1/2/3)
PHAROS_ATLANTIC_RPC=http://localhost:8545
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PROVIDER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
PAYER_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
FACILITATOR_PRIVATE_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
FACILITATOR_URL=http://localhost:4020
PROVIDER_PORT=4021
```

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
PAYER_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
# copy the printed PACT_* / USDC_ADDRESS into ../.env
cd ..
```

For a fresh anvil deploying in this order the addresses are deterministic
(see `skills/pact-escrow/assets/networks.json` → `networks.local.contracts`):

```ini
USDC_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
PACT_REPUTATION=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
PACT_ESCROW=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
PACT_ARBITER=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
```

## 3. TypeScript — typecheck + run

```bash
npm run typecheck                     # clean

npm run facilitator                   # terminal 2 — /supported /verify /settle (exact + escrow)
npm run provider                      # terminal 3 — an escrow-protected price API

# pay-on-delivery handshake: 402 → sign EIP-3009 → settle into escrow → deliver → release
npm run client -- "http://localhost:4021/price?symbol=BTC" --release

# read a counterparty's earned, escrow-gated reputation
npm run reputation -- 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

## 4. The full story (one command)

```bash
npm run demo        # honest→released, no-show→refunded, bad→disputed→arbiter 80/20
```

Verified output: provider reputation moves `score 0 → 10000 → 3333 → 2000` across the
three deals, with every USDC unit accounted for. The closing line is the thesis:
*with x402's `exact` scheme, the no-show and dispute cases are impossible — the money
was already gone.*

## 5. Phase 2 — the Steward agent (verified)

```bash
npm run steward     # boots a facilitator + an honest and a shoddy provider in-process,
                    # then runs the autonomous Steward over a stream of tasks
```

Verified: the Steward bootstraps each provider once, **releases** to the honest one
(score → 10000) and **disputes** the shoddy one (`price: 0` → arbiter rules → `faulted`),
then routes every remaining job to the honest provider — final tally **honest 5, shoddy 0**.
Deterministic by default; set `ANTHROPIC_API_KEY` (optional `STEWARD_MODEL`, default
`claude-opus-4-8`) to let Claude make the accept/dispute call. See
[agent/steward/AGENT.md](agent/steward/AGENT.md).

## 6. Web UI (gateway + Next.js)

A live web app: a **Buyer** page (request → 402 → escrow → result → release/dispute)
and a **Steward** dashboard (reputation cards + live SSE task feed + flywheel).

```bash
npm run gateway        # terminal A — boots facilitator + Acme + Sketchy, serves the API on :4040
cd web && npm install  # once
npm run dev            # terminal B — Next.js on http://localhost:3000
```

The browser talks to the gateway (`NEXT_PUBLIC_GATEWAY_URL`, default `http://localhost:4040`);
the gateway reuses the exact backend the CLI demos use. Verified: `/api/config`,
`/api/state`, `/api/buy` (Acme→accept, Sketchy→dispute), `/api/settle`, the
`/api/steward/stream` SSE, and the wallet path (`/api/buy/prepare` → wallet signs →
`/api/buy/submit` → `/api/rule`) all return live on-chain results.

**Wallet (MetaMask) on the Buyer page.** Click *Connect Wallet* to sign the EIP-3009
funding authorization in MetaMask (the gateway relays it; gasless for the payer) and
send `release`/`dispute` as your own transactions; *Get test USDC* mints to the
connected account. Without a wallet it falls back to a zero-friction burner account
the gateway signs with. Add the network in MetaMask: chain `688689`, RPC = your
`NEXT_PUBLIC_RPC_URL` (default `http://localhost:8545`).

## 7. Pristine demo + production

```bash
bash scripts/reset-demo.sh     # fresh anvil + clean redeploy + rewrites .env → pristine on-chain reputation
```

Use this before recording so the Steward's bootstrap → catch-fraud → penalize → re-route
sequence runs from zero (reputation is on-chain — there is no Redis/off-chain cache).

**Live testnet:** fill `.env.production` (RPC is preset to `https://atlantic.dplabs-internal.com`,
chain `688689`; add funded keys + the deployed addresses), then run anything with
`ENV=production` — `loadEnv.ts` selects that file and the gateway reports
`[PRODUCTION · <rpc>]`. Deploy with
`forge script script/Deploy.s.sol --rpc-url https://atlantic.dplabs-internal.com --broadcast`.

## 2b. Live on Pharos Atlantic

Same as 2a, but fund real keys from the Pharos faucet and target the live RPC:

```bash
# in .env: PHAROS_ATLANTIC_RPC=https://atlantic.dplabs-internal.com  + funded keys
cd contracts
forge script script/Deploy.s.sol --rpc-url pharos_atlantic --broadcast
# copy addresses into ../.env and into networks.json → networks.pharos-atlantic.contracts
```

`foundry.toml` resolves the `pharos_atlantic` alias from `PHAROS_ATLANTIC_RPC`.
Gas (PHRS): payer, provider, facilitator and deployer each need a little — except the
payer never pays gas to *fund* a deal (that is the facilitator's job); it only signs.
