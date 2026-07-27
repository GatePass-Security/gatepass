"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { GatepassLogo } from "@/components/landing/GatepassLogo";

const LINKS = [
  { href: "#detections", label: "Detections" },
  { href: "#how", label: "How it works" },
  { href: "#services", label: "Surfaces" },
  { href: "#benchmarks", label: "Benchmarks" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleScroll = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#")) {
      e.preventDefault();
      setOpen(false);
      if (href === "#top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const target = document.querySelector(href);
      if (target) {
        const navHeight = 72;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top: targetPosition, behavior: "smooth" });
      }
    }
  };

  return (
    <header
      className="gp-nav"
      style={{
        background: scrolled ? "rgba(2,2,2,0.72)" : "transparent",
        backdropFilter: scrolled ? "blur(10px)" : "none",
      }}
    >
      <div className="gp-container">
        <div className="gp-nav-inner">
          <a className="gp-nav-logo" href="#top" onClick={(e) => handleScroll(e, "#top")}>
            <span className="gp-nav-mark" aria-hidden="true">
              <GatepassLogo size={60} />
            </span>
            Gatepass
          </a>

          <div className="gp-nav-cluster">
            <nav className="gp-nav-menu" aria-label="Primary">
              {LINKS.map((l) => (
                <a key={l.href} className="gp-nav-link" href={l.href} onClick={(e) => handleScroll(e, l.href)}>
                  {l.label}
                </a>
              ))}
            </nav>
            <a className="gp-btn gp-btn-primary gp-nav-cta" href="#start" onClick={(e) => handleScroll(e, "#start")}>
              Scan a repo
            </a>
            <button
              type="button"
              className="gp-nav-toggle"
              aria-expanded={open}
              aria-controls="gp-nav-drawer"
              aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        <div id="gp-nav-drawer" className="gp-nav-drawer" data-open={open}>
          {LINKS.map((l) => (
            <a key={l.href} className="gp-nav-link" href={l.href} onClick={(e) => handleScroll(e, l.href)}>
              {l.label}
            </a>
          ))}
          <a className="gp-btn gp-btn-primary" href="#start" onClick={(e) => handleScroll(e, "#start")}>
            Scan a repo
          </a>
        </div>
      </div>
    </header>
  );
}
