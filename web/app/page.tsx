import Link from "next/link";
import Reveal from "../components/Reveal";

const ESCROW = "0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7";
const contracts = [
  ["PactEscrow", "0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7"],
  ["PactReputation", "0x0E8F77A0aFbB10f09D1e1C70FF669A135FAFfA95"],
  ["PactArbiter", "0x728cC2c144f16B2ea93A754607a590289456101c"],
  ["MockUSDC", "0xBe39C0e0Ec029aaab71224ad73eFfCEEDA677427"],
];

export default function Home() {
  return (
    <>
      <section style={{padding: "56px 0 8px"}}>
        <Reveal>
          <a className="pill" href={`https://atlantic.pharosscan.xyz/address/${ESCROW}`} target="_blank" rel="noreferrer">
            <span className="dot ok" /> Live on Pharos Atlantic · chain 688689
          </a>
        </Reveal>
        <Reveal delay={60}>
          <h1 className="hero">
            Agents can pay over HTTP.
            <br />
            Pact lets them pay <span className="gradient-text">on delivery</span>.
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className="sub">
            x402&rsquo;s production scheme, <span className="mono">exact</span>, is a push payment — irreversible the
            moment it executes. Pact adds <span className="mono">escrow</span>: the payer&rsquo;s USDC is locked on a
            single signature and released only when the work is delivered and accepted — refunded on a no-show, split
            by an arbiter on dispute, with reputation earned on-chain.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div className="row" style={{gap: 12, marginTop: 26, flexWrap: "wrap"}}>
            <Link href="/buy" className="btn primary lg">Try the Buyer →</Link>
            <Link href="/steward" className="btn lg">Watch the Steward</Link>
            <Link href="/how" className="btn ghost lg">How it works</Link>
          </div>
        </Reveal>
      </section>

      <Reveal delay={120}>
        <div className="grid cols-3" style={{marginTop: 44}}>
          <Feature title="Conditional settlement" body={<>Funds sit in <span className="mono">PactEscrow</span> until a terminal action — release, refund, or an arbiter split. Money can never be trapped.</>} />
          <Feature title="Earned reputation" body={<>Scores are written only by the escrow contract, as a byproduct of settled deals — impossible to fake, buy, or self-attest.</>} />
          <Feature title="Real x402" body={<>Same <span className="mono">402</span> / <span className="mono">X-PAYMENT</span> ergonomics and the same gasless EIP-3009 primitive as x402&rsquo;s <span className="mono">exact</span> scheme — just conditional.</>} />
        </div>
      </Reveal>

      <Reveal>
        <div className="grid cols-2" style={{marginTop: 18}}>
          <Link href="/buy" className="card link glow">
            <div className="eyebrow">pay-on-delivery</div>
            <h3 style={{fontSize: 20, marginTop: 8}}>Buyer →</h3>
            <p className="muted">
              Call an escrow-protected endpoint. Watch the <span className="mono">402</span> challenge, the gasless
              payment funding the escrow, the delivered result and an automatic verdict — then release or dispute.
              Sign with <b>MetaMask</b> or a one-click burner.
            </p>
          </Link>
          <Link href="/steward" className="card link glow">
            <div className="eyebrow">autonomous a2a commerce</div>
            <h3 style={{fontSize: 20, marginTop: 8}}>Steward →</h3>
            <p className="muted">
              An agent that buys work safely: checks reputation, escrows payment, verifies the result, releases or
              disputes — live. Watch the reputation flywheel decide who gets paid next across honest, shoddy, and
              no-show providers.
            </p>
          </Link>
        </div>
      </Reveal>

      <Reveal>
        <div className="card" style={{marginTop: 18}}>
          <div className="row between" style={{flexWrap: "wrap", gap: 10}}>
            <h3 style={{margin: 0}}>Deployed &amp; verified on Pharos Atlantic</h3>
            <span className="chip mono">lifecycle ran on-chain · score 0 → 10000 → 3333 → 2000</span>
          </div>
          <div className="grid cols-2" style={{marginTop: 14, gap: 10}}>
            {contracts.map(([name, addr]) => (
              <a key={addr} className="row between" href={`https://atlantic.pharosscan.xyz/address/${addr}`} target="_blank" rel="noreferrer"
                 style={{border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", background: "var(--surface-solid)"}}>
                <span style={{fontWeight: 600}}>{name}</span>
                <span className="mono small muted">{addr.slice(0, 8)}…{addr.slice(-6)} ↗</span>
              </a>
            ))}
          </div>
        </div>
      </Reveal>
    </>
  );
}

function Feature({title, body}: {title: string; body: React.ReactNode}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{body}</p>
    </div>
  );
}
