// Single source of truth for which env file is active. Imported first by chains.ts
// and env.ts (before any process.env read) so the choice is made before any module
// captures an RPC URL or address.
//
//   ENV=production  → .env.production   (live Pharos Atlantic)
//   otherwise       → .env             (local anvil / dev)
//
// override:false is deliberate — values already in process.env win. That keeps
// real runtime overrides (e.g. PROVIDER_PORT passed to a spawned child) from being
// clobbered by the file. This module is imported first in every entrypoint, so the
// file still loads before anything reads an address or RPC.

import dotenv from "dotenv";

export const IS_PRODUCTION = process.env.ENV === "production" || process.env.PACT_ENV === "production";

dotenv.config({path: IS_PRODUCTION ? ".env.production" : ".env", override: false});
