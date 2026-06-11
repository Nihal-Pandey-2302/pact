// Minimal x402 types, extended with the `escrow` scheme.
//
// x402 is deliberately scheme-extensible: a "scheme" is just a logical way of
// moving money, advertised in PaymentRequirements.scheme and matched by a
// facilitator that supports the (scheme, network) pair. The production scheme is
// `exact` (push-once, irreversible). Pact adds `escrow`: a conditional scheme
// where funds are held until the work is delivered and accepted.

export const X402_VERSION = 1;
export const PAYMENT_HEADER = "X-PAYMENT";
export const PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";

export type Network = `eip155:${number}`;
export type Scheme = "exact" | "escrow";

export interface PaymentRequirements {
  scheme: Scheme;
  network: Network;
  /** ERC-20 asset address (USDC). */
  asset: string;
  /** Recipient — for `escrow` this is the provider that must deliver. */
  payTo: string;
  /** Amount in token base units (USDC has 6 decimals). */
  maxAmountRequired: string;
  /** The protected resource (URL). */
  resource: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  /** Scheme-specific data. For `escrow`: EscrowExtra. */
  extra?: Record<string, unknown>;
}

/** `extra` payload for the escrow scheme, returned in the 402 challenge. */
export interface EscrowExtra {
  escrow: string; // PactEscrow address
  requestHash: string; // bytes32 binding the deal to this exact request
  deliverBy: number; // unix seconds the provider must deliver by
  reviewWindow: number; // seconds the payer may dispute after delivery
  usdcName: string; // EIP-712 domain name of the asset (for signing)
}

export interface PaymentRequiredBody {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
}

/** Signed payload the client sends in the X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: number;
  scheme: Scheme;
  network: Network;
  payload: EscrowPayload | Record<string, unknown>;
}

/** The escrow scheme's payload: an EIP-3009 authorization to fund the escrow. */
export interface EscrowPayload {
  payer: string;
  amount: string;
  requestHash: string;
  deliverBy: number;
  reviewWindow: number;
  authorization: {
    validAfter: string;
    validBefore: string;
    v: number;
    r: string;
    s: string;
  };
}

export interface PaymentResult {
  scheme: Scheme;
  network: Network;
  success: boolean;
  dealId?: string;
  txHash?: string;
  error?: string;
}

const b64encode = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const b64decode = <T>(h: string): T => JSON.parse(Buffer.from(h, "base64").toString("utf8")) as T;

export const encodePaymentPayload = (p: PaymentPayload): string => b64encode(p);
export const decodePaymentPayload = (h: string): PaymentPayload => b64decode<PaymentPayload>(h);
export const encodePaymentResult = (r: PaymentResult): string => b64encode(r);
export const decodePaymentResult = (h: string): PaymentResult => b64decode<PaymentResult>(h);
