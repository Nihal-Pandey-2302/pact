"use client";

import {usePathname} from "next/navigation";
import Link from "next/link";
import {useEffect, useState} from "react";
import {api, type Config} from "../lib/api";

const links = [
  {href: "/", label: "Overview"},
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
      api
        .config()
        .then((c) => alive && (setCfg(c), setUp(true)))
        .catch(() => alive && setUp(false));
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
        Pact<span>.</span>
      </Link>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={`link${path === l.href ? " active" : ""}`}>
          {l.label}
        </Link>
      ))}
      <div className="spacer" />
      <span className="chip" title={up ? "gateway connected" : "start: npm run gateway"}>
        <span className={`dot ${up === null ? "" : up ? "ok" : "off"}`} />
        {up === null ? "connecting…" : up ? `chain ${cfg?.chainId ?? ""}` : "gateway offline"}
      </span>
      {cfg && (
        <span className="chip" title="result verifier">
          verifier: {cfg.verifier.includes("Claude") ? "Claude" : "policy"}
        </span>
      )}
    </nav>
  );
}
