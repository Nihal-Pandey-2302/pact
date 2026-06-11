#!/usr/bin/env bash
# reset-demo.sh — return the local demo to a pristine state for a clean recording.
#
# There is no Redis / off-chain cache in Pact: reputation lives entirely on-chain in
# PactReputation, so "pristine reputation" means a brand-new chain + a fresh deploy.
# This script restarts anvil (chain 688689), wipes Foundry's broadcast cache, redeploys
# the full stack, and writes the new addresses into .env — so the Steward's
# bootstrap → catch fraud → penalize → re-route drama runs from zero every time.
#
# Run from the repo root in a normal terminal:  bash scripts/reset-demo.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

RPC="http://localhost:8545"
CHAIN_ID=688689
# anvil default accounts (public test keys): deployer = acct 0, buyer/payer = acct 2
DEPLOYER_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PAYER_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

say() { printf "\033[1;36m▸ %s\033[0m\n" "$1"; }

say "stopping any running anvil / gateway services"
pkill -f "anvil --chain-id ${CHAIN_ID}" 2>/dev/null || true
pkill -f "src/facilitator/server" 2>/dev/null || true
pkill -f "skills/pact-escrow/server" 2>/dev/null || true
pkill -f "src/gateway/server" 2>/dev/null || true
sleep 1

say "clearing Foundry broadcast cache (forces a clean deploy record)"
rm -rf "${ROOT}/contracts/broadcast" "${ROOT}/contracts/cache/Deploy.s.sol" 2>/dev/null || true

say "starting fresh anvil (chain ${CHAIN_ID})"
nohup anvil --chain-id "${CHAIN_ID}" --host 127.0.0.1 --port 8545 >/tmp/pact-anvil.log 2>&1 &
# wait for RPC
for i in $(seq 1 40); do
  if cast chain-id --rpc-url "${RPC}" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
cast chain-id --rpc-url "${RPC}" >/dev/null || { echo "anvil failed to start (see /tmp/pact-anvil.log)"; exit 1; }

say "deploying the Pact stack"
# capture without aborting (set -e) so the diagnostic below can run on failure
DEPLOY_OUT="$(cd "${ROOT}/contracts" && \
  DEPLOYER_PRIVATE_KEY="${DEPLOYER_PK}" PAYER_ADDRESS="${PAYER_ADDR}" \
  forge script script/Deploy.s.sol --rpc-url "${RPC}" --broadcast 2>&1)" || true

extract() { echo "${DEPLOY_OUT}" | grep -oE "$1=0x[0-9a-fA-F]{40}" | head -1 | cut -d= -f2; }
USDC="$(extract USDC_ADDRESS)"
REP="$(extract PACT_REPUTATION)"
ESC="$(extract PACT_ESCROW)"
ARB="$(extract PACT_ARBITER)"
[ -n "${ESC}" ] || { echo "deploy failed:"; echo "${DEPLOY_OUT}" | tail -20; exit 1; }

say "writing addresses into .env"
[ -f "${ROOT}/.env" ] || cp "${ROOT}/.env.example" "${ROOT}/.env"
upsert() { # upsert KEY VALUE into .env
  if grep -q "^$1=" "${ROOT}/.env"; then
    sed -i "s|^$1=.*|$1=$2|" "${ROOT}/.env"
  else
    printf "%s=%s\n" "$1" "$2" >> "${ROOT}/.env"
  fi
}
upsert PHAROS_ATLANTIC_RPC "${RPC}"
upsert USDC_ADDRESS "${USDC}"
upsert PACT_REPUTATION "${REP}"
upsert PACT_ESCROW "${ESC}"
upsert PACT_ARBITER "${ARB}"

printf "\n\033[1;32m✓ demo reset — pristine on-chain reputation\033[0m\n"
cat <<EOF
  chain      ${CHAIN_ID}  (${RPC})
  USDC       ${USDC}
  Escrow     ${ESC}
  Reputation ${REP}
  Arbiter    ${ARB}

next:
  npm run gateway          # boots facilitator + Acme(honest) + Sketchy(shoddy)
  cd web && npm run dev    # UI on http://localhost:3000  ->  /steward  ->  Run Steward
EOF
