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
            <path d="M12 2.5 L19.5 5.3 V11 C19.5 15.8 16 19.3 12 20.8 C8 19.3 4.5 15.8 4.5 11 V5.3 Z" fill="#fff" fillOpacity="0.96" />
            <path d="M8.6 12 l2.3 2.3 l4.5-4.6" stroke="#6d28d9" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
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
