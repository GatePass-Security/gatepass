"use client";

import { useEffect } from "react";
import { startWarmup } from "@/lib/warmup";

/**
 * Fires the API warm-up on first paint and renders nothing.
 *
 * Mounted in the root layout so it runs on whichever page a visitor happens to land on,
 * including the marketing page — which is the whole point, since that is where the seconds are
 * available to spend. See `lib/warmup.ts` for why this exists.
 *
 * In an effect rather than during render, so it never runs on the server and never fires twice
 * for one document.
 */
export function ApiWarmup() {
  useEffect(() => {
    startWarmup();
  }, []);
  return null;
}
