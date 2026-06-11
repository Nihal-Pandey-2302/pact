// The Steward's "brain": decide whether a delivered result satisfies the task,
// i.e. whether to RELEASE escrowed funds or DISPUTE.
//
// Two layers:
//   1. policyCheck — deterministic, always runs, needs no API key. It enforces the
//      hard guarantees: the returned body must match the hash committed on-chain,
//      the symbol must match, and the price must be present and plausible.
//   2. llmJudge — optional. If ANTHROPIC_API_KEY is set, Claude judges whether the
//      result genuinely answers the task (catching subtler failures than a rule can).
//
// The policy core can never be bypassed: an integrity/plausibility failure is an
// automatic dispute regardless of what the LLM thinks. When a key is present the
// LLM makes the final accept/reject call on results that pass the hard checks.

import Anthropic from "@anthropic-ai/sdk";
import {hashResult} from "../../src/lib/signing";

export interface Task {
  symbol: string;
  description: string;
}

export interface Verdict {
  accept: boolean;
  reason: string;
  by: "policy" | "llm";
  confidence?: number;
}

// Reference prices for the plausibility band. A real Steward would pull these from
// an independent oracle; here a static map is enough to catch a bogus delivery.
const REFERENCE: Record<string, number> = {BTC: 64000, ETH: 3400, PHRS: 0.42};

export function policyCheck(task: Task, result: unknown, committedHash?: string): Verdict {
  if (result === null || typeof result !== "object") {
    return {accept: false, reason: "no result body delivered", by: "policy"};
  }
  // Integrity: the body we were handed must hash to what the provider committed
  // on-chain via deliver(). A mismatch means the result was tampered after delivery.
  if (committedHash && hashResult(result) !== committedHash) {
    return {accept: false, reason: "result body does not match the on-chain resultHash", by: "policy"};
  }
  const r = result as {symbol?: unknown; price?: unknown};
  if (String(r.symbol).toUpperCase() !== task.symbol.toUpperCase()) {
    return {accept: false, reason: `wrong symbol: requested ${task.symbol}, got ${String(r.symbol)}`, by: "policy"};
  }
  const price = Number(r.price);
  if (!Number.isFinite(price) || price <= 0) {
    return {accept: false, reason: `implausible price: ${String(r.price)}`, by: "policy"};
  }
  const ref = REFERENCE[task.symbol.toUpperCase()];
  if (ref && (price < ref * 0.5 || price > ref * 1.5)) {
    return {accept: false, reason: `price ${price} is outside the plausible band for ${task.symbol}`, by: "policy"};
  }
  return {accept: true, reason: "result matches the request and is plausible", by: "policy"};
}

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    accept: {type: "boolean"},
    confidence: {type: "number"},
    reason: {type: "string"},
  },
  required: ["accept", "confidence", "reason"],
} as const;

export async function llmJudge(task: Task, result: unknown): Promise<Verdict | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const model = process.env.STEWARD_MODEL ?? "claude-opus-4-8";

  const response = await client.messages.create({
    model,
    max_tokens: 400,
    system:
      "You are the verification brain of an autonomous payment agent. The agent paid " +
      "for an API result and the funds are held in escrow. Decide whether the delivered " +
      "result genuinely satisfies the task. Accept only if it does. Be strict: a missing, " +
      "empty, zero, or off-topic value is not acceptable. Reply with JSON only.",
    messages: [
      {
        role: "user",
        content:
          `Task: ${task.description}\n` +
          `Requested symbol: ${task.symbol}\n` +
          `Delivered result: ${JSON.stringify(result)}\n\n` +
          `Does this result satisfy the task? Return {accept, confidence (0-1), reason}.`,
      },
    ],
    output_config: {format: {type: "json_schema", schema: JUDGE_SCHEMA}},
  });

  const block = response.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text : "{}";
  const j = JSON.parse(text) as {accept: boolean; confidence: number; reason: string};
  return {accept: !!j.accept, reason: j.reason, by: "llm", confidence: j.confidence};
}

/** Full verification: hard policy gate, then the LLM (if available) for the final call. */
export async function verifyDelivery(task: Task, result: unknown, committedHash?: string): Promise<Verdict> {
  const policy = policyCheck(task, result, committedHash);
  if (!policy.accept) return policy; // hard failure → always dispute
  const llm = await llmJudge(task, result).catch(() => null);
  return llm ?? policy;
}
