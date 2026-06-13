#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
export FOUNDRY_FUZZ_RUNS="${FOUNDRY_FUZZ_RUNS:-32}"
forge test -vv --threads 1
echo "FORGE_EXIT=$?"
