"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * Terminal-style panel matching the code cards on the marketing site: a
 * sunken surface, a hairline title bar, monospace body. Diff lines are tinted
 * *and* prefixed by their own `+`/`-`, so the meaning survives without colour.
 */
export function CodeBlock({
  title,
  content,
  diff = false,
  maxHeight = "24rem",
}: {
  title?: string;
  content: string;
  /** Tint `+`/`-` lines as an added/removed diff. */
  diff?: boolean;
  maxHeight?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const lines = content.split("\n");

  return (
    <div className="overflow-hidden rounded-[0.75rem] border border-line bg-sunken">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2">
        <span className="truncate font-mono text-[0.7rem] tracking-wide text-fg-muted">{title ?? "output"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[0.7rem] text-fg-muted transition-colors hover:bg-raised hover:text-fg"
        >
          {copied ? <Check size={12} className="text-verified" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="overflow-auto p-3.5" style={{ maxHeight }}>
        <pre className="font-mono text-[0.76rem] leading-[1.6] whitespace-pre-wrap text-fg-secondary">
          {lines.map((line, i) => {
            const added = diff && (line.startsWith("+") || line.startsWith("add "));
            const removed = diff && (line.startsWith("-") || line.startsWith("remove "));
            return (
              <div
                key={i}
                className={cx(
                  "-mx-3.5 px-3.5",
                  added && "bg-verified-soft text-verified",
                  removed && "bg-critical-soft text-critical",
                )}
              >
                {line || " "}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
