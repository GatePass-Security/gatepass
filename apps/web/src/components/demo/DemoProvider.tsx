"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Play, Square, Volume2, VolumeX } from "lucide-react";
import { api } from "@/lib/api-client";
// The org comes from the verified session, not a constant compiled into the bundle — `ORG_ID`
// was removed for that reason (see `lib/constants.ts`). The tour drives the real dashboard, so
// it has to read the same tenant every other page does or it demos somebody else's data.
import { useOrgId } from "@/providers/SessionProvider";
import { buildDemoScript, DEFAULT_WAIT_MS, DEMO_BUDGET_MS, plannedDurationMs, type Target } from "./demo-script";
import "@/styles/demo.css";

/**
 * Drives a guided tour of the real dashboard.
 *
 * Deliberately not a screen recording or a mocked walkthrough: the runner moves a cursor to real
 * controls and dispatches real clicks, so the app responds exactly as it would for a person. That
 * means the tour also fails honestly — if a control is missing or the API is down, the step is
 * skipped rather than faked.
 */

interface DemoApi {
  running: boolean;
  start: () => void;
  stop: () => void;
}

const DemoContext = createContext<DemoApi>({ running: false, start: () => {}, stop: () => {} });

export function useDemo(): DemoApi {
  return useContext(DemoContext);
}

/* ── Element resolution ─────────────────────────────────────────────── */

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function resolve(target: Target): HTMLElement | null {
  const scope = target.scope ?? 'a,button,[role="radio"],[role="switch"],input,select,summary';
  let list = Array.from(document.querySelectorAll<HTMLElement>(target.css ?? scope)).filter(isVisible);

  if (target.text) {
    const needle = target.text.toLowerCase();
    list = list.filter((el) => (el.innerText || el.textContent || "").toLowerCase().includes(needle));
    // Prefer the tightest match so "Critical" hits the pill, not the card that contains it.
    list.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
  }

  return list[target.nth ?? 0] ?? null;
}

function waitFor(target: Target, timeoutMs: number, cancelled: () => boolean): Promise<HTMLElement | null> {
  return new Promise((done) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (cancelled()) return done(null);
      const el = resolve(target);
      if (el) return done(el);
      if (Date.now() > deadline) return done(null);
      window.setTimeout(poll, 120);
    };
    poll();
  });
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, Math.max(0, ms)));

/* ── Value setters that React notices ───────────────────────────────── */

