"use client";

import {usePathname} from "next/navigation";
import Link from "next/link";
import {useEffect, useState} from "react";
import {api, type Config} from "../lib/api";

const links = [
  {href: "/", label: "Overview"},
  {href: "/how", label: "How it works"},
  {href: "/buy", label: "Buyer"},
  {href: "/steward", label: "Steward"},
];

export default function Nav() {
  const path = usePathname();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      api.config().then((c) => alive && (setCfg(c), setUp(true))).catch(() => alive && setUp(false));
    ping();
    const t = setInterval(ping, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <nav className="top">
      <Link href="/" className="brand">
        <span className="mark">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M22 12 17 3.34 7 3.34 2 12 7 20.66 17 20.66Z" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8 12.4 10.6 15 16 9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        Pact
      </Link>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={`link${path === l.href ? " active" : ""}`}>
          {l.label}
        </Link>
      ))}
      <div className="spacer" />
      <span className="chip" title={up ? "gateway connected" : "start the gateway: npm run gateway"}>
        <span className={`dot ${up === null ? "" : up ? "ok" : "off"}`} />
        {up === null ? "connecting…" : up ? `Atlantic · ${cfg?.chainId ?? ""}` : "gateway offline"}
      </span>
      {cfg && (
        <span className="chip" title="result verifier">
          {cfg.verifier.includes("Claude") ? "Claude verifier" : "policy verifier"}
        </span>
      )}
    </nav>
  );
}
