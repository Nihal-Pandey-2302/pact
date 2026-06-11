import "./loadEnv";
import {createPublicClient, createWalletClient, http, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {pharosAtlantic} from "./chains";

export const RPC = process.env.PHAROS_ATLANTIC_RPC ?? "https://atlantic.dplabs-internal.com";
export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4020";
export const PROVIDER_PORT = Number(process.env.PROVIDER_PORT ?? 4021);

export const addresses = {
  escrow: process.env.PACT_ESCROW as Address | undefined,
  reputation: process.env.PACT_REPUTATION as Address | undefined,
  arbiter: process.env.PACT_ARBITER as Address | undefined,
  usdc: process.env.USDC_ADDRESS as Address | undefined,
};

const ENV_NAME: Record<keyof typeof addresses, string> = {
  escrow: "PACT_ESCROW",
  reputation: "PACT_REPUTATION",
  arbiter: "PACT_ARBITER",
  usdc: "USDC_ADDRESS",
};

export function requireAddress(name: keyof typeof addresses): Address {
  const a = addresses[name];
  if (!a) throw new Error(`Missing ${ENV_NAME[name]} in .env — run the deploy script first.`);
  return a;
}

export const publicClient = createPublicClient({chain: pharosAtlantic, transport: http(RPC)});

// No explicit return-type annotation: let viem infer the chain+account-bound
// client type, so writeContract calls don't have to re-declare chain/account.
export function wallet(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({account, chain: pharosAtlantic, transport: http(RPC)});
  return {account, client};
}

export function pk(name: string): Hex {
  const v = process.env[name];
  if (!v) throw new Error(`Missing private key env: ${name}`);
  return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
}
