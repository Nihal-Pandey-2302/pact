"use client";

import {useEffect, useRef, useState} from "react";

/** Fades + lifts its children into view on scroll. Pure IntersectionObserver, no deps. */
export default function Reveal({children, delay = 0, className = ""}: {children: React.ReactNode; delay?: number; className?: string}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          o.disconnect();
        }
      },
      {threshold: 0.12},
    );
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${shown ? "in" : ""} ${className}`} style={{transitionDelay: `${delay}ms`}}>
      {children}
    </div>
  );
}
