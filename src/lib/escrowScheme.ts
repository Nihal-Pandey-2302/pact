import {
  decodeEventLog,
  recoverTypedDataAddress,
  serializeSignature,
  type Address,
  type Hex,
} from "viem";
import {type PrivateKeyAccount} from "viem/accounts";
import {publicClient, wallet} from "./env";
import {pactEscrowAbi, mockUsdcAbi} from "./abi";
import {authNonce, signFundingAuthorization, RECEIVE_TYPES_FIELDS, type DealParams} from "./signing";
import {networkId} from "./chains";
import {
  X402_VERSION,
  type PaymentRequirements,
  type PaymentPayload,
  type EscrowExtra,
  type EscrowPayload,
} from "./x402";

const SCHEME = "escrow" as const;

const RECEIVE_TYPES = {ReceiveWithAuthorization: RECEIVE_TYPES_FIELDS};

const chainIdOf = (n: PaymentRequirements["network"]): number => Number(n.split(":")[1] ?? 0);

// ---------------------------------------------------------------------------
// SERVER — build the 402 challenge for an escrow-scheme payment.
// ---------------------------------------------------------------------------
export function buildEscrowRequirements(args: {
  chainId: number;
  escrow: Address;
  usdc: Address;
  usdcName: string;
  provider: Address;
  amount: bigint;
  resource: string;
  requestHash: Hex;
  deliverBy: number;
  reviewWindow: number;
  description?: string;
}): PaymentRequirements {
  const extra: EscrowExtra = {
    escrow: args.escrow,
    requestHash: args.requestHash,
    deliverBy: args.deliverBy,
    reviewWindow: args.reviewWindow,
    usdcName: args.usdcName,
  };
  return {
    scheme: SCHEME,
    network: networkId(args.chainId),
    asset: args.usdc,
    payTo: args.provider,
    maxAmountRequired: args.amount.toString(),
    resource: args.resource,
    description: args.description,
    mimeType: "application/json",
    maxTimeoutSeconds: Math.max(0, args.deliverBy - Math.floor(Date.now() / 1000)),
    extra: extra as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// CLIENT — sign the funding authorization and build the X-PAYMENT payload.
// The payer never sends a transaction; the signature *is* the payment.
// ---------------------------------------------------------------------------
export async function createEscrowPayment(args: {
  account: PrivateKeyAccount;
  chainId: number;
  requirements: PaymentRequirements;
}): Promise<PaymentPayload> {
  const r = args.requirements;
  const extra = r.extra as unknown as EscrowExtra;
  const deal: DealParams = {
    payer: args.account.address,
    provider: r.payTo as Address,
    token: r.asset as Address,
    amount: BigInt(r.maxAmountRequired),
    requestHash: extra.requestHash as Hex,
    deliverBy: BigInt(extra.deliverBy),
    reviewWindow: extra.reviewWindow,
  };
  const nonce = authNonce(args.chainId, extra.escrow as Address, deal);
  const auth = await signFundingAuthorization({
    account: args.account,
    chainId: args.chainId,
    usdc: deal.token,
    usdcName: extra.usdcName,
    escrow: extra.escrow as Address,
    amount: deal.amount,
    nonce,
  });
  const payload: EscrowPayload = {
    payer: deal.payer,
    amount: deal.amount.toString(),
    requestHash: deal.requestHash,
    deliverBy: extra.deliverBy,
    reviewWindow: deal.reviewWindow,
    authorization: {
      validAfter: auth.validAfter.toString(),
      validBefore: auth.validBefore.toString(),
      v: auth.v,
      r: auth.r,
      s: auth.s,
    },
  };
  return {x402Version: X402_VERSION, scheme: SCHEME, network: r.network, payload};
}

// ---------------------------------------------------------------------------
// FACILITATOR — verify the signed payload off-chain (cheap pre-check).
// ---------------------------------------------------------------------------
export async function verifyEscrowPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<{ok: boolean; reason?: string}> {
  if (payload.scheme !== SCHEME) return {ok: false, reason: "wrong scheme"};
  if (payload.network !== requirements.network) return {ok: false, reason: "wrong network"};

  const p = payload.payload as EscrowPayload;
  const extra = requirements.extra as unknown as EscrowExtra;
  if (p.amount !== requirements.maxAmountRequired) return {ok: false, reason: "amount mismatch"};
  if (p.requestHash !== extra.requestHash) return {ok: false, reason: "request mismatch"};

  const chainId = chainIdOf(requirements.network);
  const nonce = authNonce(chainId, extra.escrow as Address, {
    payer: p.payer as Address,
    provider: requirements.payTo as Address,
    token: requirements.asset as Address,
    amount: BigInt(p.amount),
    requestHash: p.requestHash as Hex,
    deliverBy: BigInt(p.deliverBy),
    reviewWindow: p.reviewWindow,
  });

  const signer = await recoverTypedDataAddress({
    domain: {name: extra.usdcName, version: "1", chainId, verifyingContract: requirements.asset as Address},
    types: RECEIVE_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: p.payer as Address,
      to: extra.escrow as Address,
      value: BigInt(p.amount),
      validAfter: BigInt(p.authorization.validAfter),
      validBefore: BigInt(p.authorization.validBefore),
      nonce,
    },
    signature: serializeSignature({
      r: p.authorization.r as Hex,
      s: p.authorization.s as Hex,
      v: BigInt(p.authorization.v),
    }),
  });
  if (signer.toLowerCase() !== p.payer.toLowerCase()) return {ok: false, reason: "bad signature"};

  const bal = await publicClient.readContract({
    address: requirements.asset as Address,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [p.payer as Address],
  });
  if (bal < BigInt(p.amount)) return {ok: false, reason: "insufficient balance"};

  return {ok: true};
}

// ---------------------------------------------------------------------------
// FACILITATOR — settle = fund the escrow on-chain via the relayed signature.
// Returns the dealId parsed from the DealOpened event.
// ---------------------------------------------------------------------------
export async function settleEscrowPayment(args: {
  facilitatorPk: Hex;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}): Promise<{dealId: string; txHash: Hex}> {
  const p = args.payload.payload as EscrowPayload;
  const extra = args.requirements.extra as unknown as EscrowExtra;
  const {client} = wallet(args.facilitatorPk);

  const txHash = await client.writeContract({
    address: extra.escrow as Address,
    abi: pactEscrowAbi,
    functionName: "openWithAuthorization",
    args: [
      args.requirements.payTo as Address,
      args.requirements.asset as Address,
      BigInt(p.amount),
      p.requestHash as Hex,
      BigInt(p.deliverBy),
      p.reviewWindow,
      p.payer as Address,
      BigInt(p.authorization.validAfter),
      BigInt(p.authorization.validBefore),
      p.authorization.v,
      p.authorization.r as Hex,
      p.authorization.s as Hex,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({hash: txHash});
  let dealId = "0";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== (extra.escrow as string).toLowerCase()) continue;
    try {
      const ev = decodeEventLog({abi: pactEscrowAbi, data: log.data, topics: log.topics});
      if (ev.eventName === "DealOpened") {
        dealId = (ev.args as {id: bigint}).id.toString();
        break;
      }
    } catch {
      // not a Pact event; ignore
    }
  }
  return {dealId, txHash};
}
