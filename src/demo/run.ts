// End-to-end demo of the escrow scheme on Pharos: three deals showing what x402's
// `exact` scheme cannot do. Funds each deal gaslessly (EIP-3009, relayed by the
// facilitator), then drives it to each terminal state and prints reputation moving.
//
//   npm run demo
//
// Requires a deployed stack (.env) and gas (PHRS) on payer/provider/facilitator/deployer.

import "../lib/loadEnv";
import {privateKeyToAccount} from "viem/accounts";
import {pk, requireAddress, wallet} from "../lib/env";
import {pharosAtlantic} from "../lib/chains";
import {buildEscrowRequirements, createEscrowPayment, settleEscrowPayment} from "../lib/escrowScheme";
import {
  balanceOf,
  deliver,
  release,
  dispute,
  refundExpired,
  rule,
  mint,
  getScore,
  getRecord,
  usdcName,
} from "../lib/contracts";
import {hashString} from "../lib/signing";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);

const escrow = requireAddress("escrow");
const usdc = requireAddress("usdc");
const arbiter = requireAddress("arbiter");
const reputation = requireAddress("reputation");

const payerPk = pk("PAYER_PRIVATE_KEY");
const providerPk = pk("PROVIDER_PRIVATE_KEY");
const facilitatorPk = pk("FACILITATOR_PRIVATE_KEY");
const jurorPk = pk("DEPLOYER_PRIVATE_KEY"); // deployer is the arbiter's juror

const payer = privateKeyToAccount(payerPk);
const provider = wallet(providerPk).account.address;

async function openDeal(amount: bigint, label: string, deliverInSec: number, reviewSec: number) {
  const name = await usdcName(usdc).catch(() => "USD Coin");
  const requirements = buildEscrowRequirements({
    chainId: pharosAtlantic.id,
    escrow,
    usdc,
    usdcName: name,
    provider,
    amount,
    resource: `demo://${label}`,
    requestHash: hashString(`${label}-${Date.now()}-${Math.random()}`),
    deliverBy: Math.floor(Date.now() / 1000) + deliverInSec,
    reviewWindow: reviewSec,
    description: label,
  });
  const payment = await createEscrowPayment({account: payer, chainId: pharosAtlantic.id, requirements});
  const {dealId} = await settleEscrowPayment({facilitatorPk, payload: payment, requirements});
  return BigInt(dealId);
}

async function repLine(): Promise<string> {
  const score = await getScore(reputation, provider);
  const r = (await getRecord(reputation, provider)) as {
    completed: bigint;
    noShows: bigint;
    faulted: bigint;
    volume: bigint;
  };
  return `provider: score=${score}  completed=${r.completed}  noShows=${r.noShows}  faulted=${r.faulted}  vol=${fmt(r.volume)} USDC`;
}

async function main() {
  console.log("=== Pact — conditional settlement (escrow scheme) on Pharos Atlantic ===\n");
  console.log(`provider ${provider}`);
  console.log(`payer    ${payer.address}\n`);

  // Make sure the payer has USDC to escrow (open faucet).
  if ((await balanceOf(usdc, payer.address)) < 1_000_000n) {
    await mint(payerPk, usdc, payer.address, 100_000_000n);
  }
  console.log("start →", await repLine(), "\n");

  // A) honest provider — delivered and released
  console.log("── A) honest provider: deliver → payer releases ──");
  {
    const before = await balanceOf(usdc, provider);
    const id = await openDeal(100_000n, "A-honest", 600, 120);
    console.log(`   deal #${id}: 0.10 USDC escrowed (funded gaslessly via EIP-3009)`);
    await deliver(providerPk, escrow, id, hashString("price=64000"));
    console.log("   provider delivered");
    await release(payerPk, escrow, id);
    console.log(`   payer released → provider +${fmt((await balanceOf(usdc, provider)) - before)} USDC`);
    console.log("  ", await repLine(), "\n");
  }

  // B) no-show — refunded
  console.log("── B) provider no-show: deadline passes → payer refunded ──");
  {
    const before = await balanceOf(usdc, payer.address);
    const id = await openDeal(100_000n, "B-noshow", 15, 120);
    console.log(`   deal #${id}: provider never delivers; waiting out the deadline…`);
    await sleep(18_000);
    await refundExpired(payerPk, escrow, id);
    console.log(`   refundExpired → payer net ${fmt((await balanceOf(usdc, payer.address)) - before)} USDC (made whole)`);
    console.log("  ", await repLine(), "\n");
  }

  // C) bad delivery — disputed, arbiter splits
  console.log("── C) bad delivery: payer disputes → arbiter rules 80% to payer ──");
  {
    const provBefore = await balanceOf(usdc, provider);
    const payerBefore = await balanceOf(usdc, payer.address);
    const id = await openDeal(100_000n, "C-dispute", 600, 300);
    await deliver(providerPk, escrow, id, hashString("garbage-result"));
    console.log(`   deal #${id}: provider delivered a bad result`);
    await dispute(payerPk, escrow, id);
    console.log("   payer disputed");
    await rule(jurorPk, arbiter, id, 8000, "result did not match request");
    console.log(
      `   arbiter ruled 80% payer → provider +${fmt((await balanceOf(usdc, provider)) - provBefore)}, payer net ${fmt((await balanceOf(usdc, payer.address)) - payerBefore)} USDC`,
    );
    console.log("  ", await repLine(), "\n");
  }

  console.log("final →", await repLine());
  console.log("\nWith x402's `exact` scheme, B and C are impossible — the money was already gone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
