const ESCROW = "0x22D56C7E5A3Cf9B745ca1D369D74BeEEB4201Ec7";

export default function Footer() {
  return (
    <footer className="site">
      <div className="inner">
        <span>
          <strong>Pact</strong> — the <span className="mono">escrow</span> scheme for x402 · built for the Pharos × Anvita Flow hackathon
        </span>
        <span className="row" style={{gap: 16}}>
          <a href="https://github.com/Nihal-Pandey-2302/pact" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a href={`https://atlantic.pharosscan.xyz/address/${ESCROW}`} target="_blank" rel="noreferrer">Live contract ↗</a>
          <span className="mono" style={{color: "var(--faint)"}}>Pharos Atlantic · 688689</span>
        </span>
      </div>
    </footer>
  );
}
