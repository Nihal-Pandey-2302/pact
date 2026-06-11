import express from "express";
import {pk} from "../lib/env";
import {networkId, pharosAtlantic} from "../lib/chains";
import {verifyEscrowPayment, settleEscrowPayment} from "../lib/escrowScheme";

// The Pact facilitator. Like any x402 facilitator it exposes /supported, /verify
// and /settle — but it advertises and settles the `escrow` scheme in addition to
// `exact`. For escrow, "settle" means funding the on-chain escrow from the payer's
// relayed signature; the facilitator pays gas, never the USDC.

const app = express();
app.use(express.json());

const PORT = Number(process.env.FACILITATOR_PORT ?? 4020);
const NETWORK = networkId(pharosAtlantic.id);

app.get("/supported", (_req, res) => {
  res.json({
    kinds: [
      {x402Version: 1, scheme: "exact", network: NETWORK},
      {x402Version: 1, scheme: "escrow", network: NETWORK},
    ],
  });
});

app.post("/verify", async (req, res) => {
  try {
    const {paymentPayload, paymentRequirements} = req.body;
    const r = await verifyEscrowPayment(paymentPayload, paymentRequirements);
    res.json({isValid: r.ok, invalidReason: r.reason ?? null});
  } catch (e: unknown) {
    res.status(400).json({isValid: false, invalidReason: (e as Error)?.message ?? "verify error"});
  }
});

app.post("/settle", async (req, res) => {
  try {
    const {paymentPayload, paymentRequirements} = req.body;
    const out = await settleEscrowPayment({
      facilitatorPk: pk("FACILITATOR_PRIVATE_KEY"),
      payload: paymentPayload,
      requirements: paymentRequirements,
    });
    res.json({success: true, scheme: "escrow", network: NETWORK, dealId: out.dealId, txHash: out.txHash});
  } catch (e: unknown) {
    res.status(400).json({success: false, error: (e as Error)?.message ?? "settle error"});
  }
});

app.listen(PORT, () => {
  console.log(`Pact facilitator listening on :${PORT}  (network ${NETWORK})`);
  console.log("  supports schemes: exact, escrow");
});
