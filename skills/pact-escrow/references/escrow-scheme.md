# The `escrow` x402 scheme — wire reference

x402 advertises a payment **scheme** in `PaymentRequirements.scheme` and matches it
to a facilitator that supports the `(scheme, network)` pair. `exact` (the production
scheme) is a push payment: settling *is* paying the provider, irreversibly. `escrow`
keeps the identical HTTP choreography but redirects what the signature funds — an
on-chain escrow bound to the request — so payment becomes conditional on delivery.

This file is the exact on-the-wire format, as implemented in
[`src/lib/x402.ts`](../../../src/lib/x402.ts) and
[`src/lib/escrowScheme.ts`](../../../src/lib/escrowScheme.ts) and exercised by the
verified demo. All amounts are USDC base units (6 decimals); `requestHash`/`nonce`
are 32-byte hex.

## 1. Challenge — `402 Payment Required`

The provider replies to an unpaid request with:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "escrow",
      "network": "eip155:688689",
      "asset": "0x…USDC",
      "payTo": "0x…provider",
      "maxAmountRequired": "100000",
      "resource": "https://provider/price?symbol=BTC",
      "description": "Price feed for BTC",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 600,
      "extra": {
        "escrow": "0x…PactEscrow",
        "requestHash": "0x…",
        "deliverBy": 1780941889,
        "reviewWindow": 120,
        "usdcName": "USD Coin (Pact Test)"
      }
    }
  ],
  "error": "payment required"
}
```

`extra` is what makes the scheme `escrow`: the escrow contract to fund, the
`requestHash` binding the deal to this request, the provider's `deliverBy` deadline,
the payer's `reviewWindow`, and the asset's EIP-712 domain `name` (needed to sign).

## 2. Payment — the `X-PAYMENT` header

The payer signs an **EIP-3009 `ReceiveWithAuthorization`** authorizing the escrow
(not the provider) to pull `maxAmountRequired`. No transaction, no gas. The signed
`nonce` is **bound to the deal**:

```
nonce = keccak256(abi.encode(
  chainId, escrow, payer, provider, token, amount, requestHash, deliverBy, reviewWindow))
```

so a relayer can use the signature to open *this one deal* and nothing else. The
header is `base64(JSON)` of:

```json
{
  "x402Version": 1,
  "scheme": "escrow",
  "network": "eip155:688689",
  "payload": {
    "payer": "0x…",
    "amount": "100000",
    "requestHash": "0x…",
    "deliverBy": 1780941889,
    "reviewWindow": 120,
    "authorization": { "validAfter": "0", "validBefore": "…", "v": 27, "r": "0x…", "s": "0x…" }
  }
}
```

## 3. Facilitator — `/verify` then `/settle`

Both take `{ paymentPayload, paymentRequirements }`.

- **`POST /verify`** (off-chain, cheap): recomputes the bound `nonce`, recovers the
  EIP-712 signer and checks it equals `payer`, confirms `amount`/`requestHash` match
  the requirements, and checks the payer's on-chain USDC balance. Returns
  `{ "isValid": true }` or `{ "isValid": false, "invalidReason": "…" }`.
- **`POST /settle`** (on-chain): the facilitator submits
  `escrow.openWithAuthorization(...)`, relaying the payer's signature. **The
  facilitator pays gas; it never touches the USDC** — the escrow pulls it directly
  from the payer. Returns `{ "success": true, "scheme": "escrow", "dealId": "4", "txHash": "0x…" }`.

`GET /supported` lists `{ x402Version, scheme, network }` for both `exact` and `escrow`.

## 4. Delivery + response — `X-PAYMENT-RESPONSE`

After settlement the provider does the work, then records delivery on-chain
(`escrow.deliver(dealId, keccak256(result))`), which starts the review window. It
returns `200` with the result body and an `X-PAYMENT-RESPONSE` header =
`base64(JSON)` of `{ scheme, network, success, dealId, txHash }`. The body also
echoes `dealId` so the caller can act on it.

## 5. Settlement is now *conditional* — the part `exact` cannot do

Funds sit in the escrow until a terminal action, each of which writes reputation:

| Action | Who | When | Result |
|---|---|---|---|
| `release(dealId)` | payer (anyone after `reviewUntil`) | result accepted / window elapsed | provider paid (minus fee) |
| `refundExpired(dealId)` | anyone | `deliverBy` passed, never delivered | payer refunded in full |
| `dispute(dealId)` | payer | within review window | freezes funds for the arbiter |
| `resolve(dealId, payerBps)` | arbiter | dispute open | split payer/provider |
| `resolveTimeout(dealId)` | anyone | `resolveBy` passed, no ruling | neutral 50/50 |

There is always a terminal exit, so funds can never be trapped.

## Adapting upstream x402 packages

The reference `x402`/`x402-express`/`x402-fetch` packages hard-code
`schemes = ["exact"]` (a zod enum) and branch on it in the facilitator. To run
`escrow` through upstream tooling rather than this self-contained implementation:
add `"escrow"` to that enum, add the `EscrowPayload` to the payload union, and add
an `escrow` branch to the facilitator's `verify`/`settle` dispatch (the verify/settle
logic is in [`escrowScheme.ts`](../../../src/lib/escrowScheme.ts)). This repo ships
the scheme standalone so it runs today without forking the published packages.
