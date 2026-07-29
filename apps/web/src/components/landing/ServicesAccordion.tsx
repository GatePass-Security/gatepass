"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

/**
 * The "Surfaces" accordion.
 *
 * Hover-expanded rows have a nasty edge case that CSS alone cannot solve: `:hover` is only
 * re-evaluated when the *pointer* moves, not when the *layout* moves underneath a pointer that is
 * standing still. So when you slide off the open row and stop, the row collapses, the rows below
 * travel up into the cursor — and none of them ever receive hover. Everything closes and the
 * section looks broken.
 *
 * The fix is to stop asking the browser and hit-test ourselves: while the pointer is inside the
 * list we re-run `elementFromPoint` on every animation frame, so whichever row is genuinely under
 * the cursor at that instant becomes the open one, whether the cursor moved to it or it moved to
 * the cursor. `:focus-within` is kept in CSS so keyboard users are unaffected by any of this.
 */

export interface ServiceItem {
  title: string;
  body: string;
  image: string;
}

export function ServicesAccordion({ items }: { items: ServiceItem[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  /** Latest viewport coords. A ref, not state — this updates far too often to re-render on. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [tracking, setTracking] = useState(false);

  /*
   * One source of truth for "which row is open", used by both `data-open` and `aria-expanded`.
   *
   * Keyboard focus outranks the pointer deliberately. The hit-test loop below keeps writing
   * `active` for as long as the mouse rests anywhere over the list, so without this precedence a
   * stationary mouse would immediately overwrite a row the user had just tabbed to. Driving the
   * CSS from `:focus-within` instead would work visually but leave `aria-expanded` disagreeing
   * with what is on screen — which is what it did before.
   */
  const openIndex = focused ?? active;

  /** Index of the row occupying a viewport point right now, or null. */
  const rowAt = useCallback((x: number, y: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !list.contains(hit)) return null;
    const row = (hit as HTMLElement).closest<HTMLElement>("[data-svc-index]");
    if (!row) return null;
    const index = Number(row.dataset.svcIndex);
    return Number.isNaN(index) ? null : index;
  }, []);

  useEffect(() => {
    if (!tracking) return;
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const list = listRef.current;
      const at = pointer.current;
      if (!list || !at) return;

      /* Bounds first. When the last row collapses out from under a stationary cursor the browser
         may never fire pointerleave, so the loop has to notice it is done on its own — otherwise
         it runs forever. */
      const rect = list.getBoundingClientRect();
      const inside = at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom;
      if (!inside) {
        setTracking(false);
        setActive(null);
        return;
      }

      const next = rowAt(at.x, at.y);
      // Gaps between rows return null; hold the current row rather than flickering shut.
      if (next !== null) setActive((current) => (current === next ? current : next));
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tracking, rowAt]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Touch and pen get tap-to-open below; frame-by-frame hit testing is a mouse affordance.
    if (e.pointerType !== "mouse") return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!tracking) setTracking(true);
  };

  const onPointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    pointer.current = null;
    setTracking(false);
    setActive(null);
  };

  return (
    <div
      className="gp-svc-list"
      role="list"
      ref={listRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.title} className="gp-svc" role="listitem" data-svc-index={i} data-open={open}>
            <button
              type="button"
              className="gp-svc-trigger"
              aria-expanded={open}
              aria-controls={`gp-svc-panel-${i}`}
              // Tap on touch, and a click target for anyone who prefers not to hover.
              onClick={() => setActive((current) => (current === i ? null : i))}
              onFocus={() => setFocused(i)}
              onBlur={() => setFocused((current) => (current === i ? null : current))}
            >
              <span className="gp-svc-title">{item.title}</span>
              <ArrowRight className="gp-svc-arrow" size={22} aria-hidden="true" />
            </button>
            <div className="gp-svc-expand" id={`gp-svc-panel-${i}`}>
              <div className="gp-svc-expand-inner">
                <div className="gp-svc-content">
                  <p className="gp-svc-body">{item.body}</p>
                  <img src={item.image} alt="" className="gp-svc-img" loading="lazy" />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
