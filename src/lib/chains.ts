import "./loadEnv";
import {defineChain} from "viem";

const ATLANTIC_RPC = process.env.PHAROS_ATLANTIC_RPC ?? "https://atlantic.dplabs-internal.com";
const TESTNET_RPC = process.env.PHAROS_TESTNET_RPC ?? "https://testnet.dplabs-internal.com";

/** Pharos Atlantic testnet — the network the official x402 skill targets. */
export const pharosAtlantic = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: {name: "Pharos", symbol: "PHRS", decimals: 18},
  rpcUrls: {default: {http: [ATLANTIC_RPC]}},
  blockExplorers: {default: {name: "PharosScan", url: "https://atlantic.pharosscan.xyz"}},
  testnet: true,
});

export const pharosTestnet = defineChain({
  id: 688688,
  name: "Pharos Testnet",
  nativeCurrency: {name: "Pharos", symbol: "PHRS", decimals: 18},
  rpcUrls: {default: {http: [TESTNET_RPC]}},
  blockExplorers: {default: {name: "PharosScan", url: "https://testnet.pharosscan.xyz"}},
  testnet: true,
});

/** x402 network identifier, e.g. "eip155:688689". */
export const networkId = (chainId: number): `eip155:${number}` => `eip155:${chainId}`;