/** React tracks its own value on the node, so a plain assignment is swallowed. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ── Provider ───────────────────────────────────────────────────────── */

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const orgId = useOrgId();
  const [running, setRunning] = useState(false);
  const [caption, setCaption] = useState("");
  const [chapter, setChapter] = useState("");
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });
  const [clicking, setClicking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [narrate, setNarrate] = useState(false);

  const cancelRef = useRef(false);
  const narrateRef = useRef(false);
  useEffect(() => {
    narrateRef.current = narrate;
  }, [narrate]);

  const stop = useCallback(() => {
    cancelRef.current = true;
    setRunning(false);
    setCursor((c) => ({ ...c, visible: false }));
    setCaption("");
    setChapter("");
    document.documentElement.removeAttribute("data-demo");
    window.speechSynthesis?.cancel();
  }, []);

  const speak = useCallback((text: string) => {
    if (!narrateRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }, []);

  /** Glide the cursor to an element's centre and let the travel finish. */
  const moveTo = useCallback(async (el: HTMLElement) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(420); // let the smooth scroll land before measuring
    const rect = el.getBoundingClientRect();
    setCursor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: true });
    await sleep(560); // matches the cursor transition in demo.css
  }, []);

  const press = useCallback(async () => {
    setClicking(true);
    await sleep(180);
    setClicking(false);
  }, []);

  const start = useCallback(() => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    document.documentElement.setAttribute("data-demo", "running");

    void (async () => {
      const cancelled = () => cancelRef.current;

      // Point the live scan at a directory this API host demonstrably can read: the target of
      // the most recent scan. Hardcoding a path would break on any other machine.
      let scanPath: string | undefined;
      try {
        const scans = await api.listScans(orgId);
        scanPath = scans.find((s) => s.repo)?.repo;
      } catch {
        scanPath = undefined;
      }

      const steps = buildDemoScript({ scanPath });
      const planned = plannedDurationMs(steps);
      const startedAt = Date.now();
      setElapsed(0);

      const ticker = window.setInterval(() => setElapsed(Date.now() - startedAt), 200);

      let spent = 0;
      for (const step of steps) {
        if (cancelled()) break;
        const now = Date.now() - startedAt;
        if (now > DEMO_BUDGET_MS) break;

        /* Real navigation and a real scan take time the script cannot predict. Rather than
           overrun the ceiling, compress the dwell on everything that is left — down to 45% of
           its planned length, below which captions stop being readable. */
        const plannedLeft = Math.max(1, planned - spent);
        const actualLeft = Math.max(0, DEMO_BUDGET_MS - now);
        const scale = Math.min(1, Math.max(0.45, actualLeft / plannedLeft));

        spent += step.ms + ("settle" in step && step.settle ? step.settle : 0);

        setChapter(step.chapter);
        if ("say" in step && step.say) {
          setCaption(step.say);
          speak(step.say);
        }

        const dwell = step.ms * scale;

        if (step.kind === "say") {
          setCursor((c) => ({ ...c, visible: false }));
          await sleep(dwell);
          continue;
        }

        const el = await waitFor(step.target, step.waitMs ?? DEFAULT_WAIT_MS, cancelled);
        if (!el) {
          // Honest failure: the control is not there, so the step is skipped, not simulated.
          console.warn("[demo] target not found, skipping", step);
          continue;
        }
        if (cancelled()) break;

        await moveTo(el);
        if (cancelled()) break;

        switch (step.kind) {
          case "point":
            break;
          case "click":
            await press();
            el.click();
            break;
          case "await":
            await press();
            break;
          case "type": {
            await press();
            el.focus();
            const field = el as HTMLInputElement;
            // Typed a character at a time so the field visibly fills on camera.
            for (let i = 1; i <= step.value.length; i++) {
              if (cancelled()) break;
              setNativeValue(field, step.value.slice(0, i));
              await sleep(Math.max(8, 320 / step.value.length));
            }
            break;
          }
          case "select": {
            await press();
            const select = el as HTMLSelectElement;
            const option = Array.from(select.options).find((o) =>
              o.text.toLowerCase().includes(step.value.toLowerCase()),
            );
            if (option) setNativeValue(select, option.value);
            break;
          }
        }

        if ("settle" in step && step.settle) await sleep(step.settle * scale);
        await sleep(dwell);
      }

      window.clearInterval(ticker);
      if (!cancelled()) stop();
    })();
  }, [running, moveTo, press, speak, stop]);

  // Escape always gets you out.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, stop]);

  useEffect(() => () => void (cancelRef.current = true), []);

  const remaining = Math.max(0, DEMO_BUDGET_MS - elapsed);
  const mm = String(Math.floor(remaining / 60000)).padStart(1, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");

  return (
    <DemoContext.Provider value={{ running, start, stop }}>
      {children}

      {running && (
        <div className="gpd" aria-hidden="true">
          <div className="gpd-progress" style={{ width: `${Math.min(100, (elapsed / DEMO_BUDGET_MS) * 100)}%` }} />

          {cursor.visible && (
            <span
              className={`gpd-cursor${clicking ? " is-clicking" : ""}`}
              style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M5 3l14 8-6 1.6L10.6 19 5 3z" fill="#fff" stroke="#0b0b0d" strokeWidth="1.4" />
              </svg>
              <i className="gpd-ping" />
            </span>
          )}

          {caption && (
            <div className="gpd-caption">
              {chapter && <span className="gpd-chip">{chapter}</span>}
              <p>{caption}</p>
            </div>
          )}
        </div>
      )}

      {running && (
        <div className="gpd-controls">
          <span className="gpd-rec">
            <i /> LIVE DEMO
          </span>
          <span className="gpd-time">{`${mm}:${ss}`}</span>
          <button type="button" onClick={() => setNarrate((v) => !v)} aria-label="Toggle narration">
            {narrate ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button type="button" onClick={stop} aria-label="Stop demo">
            <Square size={13} /> Stop
          </button>
        </div>
      )}
    </DemoContext.Provider>
  );
}

/** Toolbar trigger. Lives in the top bar so it is the first thing on screen in a recording. */
export function DemoButton() {
  const { running, start } = useDemo();
  return (
    <button
      type="button"
      onClick={start}
      disabled={running}
      className="gpd-trigger"
      title="Run a guided tour of every feature (under 3 minutes)"
    >
      <Play size={13} aria-hidden="true" />
      <span className="hidden md:inline">{running ? "Demo running" : "Start demo"}</span>
    </button>
  );
}
