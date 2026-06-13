import Link from "next/link";
import Reveal from "../../components/Reveal";

export default function How() {
  return (
    <>
      <section style={{padding: "48px 0 0"}}>
        <Reveal>
          <div className="eyebrow">the protocol</div>
          <h1 className="hero" style={{fontSize: "clamp(32px,5vw,52px)", margin: "14px 0 14px"}}>
            How <span className="gradient-text">Pact</span> works
          </h1>
          <p className="sub">
            Pact is a new <span className="mono">x402</span> payment <i>scheme</i> — <span className="mono">escrow</span> —
            that sits alongside the existing <span className="mono">exact</span> scheme and makes a payment conditional on
            delivery. Same HTTP handshake, same gasless signature; the only thing that changes is <i>what the signature
            funds</i>.
          </p>
        </Reveal>
      </section>

      {/* exact vs escrow */}
      <section className="section">
        <Reveal><h2>The problem: pay-first-and-pray</h2></Reveal>
        <Reveal delay={80}>
          <div className="grid cols-2">
            <div className="card">
              <span className="badge bad">x402 · exact</span>
              <h3 style={{marginTop: 12}}>A push payment</h3>
              <p className="muted">
                The payer&rsquo;s signature moves USDC <b>straight to the provider</b>, irreversibly, the instant it
                settles. If the result is junk — or never arrives — the money is already gone. Fine for a $0.001 call;
                reckless when one agent pays another for real work.
              </p>
            </div>
            <div className="card glow">
              <span className="badge good">Pact · escrow</span>
              <h3 style={{marginTop: 12}}>A conditional payment</h3>
              <p className="muted">
                The same signature funds an <b>on-chain escrow bound to the request</b>. Funds release only on delivery
                &amp; acceptance, refund on a no-show, or split by an arbiter on dispute — and every outcome writes
                reputation. The payer keeps recourse without giving up x402&rsquo;s ergonomics.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* the flow */}
      <section className="section">
        <Reveal><h2>One deal, end to end</h2></Reveal>
        <Reveal delay={60}><p className="sub" style={{marginBottom: 22}}>The payer never sends a transaction or pays gas to fund a deal — the facilitator relays the signature.</p></Reveal>
        <Reveal delay={120}>
          <div className="flow">
            <Flow ic={<Doc />} t="402 challenge" d="Provider answers with escrow PaymentRequirements: escrow address, requestHash, deliverBy, reviewWindow." />
            <Flow ic={<Pen />} t="Sign (EIP-3009)" d="Payer signs one ReceiveWithAuthorization. No transaction, no gas — the signature is the payment." />
            <Flow ic={<Lock />} t="Settle → escrow" d="Facilitator relays it: openWithAuthorization pulls the USDC into PactEscrow, bound to the deal." />
            <Flow ic={<Box />} t="Deliver" d="Provider does the work and commits keccak(result) on-chain, starting the review window." />
            <Flow ic={<Check />} t="Release" d="Payer releases → provider paid. Or dispute / refund / timeout — see below." />
          </div>
        </Reveal>
      </section>

      {/* outcomes */}
      <section className="section">
        <Reveal><h2>Every path is terminal — funds can never be trapped</h2></Reveal>
        <Reveal delay={80}>
          <div className="grid cols-2">
            <Outcome tag="release" cls="good" who="payer · or anyone after the review window" d="Result accepted → the provider is paid (minus a small protocol fee), and earns a completed deal." />
            <Outcome tag="refundExpired" cls="warn" who="permissionless" d="Provider no-show: once the deadline passes, anyone refunds the payer in full. The provider takes a no-show." />
            <Outcome tag="dispute → resolve" cls="bad" who="payer → arbiter juror" d="Bad delivery: the payer disputes within the window; a juror splits the escrow by ruling, and the provider is marked at fault." />
            <Outcome tag="resolveTimeout" cls="accent" who="permissionless" d="If the arbiter never rules, anyone triggers a neutral 50/50 split — so a disputed deal can&rsquo;t lock funds forever." />
          </div>
        </Reveal>
      </section>

      {/* reputation */}
      <section className="section">
        <Reveal><h2>Reputation you can&rsquo;t fake</h2></Reveal>
        <Reveal delay={80}>
          <div className="card">
            <p className="muted" style={{marginTop: 0}}>
              <span className="mono">PactReputation</span> is writable <b>only by the escrow contract</b>, so a score is
              a byproduct of real, settled deals — it can&rsquo;t be self-reported, bought, or sybil-farmed without
              actually completing paid work.
            </p>
            <div className="grid cols-3" style={{marginTop: 16, gap: 12}}>
              <Metric v="completed" c="good" d="delivered &amp; released (incl. disputes won)" />
              <Metric v="faulted" c="bad" d="disputes resolved against the provider" />
              <Metric v="no-shows" c="warn" d="funded but never delivered" />
            </div>
            <p className="muted small" style={{marginTop: 16, marginBottom: 0}}>
              <span className="mono">score = good ÷ (good + 2·bad)</span> &nbsp;·&nbsp; one failure costs more than one
              success earns, and <span className="mono">0</span> means &ldquo;no history yet.&rdquo;
            </p>
          </div>
        </Reveal>
      </section>

      {/* cascade */}
      <section className="section">
        <Reveal><h2>The cascade: three Skills become an Agent</h2></Reveal>
        <Reveal delay={80}>
          <div className="card">
            <div className="flow" style={{gridTemplateColumns: "repeat(3,1fr)"}}>
              <Flow ic={<Lock />} t="pact-escrow" d="Pay or offer an escrow-protected endpoint." />
              <Flow ic={<Star />} t="pact-reputation" d="Check a counterparty before paying." />
              <Flow ic={<Scale />} t="pact-arbiter" d="Open or rule on a dispute." />
            </div>
            <div className="center" style={{margin: "20px 0 6px", color: "var(--faint)", fontSize: 20}}>↓</div>
            <div className="outcome glow" style={{justifyContent: "center", textAlign: "center"}}>
              <div>
                <span className="tag accent">Steward agent</span>
                <p className="muted" style={{margin: "10px 0 0"}}>
                  An autonomous buyer built from nothing but those three Skills: <b>check reputation → escrow → verify
                  the result → release or dispute</b>, over and over. Good providers compound; bad ones get routed out.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <Reveal>
        <div className="card glow center" style={{margin: "10px 0 20px"}}>
          <h3 style={{fontSize: 20}}>See it run</h3>
          <p className="muted" style={{maxWidth: 560, margin: "6px auto 18px"}}>Drive a single deal yourself, or watch the agent route a marketplace by reputation — both live against Pharos Atlantic.</p>
          <div className="row" style={{gap: 12, justifyContent: "center", flexWrap: "wrap"}}>
            <Link href="/buy" className="btn primary lg">Try the Buyer →</Link>
            <Link href="/steward" className="btn lg">Watch the Steward</Link>
          </div>
        </div>
      </Reveal>
    </>
  );
}

