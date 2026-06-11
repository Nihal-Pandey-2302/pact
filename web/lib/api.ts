// Thin client for the Pact gateway (npm run gateway, default :4040).

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4040";

export interface ProviderState {
  name: string;
  address: string;
  url: string;
  score: number;
  completed: number;
  faulted: number;
  noShows: number;
  volume: string;
}
export interface Deal {
  id: string;
  state: string;
  provider: string;
  amount: string;
}
export interface FullState {
  buyer: {address: string; usdc: string};
  providers: ProviderState[];
  deals: Deal[];
}
export interface Verdict {
  accept: boolean;
  reason: string;
  by: "policy" | "llm";
  confidence?: number;
}
export interface BuyResult {
  ok: boolean;
  provider: string;
  dealId?: string;
  dealState?: string;
  result?: unknown;
  verdict?: Verdict | null;
  detail?: string;
}
export interface Config {
  chainId: number;
  escrow: string;
  usdc: string;
  buyer: string;
  env?: string;
  rpc?: string;
  providers: {name: string; address: string}[];
  verifier: string;
}
export interface PrepareResult {
  typedData: unknown;
  requirements: unknown;
  validAfter: string;
  validBefore: string;
  symbol: string;
}
export interface Outcome {
  task: {symbol: string; description: string};
  provider: string;
  reason: string;
  dealId?: string;
  verdict?: Verdict;
  action: "released" | "disputed" | "refunded" | "failed";
  detail: string;
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  config: () => fetch(`${GATEWAY}/api/config`).then(j<Config>),
  state: () => fetch(`${GATEWAY}/api/state`).then(j<FullState>),
  buy: (provider: string, symbol: string) =>
    fetch(`${GATEWAY}/api/buy`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({provider, symbol}),
    }).then(j<BuyResult>),
  settle: (dealId: string, action: "release" | "dispute") =>
    fetch(`${GATEWAY}/api/settle`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({dealId, action}),
    }).then(j<{ok: boolean; dealId: string; state: string}>),
  // wallet path: gateway prepares the typed data, the wallet signs, gateway relays
  buyPrepare: (provider: string, symbol: string, payer: string) =>
    fetch(`${GATEWAY}/api/buy/prepare`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({provider, symbol, payer}),
    }).then(j<PrepareResult>),
  buySubmit: (body: {provider: string; symbol: string; requirements: unknown; validAfter: string; validBefore: string; signature: string; payer: string}) =>
    fetch(`${GATEWAY}/api/buy/submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    }).then(j<BuyResult>),
  rule: (dealId: string) =>
    fetch(`${GATEWAY}/api/rule`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({dealId}),
    }).then(j<{ok: boolean; dealId: string; state: string}>),
  stewardStreamUrl: (rounds = 6) => `${GATEWAY}/api/steward/stream?rounds=${rounds}`,
};

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
