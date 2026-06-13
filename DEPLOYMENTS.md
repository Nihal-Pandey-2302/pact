# Live deployment — Pharos Atlantic

Pact is deployed and exercised on the **Pharos Atlantic testnet** (chain `688689`,
RPC `https://atlantic.dplabs-internal.com`, explorer `https://atlantic.pharosscan.xyz`).

## Contracts

| Contract | Address | Explorer |
|---|---|---|
| PactEscrow | `0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7` | [view](https://atlantic.pharosscan.xyz/address/0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7) |
| PactReputation | `0x0E8F77A0aFbB10f09D1e1C70FF669A135FAFfA95` | [view](https://atlantic.pharosscan.xyz/address/0x0E8F77A0aFbB10f09D1e1C70FF669A135FAFfA95) |
| PactArbiter | `0x728cC2c144f16B2ea93A754607a590289456101c` | [view](https://atlantic.pharosscan.xyz/address/0x728cC2c144f16B2ea93A754607a590289456101c) |
| MockUSDC (6-dec, EIP-3009, open `mint`) | `0xBe39C0e0Ec029aaab71224ad73eFfCEEDA677427` | [view](https://atlantic.pharosscan.xyz/address/0xBe39C0e0Ec029aaab71224ad73eFfCEEDA677427) |

Deployer / owner / arbiter juror: `0x81bE69d0868a863c9993E2F7657B6Fda794efE4d`

## Verified live (the escrow scheme, end to end on Atlantic)

`ENV=production npm run demo` drove all three terminal states on-chain:

- **honest → release** — provider delivered, payer released, provider paid 0.10 USDC, reputation `score 10000`.
- **no-show → refund** — provider never delivered; after the deadline `refundExpired` made the payer whole, reputation `score 3333`.
- **bad delivery → dispute → arbiter** — payer disputed, the arbiter split funds to the payer, provider marked `faulted`.

Funding is gasless for the payer (EIP-3009 `ReceiveWithAuthorization`, relayed by the
facilitator). The provider, facilitator, buyer, and the two demo providers are funded
with a little PHRS from the deployer; MockUSDC is an open faucet mint.

## Reproduce

```bash
# fill .env.production with a funded DEPLOYER_PRIVATE_KEY (faucet: testnet.pharosnetwork.xyz)
cd contracts
forge script script/Deploy.s.sol --rpc-url https://atlantic.dplabs-internal.com --broadcast
# copy the printed addresses into .env.production + skills/pact-escrow/assets/networks.json, then:
cd .. && ENV=production npm run demo
```
