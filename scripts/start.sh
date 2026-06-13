#!/usr/bin/env bash
# start.sh — run the entire Pact stack with one command.
#
#   ./scripts/start.sh           local: fresh anvil + deploy + gateway + web UI
#   ./scripts/start.sh --live    live: Pharos Atlantic (.env.production) + gateway + web UI
#
# Local is the zero-setup demo path (pristine chain every run). Live assumes the
# contracts are already deployed and .env.production is filled. Ctrl-C tears it all down.
set -euo pipefail
cd "$(dirname "$0")/.."

LIVE=0
[ "${1:-}" = "--live" ] && LIVE=1

cleanup() {
  echo; echo "▸ shutting down…"
  pkill -f "src/gateway/server" 2>/dev/null || true
  pkill -f "src/facilitator/server" 2>/dev/null || true
  pkill -f "skills/pact-escrow/server" 2>/dev/null || true
  [ "$LIVE" = "0" ] && pkill -f "anvil --chain-id 688689" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say() { printf "\033[1;36m▸ %s\033[0m\n" "$1"; }

command -v node >/dev/null || { echo "node 20+ is required"; exit 1; }
[ -d node_modules ] || { say "installing root deps…"; npm install; }
[ -d web/node_modules ] || { say "installing web deps…"; (cd web && npm install); }

if [ "$LIVE" = "1" ]; then
  export ENV=production
  [ -f .env.production ] || { echo "missing .env.production (fill it with the deployed addresses + a funded key)"; exit 1; }
  say "LIVE mode — Pharos Atlantic via .env.production"
else
  command -v anvil >/dev/null || { echo "anvil (Foundry) is required for local mode — https://getfoundry.sh"; exit 1; }
  say "resetting local chain + deploying contracts…"
  bash scripts/reset-demo.sh
fi

say "starting gateway (facilitator + Acme/Sketchy/Lazy providers + API on :4040)…"
npm run gateway &
for _ in $(seq 1 80); do
  curl -sf http://localhost:4040/api/health >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf http://localhost:4040/api/health >/dev/null 2>&1 || { echo "gateway did not come up"; exit 1; }
say "gateway up."

say "starting the web UI → http://localhost:3000"
cd web && npm run dev
