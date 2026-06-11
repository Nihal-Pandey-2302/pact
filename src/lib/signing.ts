import {encodeAbiParameters, keccak256, parseSignature, type Address, type Hex} from "viem";
import {type PrivateKeyAccount} from "viem/accounts";

export interface DealParams {
  payer: Address;
  provider: Address;
  token: Address;
  amount: bigint;
  requestHash: Hex;
  deliverBy: bigint; // uint64
  reviewWindow: number; // uint32
}

/**
 * Mirror of PactEscrow.authNonce — binds the EIP-3009 nonce to the exact deal
 * parameters, so a relayed funding authorization can only ever open this one deal.
 */
export function authNonce(chainId: number, escrow: Address, d: DealParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {type: "uint256"},
        {type: "address"},
        {type: "address"},
        {type: "address"},
        {type: "address"},
        {type: "uint256"},
        {type: "bytes32"},
        {type: "uint64"},
        {type: "uint32"},
      ],
      [BigInt(chainId), escrow, d.payer, d.provider, d.token, d.amount, d.requestHash, d.deliverBy, d.reviewWindow],
    ),
  );
}

// Single source of truth for the EIP-712 ReceiveWithAuthorization shape. Shared by
// the signer (below), the facilitator's verify (escrowScheme.ts) and the gateway's
// wallet `prepare` — so the typed data can never drift between sign and verify.
export const RECEIVE_TYPES_FIELDS = [
  {name: "from", type: "address"},
  {name: "to", type: "address"},
  {name: "value", type: "uint256"},
  {name: "validAfter", type: "uint256"},
  {name: "validBefore", type: "uint256"},
  {name: "nonce", type: "bytes32"},
];
export const EIP712_DOMAIN_FIELDS = [
  {name: "name", type: "string"},
  {name: "version", type: "string"},
  {name: "chainId", type: "uint256"},
  {name: "verifyingContract", type: "address"},
];

export interface SignedAuthorization {
  validAfter: bigint;
  validBefore: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

/**
 * Signs an EIP-3009 ReceiveWithAuthorization for the payer authorising the escrow
 * to pull `amount` of USDC. The signature is the entire "payment" the payer makes
 * — no on-chain tx, no gas; the facilitator relays it.
 */
export async function signFundingAuthorization(args: {
  account: PrivateKeyAccount;
  chainId: number;
  usdc: Address;
  usdcName: string;
  usdcVersion?: string;
  escrow: Address;
  amount: bigint;
  nonce: Hex;
  validAfter?: bigint;
  validBefore?: bigint;
}): Promise<SignedAuthorization> {
  const validAfter = args.validAfter ?? 0n;
  const validBefore = args.validBefore ?? BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await args.account.signTypedData({
    domain: {
      name: args.usdcName,
      version: args.usdcVersion ?? "1",
      chainId: args.chainId,
      verifyingContract: args.usdc,
    },
    types: {ReceiveWithAuthorization: RECEIVE_TYPES_FIELDS},
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: args.account.address,
      to: args.escrow,
      value: args.amount,
      validAfter,
      validBefore,
      nonce: args.nonce,
    },
  });

  const sig = parseSignature(signature);
  const yParity = sig.yParity ?? (sig.v !== undefined ? Number(sig.v) - 27 : 0);
  return {validAfter, validBefore, v: 27 + yParity, r: sig.r, s: sig.s};
}

/** keccak256 of an arbitrary UTF-8 string — used for requestHash. */
export function hashString(s: string): Hex {
  return keccak256(Buffer.from(s, "utf8"));
}

/** Deterministic, key-order-independent serialization, so two equal results hash
 *  the same regardless of JSON key ordering across HTTP/JSON round-trips. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** Canonical hash of a delivered result. The provider commits this on-chain
 *  (resultHash) and the verifier recomputes it; using a stable serialization makes
 *  the integrity check immune to key reordering by any intermediate. */
export function hashResult(result: unknown): Hex {
  return keccak256(Buffer.from(stableStringify(result), "utf8"));
}
