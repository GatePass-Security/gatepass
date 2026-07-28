import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WCAG contrast gate for the dashboard's token layer.
 *
 * This reads `globals.css` itself rather than a copy of the palette, so it fails
 * the moment someone edits a token to a value that cannot be read. It exists
 * because eyeballing missed three real failures: in the light theme the accent
 * (and therefore the "Verified" badge, the product's central claim) sat at
 * 4.25:1 on the table-header fill, `high` at 4.36:1, and a fourth text tier at
 * 2.43:1 while carrying scan ids and section labels.
 *
 * Every foreground is checked against every surface it can land on, not just
 * the card it usually sits on — a badge in a table header is over
 * `--gp-surface-sunken`, which is the lightest fill in the light theme and the
 * case that actually failed.
 */

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "globals.css"), "utf8");

/** Pull one custom property out of a `:root { … }` or `.dark { … }` block. */
function token(block: string, name: string): string {
  const scope = CSS.split(block)[1];
  if (!scope) throw new Error(`No ${block} block in globals.css`);
  const body = scope.slice(0, scope.indexOf("\n}"));
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(body);
  if (!match?.[1]) throw new Error(`${name} not found in ${block} (or is not a hex value)`);
  return match[1];
}

function channels(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, WCAG 2.x definition. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["--gp-canvas", "--gp-surface", "--gp-surface-raised", "--gp-surface-sunken"] as const;

/** Every token that renders as text. All of these need 4.5:1. */
const FOREGROUNDS = [
  "--gp-text",
  "--gp-text-secondary",
  "--gp-text-muted",
  "--gp-accent",
  "--gp-critical",
  "--gp-high",
  "--gp-medium",
  "--gp-low",
  "--gp-verified",
  "--gp-research",
] as const;

const AA_TEXT = 4.5;

describe.each([
  ["light", ":root {"],
  ["dark", ".dark {"],
])("%s theme", (_theme, block) => {
  it.each(FOREGROUNDS)("%s clears 4.5:1 on every surface", (fg) => {
    const value = token(block, fg);
    for (const surface of SURFACES) {
      const bg = token(block, surface);
      const ratio = contrast(value, bg);
      expect(
        ratio,
        `${fg} (${value}) on ${surface} (${bg}) is ${ratio.toFixed(2)}:1, below the ${AA_TEXT}:1 floor`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("token layer invariants", () => {
  it("has no fourth text tier — it could not be made readable", () => {
    // --gp-text-faint measured 2.43:1 (light) and 2.91:1 (dark) against the
    // surfaces it landed on, and the only fix would have made it a duplicate of
    // --gp-text-muted. Reintroducing it should fail here rather than in review.
    expect(CSS).not.toMatch(/--gp-text-faint\s*:/);
  });

  it("ships no gradient in the product token layer", () => {
    // The gradient brand tile and the ambient radial glow were both removed; the
    // accent is flat everywhere so it only appears where it carries meaning.
    const declarations = CSS.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.includes("//"));
    expect(declarations.join("\n")).not.toMatch(/(linear|radial|conic)-gradient\(/);
  });

  it("keeps the primary action at the marketing site's high-contrast pill", () => {
    for (const block of [":root {", ".dark {"]) {
      const ratio = contrast(token(block, "--gp-action"), token(block, "--gp-action-text"));
      expect(ratio, `action pill in ${block} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
    }
  });
});
