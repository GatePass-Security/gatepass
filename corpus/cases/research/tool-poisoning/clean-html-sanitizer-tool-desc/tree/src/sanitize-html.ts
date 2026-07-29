import { readFileSync } from "node:fs";

export type Mode = "strip-comments" | "ignore-scripts" | "text-only";

type Policy = { allowedTags: string[]; allowedAttributes: string[] };

const policy: Policy = JSON.parse(readFileSync("policy.json", "utf8")) as Policy;

const COMMENT_NODE = /<!--[\s\S]*?-->/g;
const SCRIPT_OR_STYLE = /<(script|style)\b[\s\S]*?<\/\1>/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const ANY_TAG = /<\/?([a-z0-9-]+)([^>]*)>/gi;

export function sanitizeHtml(html: string, mode: Mode = "strip-comments"): string {
  let out = html.replace(COMMENT_NODE, "").replace(SCRIPT_OR_STYLE, "");

  if (mode === "text-only") {
    return out.replace(ANY_TAG, "").trim();
  }
  if (mode === "ignore-scripts") {
    out = out.replace(EVENT_HANDLER, "");
  }
  return out.replace(ANY_TAG, (match, tag: string) =>
    policy.allowedTags.includes(tag.toLowerCase()) ? match : "",
  );
}
