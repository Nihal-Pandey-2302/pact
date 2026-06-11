"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {api, type FullState, type Outcome, type ProviderState} from "../../lib/api";

interface TaskEvent {
  round: number;
  outcome: Outcome;
}

export default function StewardPage() {
  const [state, setState] = useState<FullState | null>(null);
  const [feed, setFeed] = useState<TaskEvent[]>([]);
  const [running, setRunning] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(() => api.state().then(setState).catch(() => {}), []);
  useEffect(() => {
    refresh();
    return () => esRef.current?.close();
  }, [refresh]);

  function run() {
    if (running) return;
    setFeed([]);
    setRunning(true);
    const es = new EventSource(api.stewardStreamUrl(6));
    esRef.current = es;
    es.addEventListener("state", (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("task", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {round: number; outcome: Outcome; state: FullState};
      setFeed((f) => [{round: d.round, outcome: d.outcome}, ...f]);
      setState(d.state);
    });
    const stop = () => {
      es.close();
      setRunning(false);
      refresh();
    };
    es.addEventListener("done", stop);
    es.addEventListener("error", stop);
  }

  const won: Record<string, number> = {};
  for (const t of feed) if (t.outcome.action === "released") won[t.outcome.provider] = (won[t.outcome.provider] ?? 0) + 1;
  const maxWon = Math.max(1, ...Object.values(won));

  return (
    <>
      <div className="row between" style={{marginTop: 28, flexWrap: "wrap", gap: 12}}>
        <div>
          <h1 className="hero" style={{fontSize: 34, margin: 0}}>
            Steward
          </h1>
          <p className="sub" style={{fontSize: 16, marginTop: 8}}>
            An autonomous agent buying work safely — reputation → escrow → verify → release or dispute.
          </p>
        </div>
        <button className="btn primary" onClick={run} disabled={running}>
          {running ? (
            <span className="row" style={{gap: 8}}>
              <span className="spinner" /> running…
            </span>
          ) : (
            "Run Steward ▷"
          )}
        </button>
      </div>

      <div className="grid cols-2" style={{marginTop: 22}}>
        {(state?.providers ?? []).map((p) => (
          <ProviderCard key={p.address} p={p} won={won[p.name] ?? 0} />
        ))}
      </div>

      {Object.keys(won).length > 0 && (
        <div className="card" style={{marginTop: 18}}>
          <h3 style={{marginTop: 0}}>Flywheel — jobs won</h3>
          {state?.providers.map((p) => (
            <div key={p.address} style={{marginBottom: 10}}>
              <div className="row between small">
                <span>{p.name}</span>
                <span className="mono">{won[p.name] ?? 0}</span>
              </div>
              <div className="bar">
                <span style={{width: `${((won[p.name] ?? 0) / maxWon) * 100}%`, background: p.name === "Sketchy" ? "var(--bad)" : "var(--good)"}} />
              </div>
            </div>
          ))}
          <p className="muted small" style={{marginBottom: 0}}>
            Deliver well and the Steward routes you the next job; deliver junk once and reputation routes you
            out.
          </p>
        </div>
      )}

      <h3 style={{margin: "26px 0 10px"}}>Task feed</h3>
      <div className="feed">
        {feed.length === 0 && <p className="muted small">Press “Run Steward” to watch it choose, pay, verify, and settle — live.</p>}
        {feed.map((t) => (
          <FeedItem key={t.round} t={t} />
        ))}
      </div>
    </>
  );
}

function ProviderCard({p, won}: {p: ProviderState; won: number}) {
  const tone = p.faulted > 0 ? "bad" : p.completed > 0 ? "good" : "muted";
  return (
    <div className="card">
      <div className="row between">
        <h3 style={{margin: 0}}>{p.name}</h3>
        <span className={`badge ${tone}`}>{p.name === "Sketchy" ? "shoddy" : "honest"}</span>
      </div>
      <div className="row between" style={{alignItems: "flex-end", marginTop: 8}}>
        <div className="score">
          {p.score}
          <span className="of"> /10000</span>
        </div>
        <div className="stat" style={{textAlign: "right"}}>
          <span className="v">{won}</span>
          <span className="l">jobs won</span>
        </div>
      </div>
      <div className="row" style={{gap: 22, marginTop: 14}}>
        <div className="stat">
          <span className="v" style={{color: "var(--good)"}}>
            {p.completed}
          </span>
          <span className="l">completed</span>
        </div>
        <div className="stat">
          <span className="v" style={{color: "var(--bad)"}}>
            {p.faulted}
          </span>
          <span className="l">faulted</span>
        </div>
        <div className="stat">
          <span className="v" style={{color: "var(--warn)"}}>
            {p.noShows}
          </span>
          <span className="l">no-shows</span>
        </div>
        <div className="stat">
          <span className="v">{p.volume}</span>
          <span className="l">volume USDC</span>
        </div>
      </div>
    </div>
  );
}

function FeedItem({t}: {t: TaskEvent}) {
  const o = t.outcome;
  const action = o.action;
  const cls = action === "released" ? "good" : action === "disputed" ? "bad" : "warn";
  return (
    <div className="item">
      <div className="row between">
        <span className="small mono muted">#{t.round}</span>
        <span className={`badge ${cls}`}>{action}</span>
      </div>
      <div className="small" style={{marginTop: 6}}>
        <b>{o.task.symbol}</b> → <b>{o.provider}</b>
      </div>
      <p className="muted small" style={{margin: "4px 0 0"}}>
        {o.reason}
      </p>
      {o.verdict && (
        <p className="muted small" style={{margin: "4px 0 0"}}>
          verified by {o.verdict.by}: {o.verdict.accept ? "accept" : "dispute"} — {o.verdict.reason}
        </p>
      )}
    </div>
  );
}
