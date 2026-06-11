// Minimal browser-wallet integration: window.ethereum + viem. No wagmi/rainbowkit —
// the wallet signs the EIP-712 funding authorization (gateway relays it) and sends
// release/dispute as ordinary transactions.

import {createWalletClient, createPublicClient, custom, defineChain, type Address, type Hex} from "viem";

declare global {
  interface Window {
    ethereum?: {
      request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
const CHAIN_ID = 688689;
const CHAIN_HEX = "0xa8231"; // 688689

export const pharos = defineChain({
  id: CHAIN_ID,
  name: "Pharos Atlantic",
  nativeCurrency: {name: "Pharos", symbol: "PHRS", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
  blockExplorers: {default: {name: "PharosScan", url: "https://atlantic.pharosscan.xyz"}},
  testnet: true,
});

export const escrowAbi = [
  {type: "function", name: "release", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}], outputs: []},
  {type: "function", name: "dispute", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}], outputs: []},
] as const;

export const usdcAbi = [
  {type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{name: "to", type: "address"}, {name: "amount", type: "uint256"}], outputs: []},
  {type: "function", name: "balanceOf", stateMutability: "view", inputs: [{name: "a", type: "address"}], outputs: [{type: "uint256"}]},
] as const;

export const hasWallet = () => typeof window !== "undefined" && !!window.ethereum;

function eth() {
  if (!window.ethereum) throw new Error("No browser wallet found (install MetaMask).");
  return window.ethereum;
}

export async function connect(): Promise<Address> {
  const accounts = (await eth().request({method: "eth_requestAccounts"})) as string[];
  await ensureChain();
  return accounts[0] as Address;
}

export async function ensureChain(): Promise<void> {
  try {
    await eth().request({method: "wallet_switchEthereumChain", params: [{chainId: CHAIN_HEX}]});
  } catch (e) {
    if ((e as {code?: number}).code === 4902) {
      await eth().request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_HEX,
          chainName: "Pharos Atlantic",
          nativeCurrency: {name: "Pharos", symbol: "PHRS", decimals: 18},
          rpcUrls: [RPC],
          blockExplorerUrls: ["https://atlantic.pharosscan.xyz"],
        }],
      });
    } else throw e;
  }
}

export async function signTypedDataV4(from: Address, typedData: unknown): Promise<Hex> {
  return (await eth().request({method: "eth_signTypedData_v4", params: [from, JSON.stringify(typedData)]})) as Hex;
}

function clients(account: Address) {
  const transport = custom(eth());
  return {
    wallet: createWalletClient({account, chain: pharos, transport}),
    pub: createPublicClient({chain: pharos, transport}),
  };
}

async function send(account: Address, params: {address: Address; abi: unknown; functionName: string; args: unknown[]}): Promise<Hex> {
  const {wallet, pub} = clients(account);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await wallet.writeContract(params as any);
  await pub.waitForTransactionReceipt({hash});
  return hash;
}

export const releaseDeal = (account: Address, escrow: Address, id: string) =>
  send(account, {address: escrow, abi: escrowAbi, functionName: "release", args: [BigInt(id)]});

export const disputeDeal = (account: Address, escrow: Address, id: string) =>
  send(account, {address: escrow, abi: escrowAbi, functionName: "dispute", args: [BigInt(id)]});

export const mintUsdc = (account: Address, usdc: Address) =>
  send(account, {address: usdc, abi: usdcAbi, functionName: "mint", args: [account, 1_000_000_000n]}); // 1000 USDC

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
