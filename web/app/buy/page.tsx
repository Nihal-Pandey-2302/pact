"use client";

import {useCallback, useEffect, useState} from "react";
import {type Address} from "viem";
import {api, type BuyResult, type Config, type FullState} from "../../lib/api";
import {connect, signTypedDataV4, releaseDeal, disputeDeal, mintUsdc, hasWallet, short} from "../../lib/wallet";

const SYMBOLS = ["BTC", "ETH", "PHRS"];

export default function Buy() {
  const [provider, setProvider] = useState("Acme");
  const [symbol, setSymbol] = useState("BTC");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0); // 0 idle, 1 challenge, 2 funded, 3 delivered
  const [buy, setBuy] = useState<BuyResult | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<FullState | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [account, setAccount] = useState<Address | null>(null);

  const refresh = useCallback(() => api.state().then(setState).catch(() => {}), []);
  useEffect(() => {
    refresh();
    api.config().then(setCfg).catch(() => {});
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  async function doConnect() {
    setErr(null);
    try {
      setAccount(await connect());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function getUsdc() {
    if (!account || !cfg) return;
    setBusy(true);
    setErr(null);
    try {
      await mintUsdc(account, cfg.usdc as Address);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setErr(null);
    setBuy(null);
    setSettled(null);
    setStage(1);
    try {
      let res: BuyResult;
      if (account) {
        // wallet path: gateway prepares typed data → MetaMask signs → gateway relays
        const prep = await api.buyPrepare(provider, symbol, account);
        setStage(2);
        const signature = await signTypedDataV4(account, prep.typedData);
        res = await api.buySubmit({
          provider, symbol, requirements: prep.requirements,
          validAfter: prep.validAfter, validBefore: prep.validBefore, signature, payer: account,
        });
      } else {
        // burner path: gateway signs with its own test account
        await new Promise((r) => setTimeout(r, 350));
        setStage(2);
        res = await api.buy(provider, symbol);
      }
      if (!res.ok) throw new Error(res.detail ?? "purchase failed");
      setStage(3);
      setBuy(res);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
      setStage(0);
    } finally {
      setBusy(false);
    }
  }

  async function settle(action: "release" | "dispute") {
    if (!buy?.dealId) return;
    setBusy(true);
    setErr(null);
    try {
      if (account) {
        // A connected wallet must sign for itself — never fall back to the gateway's
        // key (it isn't the deal's payer, so its release/dispute would revert).
        if (!cfg) throw new Error("gateway config not loaded — cannot resolve the escrow address");
        if (action === "release") {
          await releaseDeal(account, cfg.escrow as Address, buy.dealId);
          setSettled("Released");
        } else {
          await disputeDeal(account, cfg.escrow as Address, buy.dealId); // payer disputes from their wallet
          await api.rule(buy.dealId); // arbiter (separate authority) rules
          setSettled("Resolved");
        }
      } else {
        const r = await api.settle(buy.dealId, action);
        setSettled(r.state);
      }
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const verdict = buy?.verdict;
  const recommend = verdict ? (verdict.accept ? "release" : "dispute") : null;

  return (
    <>
      <div className="row between" style={{marginTop: 28, flexWrap: "wrap", gap: 12}}>
        <div>
          <h1 className="hero" style={{fontSize: 34, margin: 0}}>
            Buyer
          </h1>
          <p className="sub" style={{fontSize: 16, marginTop: 8}}>
            Pay an escrow-protected endpoint. Funds are locked, not sent — you decide whether the result
            earns them.
          </p>
        </div>
        <div className="row" style={{gap: 8}}>
          {account ? (
            <>
              <span className="chip">
                <span className="dot ok" /> wallet {short(account)}
              </span>
              <button className="btn" onClick={getUsdc} disabled={busy}>
                Get test USDC
              </button>
            </>
          ) : (
            <>
              <span className="chip">burner (gateway signs)</span>
              <button className="btn" onClick={doConnect} disabled={!hasWallet()} title={hasWallet() ? "" : "install MetaMask"}>
                Connect Wallet
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid cols-2" style={{marginTop: 18, alignItems: "start"}}>
        {/* left: the flow */}
        <div className="card">
          <div className="row" style={{gap: 10, flexWrap: "wrap"}}>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={busy}>
              <option value="Acme">Acme (honest)</option>
              <option value="Sketchy">Sketchy (shoddy)</option>
            </select>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={busy}>
              {SYMBOLS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button className="btn primary" onClick={run} disabled={busy}>
              {busy && stage < 3 ? "working…" : account ? "Sign & Pay" : "Request & Pay"}
            </button>
          </div>

          <div className="steps" style={{marginTop: 18}}>
            <Step n={1} active={stage === 1} done={stage > 1} label="402 challenge — escrow PaymentRequirements" />
            <Step n={2} active={stage === 2} done={stage > 2} label={account ? "MetaMask signs EIP-3009 → escrow funded (gasless)" : "Signed EIP-3009 → escrow funded (gasless)"} />
            <Step n={3} active={stage === 3 && !settled} done={stage === 3} label="Result delivered + verified" />
          </div>

          {err && (
            <p className="small" style={{color: "var(--bad)", marginTop: 14}}>
              {err}
            </p>
          )}

          {buy && (
            <div style={{marginTop: 18}}>
              <div className="row between">
                <span className="muted small">deal</span>
                <span className="mono">#{buy.dealId}</span>
              </div>
              <div className="row between">
                <span className="muted small">result</span>
                <span className="mono small">{JSON.stringify(buy.result)}</span>
              </div>
              <div className="row between" style={{marginTop: 8}}>
                <span className="muted small">verdict</span>
                {verdict ? (
                  <span className={`badge ${verdict.accept ? "good" : "bad"}`}>
                    {verdict.accept ? "ACCEPT" : "DISPUTE"} · {verdict.by}
                  </span>
                ) : (
                  <span className="badge muted">no delivery</span>
                )}
              </div>
              {verdict && (
                <p className="muted small" style={{marginTop: 6}}>
                  {verdict.reason}
                </p>
              )}

              {!settled ? (
                <div className="row" style={{marginTop: 14, gap: 10}}>
                  <button className={`btn ${recommend === "release" ? "good" : ""}`} onClick={() => settle("release")} disabled={busy || buy.dealState !== "Delivered"}>
                    Release → pay provider
                  </button>
                  <button className={`btn ${recommend === "dispute" ? "bad" : ""}`} onClick={() => settle("dispute")} disabled={busy || buy.dealState !== "Delivered"}>
                    Dispute → arbiter
                  </button>
                  {recommend && <span className="muted small">suggested: {recommend}</span>}
                </div>
              ) : (
                <p className="small" style={{marginTop: 14}}>
                  deal #{buy.dealId} → <span className="badge good">{settled}</span>
                  {settled === "Released" ? " — provider paid." : " — funds returned to you; provider marked at fault."}
                </p>
              )}
            </div>
          )}
        </div>

        {/* right: live state */}
        <div className="card">
          <div className="row between">
            <h3 style={{margin: 0}}>Live on-chain state</h3>
            <span className="chip mono">{state ? `gateway ${state.buyer.usdc} USDC` : "…"}</span>
          </div>
          <table style={{marginTop: 10}}>
            <thead>
              <tr>
                <th>provider</th>
                <th>score</th>
                <th>done</th>
                <th>faults</th>
              </tr>
            </thead>
            <tbody>
              {state?.providers.map((p) => (
                <tr key={p.address}>
                  <td>
                    {p.name} <span className="muted mono">{short(p.address)}</span>
                  </td>
                  <td className="mono">{p.score}</td>
                  <td className="mono">{p.completed}</td>
                  <td className="mono">{p.faulted}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{margin: "18px 0 8px", fontSize: 14}} className="muted">
            recent deals
          </h3>
          <table>
            <tbody>
              {state?.deals.slice(0, 8).map((d) => (
                <tr key={d.id}>
                  <td className="mono">#{d.id}</td>
                  <td>{d.provider}</td>
                  <td className="mono">{d.amount}</td>
                  <td>
                    <DealBadge state={d.state} />
                  </td>
                </tr>
              ))}
              {!state?.deals.length && (
                <tr>
                  <td className="muted small">no deals yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Step({n, active, done, label}: {n: number; active: boolean; done: boolean; label: string}) {
  return (
    <div className={`step${active ? " active" : ""}${done ? " done" : ""}`}>
      <span className="n">{done ? "✓" : active ? <span className="spinner" /> : n}</span>
      <span className="small">{label}</span>
    </div>
  );
}

function DealBadge({state}: {state: string}) {
  const cls = state === "Released" ? "good" : state === "Refunded" || state === "Resolved" ? "warn" : state === "Disputed" ? "bad" : "muted";
  return <span className={`badge ${cls}`}>{state}</span>;
}