function Flow({ic, t, d}: {ic: React.ReactNode; t: string; d: string}) {
  return (
    <div className="flow-step">
      <div className="ic">{ic}</div>
      <div className="t">{t}</div>
      <div className="d">{d}</div>
    </div>
  );
}
function Outcome({tag, cls, who, d}: {tag: string; cls: string; who: string; d: string}) {
  return (
    <div className="outcome">
      <span className={`tag ${cls}`}>{tag}</span>
      <div>
        <div className="small" style={{color: "var(--faint)", marginBottom: 4}}>{who}</div>
        <div className="small" style={{lineHeight: 1.55}}>{d}</div>
      </div>
    </div>
  );
}
function Metric({v, c, d}: {v: string; c: string; d: React.ReactNode}) {
  return (
    <div style={{border: "1px solid var(--border)", borderRadius: 13, padding: "13px 15px", background: "var(--surface-solid)"}}>
      <div className="mono" style={{color: `var(--${c})`, fontWeight: 600}}>{v}</div>
      <div className="muted small" style={{marginTop: 4}}>{d}</div>
    </div>
  );
}

/* minimal stroke icons (currentColor) */
const S = {width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: {color: "var(--accent)"}};
const Doc = () => (<svg {...S}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>);
const Pen = () => (<svg {...S}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);
const Lock = () => (<svg {...S}><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>);
const Box = () => (<svg {...S}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></svg>);
const Check = () => (<svg {...S}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>);
const Star = () => (<svg {...S}><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" /></svg>);
const Scale = () => (<svg {...S}><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0zM17 7l-3 6a3 3 0 0 0 6 0z" /></svg>);
