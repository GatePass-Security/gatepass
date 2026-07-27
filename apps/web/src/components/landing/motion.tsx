"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll motion primitives for the landing page.
 *
 * All of it is decorative — content is fully readable with JavaScript disabled and with
 * `prefers-reduced-motion: reduce`, which the stylesheet neutralises.
 */

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fades and lifts children into place the first time they enter the viewport. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`gp-reveal ${className}`.trim()}
      data-in={shown ? "true" : "false"}
      style={{ "--i": delay } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/** Drives a 0..1 progress value from an element's travel through the viewport. */
function useScrollProgress(ref: React.RefObject<HTMLElement | null>, enabled = true) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || prefersReducedMotion()) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 when the top edge sits at 85% viewport height, 1 once the bottom clears 40%.
      const span = rect.height + vh * 0.45;
      const travelled = vh * 0.85 - rect.top;
      setProgress(Math.min(1, Math.max(0, travelled / span)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, enabled]);

  return progress;
}

/**
 * Word-by-word reveal scrubbed by scroll position — the template's signature copy animation.
 * `emphasis` words stay white from the start so the key phrase reads even mid-scrub.
 */
export function WordReveal({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const progress = useScrollProgress(ref);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    setScrubbing(!prefersReducedMotion());
  }, []);

  const words = text.split(" ");
  // A little overshoot so the final word lights before the block leaves the viewport.
  const lit = Math.round(progress * words.length * 1.15);

  return (
    <p ref={ref} className={`gp-words ${className}`.trim()}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} data-lit={!scrubbing || i < lit ? "1" : "0"}>
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

/** Translates a panel vertically as it scrolls, at a fraction of the page's own speed. */
export function Parallax({
  children,
  speed = 60,
  className = "",
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress(ref);

  return (
    <div ref={ref} className={className} style={{ transform: `translate3d(0, ${(0.5 - progress) * speed}px, 0)` }}>
      {children}
    </div>
  );
}
