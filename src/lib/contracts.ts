import {type Address, type Hex} from "viem";
import {publicClient, wallet} from "./env";
import {pactEscrowAbi, pactReputationAbi, pactArbiterAbi, mockUsdcAbi} from "./abi";

export const STATE = ["None", "Open", "Delivered", "Released", "Refunded", "Disputed", "Resolved"] as const;

export interface Deal {
  payer: Address;
  provider: Address;
  token: Address;
  amount: bigint;
  requestHash: Hex;
  resultHash: Hex;
  deliverBy: bigint;
  reviewUntil: bigint;
  resolveBy: bigint;
  reviewWindow: number;
  state: number;
}

// --- reads ---
export const usdcName = (usdc: Address): Promise<string> =>
  publicClient.readContract({address: usdc, abi: mockUsdcAbi, functionName: "name"});

export const balanceOf = (usdc: Address, owner: Address): Promise<bigint> =>
  publicClient.readContract({address: usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [owner]});

export const getScore = (reputation: Address, agent: Address): Promise<number> =>
  publicClient.readContract({address: reputation, abi: pactReputationAbi, functionName: "score", args: [agent]});

export const getRecord = (reputation: Address, agent: Address) =>
  publicClient.readContract({address: reputation, abi: pactReputationAbi, functionName: "recordOf", args: [agent]});

export async function getDeal(escrow: Address, id: bigint): Promise<Deal> {
  const d = await publicClient.readContract({
    address: escrow,
    abi: pactEscrowAbi,
    functionName: "getDeal",
    args: [id],
  });
  return d as unknown as Deal;
}

// --- writes (each signed by the given key) ---
async function send(pk: Hex, params: {address: Address; abi: unknown; functionName: string; args: unknown[]}): Promise<Hex> {
  const {client} = wallet(pk);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await client.writeContract(params as any);
  await publicClient.waitForTransactionReceipt({hash});
  return hash;
}

export const mint = (pk: Hex, usdc: Address, to: Address, amount: bigint) =>
  send(pk, {address: usdc, abi: mockUsdcAbi, functionName: "mint", args: [to, amount]});

export const deliver = (pk: Hex, escrow: Address, id: bigint, resultHash: Hex) =>
  send(pk, {address: escrow, abi: pactEscrowAbi, functionName: "deliver", args: [id, resultHash]});

export const release = (pk: Hex, escrow: Address, id: bigint) =>
  send(pk, {address: escrow, abi: pactEscrowAbi, functionName: "release", args: [id]});

export const dispute = (pk: Hex, escrow: Address, id: bigint) =>
  send(pk, {address: escrow, abi: pactEscrowAbi, functionName: "dispute", args: [id]});

export const refundExpired = (pk: Hex, escrow: Address, id: bigint) =>
  send(pk, {address: escrow, abi: pactEscrowAbi, functionName: "refundExpired", args: [id]});

export const rule = (pk: Hex, arbiter: Address, id: bigint, payerBps: number, reason: string) =>
  send(pk, {address: arbiter, abi: pactArbiterAbi, functionName: "rule", args: [id, payerBps, reason]});
