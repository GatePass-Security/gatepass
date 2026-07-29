const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

/**
 * Normalises a tool description before it is handed to a model: drops markup
 * comments, removes invisible characters, and collapses runs of whitespace so
 * that nothing can be hidden below the fold of a review UI.
 */
export function sanitizeDescription(raw: string): string {
  return raw
    .replace(HTML_COMMENT, "")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}
