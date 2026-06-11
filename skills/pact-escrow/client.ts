// Reference client for the x402 `escrow` scheme.
//
// payAndFetch() does the full handshake: request -> 402 challenge -> sign an
// EIP-3009 funding authorization (no tx, no gas) -> retry with X-PAYMENT -> get
// the result while funds sit in escrow. The caller then chooses to release (pay)
// or dispute. This is the agent-facing primitive the SKILL.md wraps.

import {type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {pk, requireAddress} from "../../src/lib/env";
import {pharosAtlantic} from "../../src/lib/chains";
import {createEscrowPayment} from "../../src/lib/escrowScheme";
import {release, dispute, getDeal, STATE} from "../../src/lib/contracts";
import {
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  encodePaymentPayload,
  decodePaymentResult,
  type PaymentRequiredBody,
  type PaymentResult,
} from "../../src/lib/x402";

export interface PayAndFetchResult {
  status: number;
  body: unknown;
  payment?: PaymentResult;
}

export async function payAndFetch(url: string, payerPk: Hex): Promise<PayAndFetchResult> {
  const account = privateKeyToAccount(payerPk);

  const first = await fetch(url);
  if (first.status !== 402) {
    return {status: first.status, body: await safeJson(first)};
  }

  const required = (await first.json()) as PaymentRequiredBody;
  const requirements = required.accepts[0];
  if (!requirements) throw new Error("402 had no payment requirements");

  const payload = await createEscrowPayment({account, chainId: pharosAtlantic.id, requirements});

  const paid = await fetch(url, {headers: {[PAYMENT_HEADER]: encodePaymentPayload(payload)}});
  const respHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
  return {
    status: paid.status,
    body: await safeJson(paid),
    payment: respHeader ? decodePaymentResult(respHeader) : undefined,
  };
}

async function safeJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    return await r.text();
  }
}

// --- CLI: tsx skills/pact-escrow/client.ts <url> [--release|--dispute] ---
async function main() {
  const url = process.argv[2] ?? "http://localhost:4021/price?symbol=BTC";
  const action = process.argv.includes("--release") ? "release" : process.argv.includes("--dispute") ? "dispute" : "none";
  const payerPk = pk("PAYER_PRIVATE_KEY");

  console.log(`→ calling ${url}`);
  const out = await payAndFetch(url, payerPk);
  console.log(`← ${out.status}`);
  console.log(JSON.stringify(out.body, null, 2));

  const dealId = out.payment?.dealId;
  if (!dealId) return;

  const escrow = requireAddress("escrow");
  const before = await getDeal(escrow, BigInt(dealId));
  console.log(`deal #${dealId} state=${STATE[before.state]} (funds in escrow)`);

  if (action === "release") {
    await release(payerPk, escrow, BigInt(dealId));
    console.log(`released deal #${dealId} → provider paid`);
  } else if (action === "dispute") {
    await dispute(payerPk, escrow, BigInt(dealId));
    console.log(`disputed deal #${dealId} → awaiting arbiter ruling`);
  } else {
    console.log("no action taken; pass --release to pay the provider or --dispute to challenge");
  }
}

if (process.argv[1]?.endsWith("client.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
