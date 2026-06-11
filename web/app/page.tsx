import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1 className="hero">
        Agents can pay over HTTP.<br />
        Pact lets them pay <span>on delivery</span>.
      </h1>
      <p className="sub">
        x402&rsquo;s <span className="mono">exact</span> scheme is a push payment — irreversible the moment
        it executes. Pact adds <span className="mono">escrow</span>: the payer&rsquo;s USDC is locked on a
        single signed authorization, released only when the work is delivered and accepted — refunded on a
        no-show, split by an arbiter on dispute, with reputation earned on-chain. This is that, running live
        on Pharos.
      </p>

      <div className="grid cols-2" style={{marginTop: 36}}>
        <Link href="/buy" className="card link">
          <h3>Buyer — pay on delivery →</h3>
          <p className="muted">
            Call an escrow-protected endpoint. Watch the <span className="mono">402</span> challenge, the
            gasless EIP-3009 payment funding the escrow, the delivered result, and an automatic verdict —
            then release the funds or dispute. Try the honest provider and the shoddy one.
          </p>
        </Link>
        <Link href="/steward" className="card link">
          <h3>Steward — autonomous agent commerce →</h3>
          <p className="muted">
            An agent that buys work safely: checks reputation, escrows payment, verifies the result, and
            releases or disputes — over and over. Watch the reputation flywheel decide who gets paid next.
          </p>
        </Link>
      </div>

      <div className="grid cols-3" style={{marginTop: 18}}>
        <div className="card">
          <h3>Conditional settlement</h3>
          <p className="muted">Funds sit in <span className="mono">PactEscrow</span> until a terminal action — release, refund, or an arbiter split. Money can never be trapped.</p>
        </div>
        <div className="card">
          <h3>Earned reputation</h3>
          <p className="muted">Scores are written only by the escrow contract, as a byproduct of settled deals — impossible to fake, buy, or self-attest.</p>
        </div>
        <div className="card">
          <h3>Real x402</h3>
          <p className="muted">Same <span className="mono">402</span> / <span className="mono">X-PAYMENT</span> ergonomics and the same EIP-3009 primitive as x402&rsquo;s <span className="mono">exact</span> scheme — just conditional.</p>
        </div>
      </div>

      <p className="muted small" style={{marginTop: 24}}>
        Backend not connected? Start it with <span className="kbd">npm run gateway</span> (and an anvil +
        deploy, per the RUNBOOK).
      </p>
    </>
  );
}
