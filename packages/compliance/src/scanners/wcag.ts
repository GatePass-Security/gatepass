import type { ScanContext } from "@gatepass/engine";
import type { ComplianceCheck } from "../compliance-schema.js";
import { registerScanner, makeCheck } from "../compliance-scanner.js";
import type { DomainScanner } from "../compliance-scanner.js";
import { combineFiles, complianceRelevantFiles, resolveLocations, REPO_WIDE } from "../source-map.js";
import { ratioFromCss, suggestAccessibleColor, THRESHOLDS } from "../contrast.js";

/**
 * WCAG 2.2 compliance scanner.
 * Scans CSS, TSX/JSX component code, and HTML for accessibility violations.
 *
 * Checks performed:
 * - wcag-target-size: Finds interactive elements with small dimensions
 * - wcag-text-contrast: Checks color pairs for 4.5:1 ratio (pattern-based heuristic)
 * - wcag-accessible-auth: Detects CAPTCHA/puzzle-based auth flows
 * - wcag-focus-not-obscured: Detects sticky headers without scroll-margin
 * - wcag-dragging-alternative: Detects drag-only interactions
 * - wcag-consistent-help: Detects help widgets with inconsistent positioning
 * - wcag-redundant-entry: Detects forms requiring re-entry of known data
 * - wcag-focus-appearance: Checks for focus indicator styles
 * - wcag-non-text-contrast: Checks UI component contrast
 */

const TARGET_SIZE_RE = /(width|height|min-width|min-height|w-|h-)\s*:\s*([0-9]+(\.[0-9]+)?)(px|rem|em)?/gi;
const SMALL_TARGET = 24; // 24 CSS pixels minimum
/*
 * There is deliberately no colour-matching regex here any more. Contrast is evaluated by
 * `COLOR_DECL` + `ratioFromCss` below, which computes a real WCAG ratio; the pattern that used
 * to live at this line only proved a colour was *mentioned*, which is not a finding.
 */
const STICKY_RE = /position\s*:\s*sticky|sticky|fixed\s+(top|bottom)/gi;
const SCROLL_MARGIN_RE = /scroll-margin|scroll-padding|scrollMargin|scrollPadding/gi;
const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|turnstile|challenge|puzzle|cognitive/i;
const DRAG_ONLY_RE = /onDrag|onDrop|draggable|drag-and-drop|DragDrop|sortable/i;
const CLICK_ALT_RE = /onClick|onPress|onTap|click|button.*alternative/i;
const FOCUS_OUTLINE_RE = /outline\s*:\s*none|outline\s*:\s*0\b/i;
const FOCUS_STYLE_RE = /focus[:\s]*{|focus-visible|focus:outline|focus:ring|focus:border/i;

/**
 * Interactive-target detection for SC 2.5.8. The criterion applies only to POINTER TARGETS,
 * and carries five exceptions (Spacing, Equivalent, Inline, User Agent Control, Essential).
 * Flagging every `height: 20px` in a stylesheet — as the first implementation did — reports a
 * divider or an icon glyph as an accessibility failure. We therefore only flag a small
 * dimension when the same rule/element also shows an interactive signal, and we skip
 * declarations that carry an explicit inline-text or spacing exception marker.
 */
const INTERACTIVE_HINT =
  /\b(button|<a[\s>]|role=["']button["']|onclick|onpress|cursor\s*:\s*pointer|\[type=["']?(button|submit|checkbox|radio)|\.btn|-btn\b|clickable|tappable|icon-button|iconbutton)\b/i;
/** Inline exception: target sits inside a sentence/paragraph of text. */
const INLINE_EXCEPTION = /\b(display\s*:\s*inline(?!-block)|<p[\s>]|prose|paragraph|inline-link)\b/i;
/** Spacing exception: author has provided >=24px offset around the target. */
const SPACING_EXCEPTION = /\b(margin|padding|gap)[a-z-]*\s*:\s*(2[4-9]|[3-9][0-9]|[1-9][0-9]{2,})(px)?\b/i;

interface SmallTarget {
  path: string;
  line: number;
  value: number;
  unit: string;
  text: string;
}

function findSmallTargets(file: { relPath: string; content: string }): SmallTarget[] {
  const found: SmallTarget[] = [];
  const lines = file.content.split(/\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Context window: the declaration plus surrounding lines, so an interactive signal on
    // the selector line (e.g. `.btn {`) is visible when the size is on the next line.
    const ctx = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join("\n");
    if (!INTERACTIVE_HINT.test(ctx)) continue; // not a pointer target — SC 2.5.8 does not apply
    if (INLINE_EXCEPTION.test(ctx)) continue; // Inline exception
    if (SPACING_EXCEPTION.test(ctx)) continue; // Spacing exception

    TARGET_SIZE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TARGET_SIZE_RE.exec(line)) !== null) {
      const value = parseFloat(m[2]!);
      const unit = m[4] || "px";
      // Only px/unitless are directly comparable to the 24 CSS px floor.
      if (unit !== "px") continue;
      if (value > 0 && value < SMALL_TARGET) {
        found.push({ path: file.relPath, line: i + 1, value, unit, text: line.trim().slice(0, 160) });
      }
    }
  }
  return found;
}

function checkTargetSizes(files: readonly { relPath: string; content: string }[]): ComplianceCheck[] {
  const smallTargets = files.flatMap(findSmallTargets);

  if (smallTargets.length === 0) {
    return [makeCheck("wcag-target-size", "pass", [])];
  }

  const locations = smallTargets.slice(0, 10).map((t) => ({
    path: t.path,
    startLine: t.line,
    endLine: t.line,
    snippet: t.text,
  }));

  // Fix derived from the actual smallest offending declaration, not a template.
  const worst = smallTargets.reduce((a, b) => (a.value <= b.value ? a : b));
  return [
    makeCheck("wcag-target-size", "fail", locations, {
      kind: "code_change",
      description: `${smallTargets.length} interactive target(s) below 24×24 CSS px (smallest: ${worst.value}${worst.unit} in ${worst.path}:${worst.line}). WCAG 2.2 SC 2.5.8 allows an exception if targets are spaced ≥24px apart, are inline in text, or have an equivalent larger control.`,
      filePath: worst.path,
      diff: [
        `--- a/${worst.path}`,
        `+++ b/${worst.path}`,
        `@@ -${worst.line},1 +${worst.line},1 @@`,
        `-${worst.text}`,
        `+${worst.text.replace(/([0-9.]+)px/, "24px")}   /* WCAG 2.2 SC 2.5.8: min 24x24 CSS px */`,
      ].join("\n"),
    }),
  ];
}

/**
 * Real contrast evaluation (SC 1.4.3 text, SC 1.4.11 non-text). We assert a failure only when
 * BOTH a foreground and a background colour are determinable and the computed WCAG ratio is
 * genuinely below threshold. A foreground with no resolvable background yields
 * `manual_review`, never a fabricated `fail` — a precision product must not cry wolf on
 * colours it cannot actually evaluate.
 */
const COLOR_DECL =
  /(?:^|[;{\s])(color|background-color|background)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|white|black)/g;

interface ColorFinding {
  path: string;
  line: number;
  fg: string;
  bg: string;
  ratio: number;
  text: string;
}

function collectContrastFindings(files: readonly { relPath: string; content: string }[]): {
  textFailures: ColorFinding[];
  nonTextFailures: ColorFinding[];
  undetermined: number;
} {
  const textFailures: ColorFinding[] = [];
  const nonTextFailures: ColorFinding[] = [];
  let undetermined = 0;

  for (const file of files) {
    const lines = file.content.split(/\n/);
    // Most recent background declaration acts as the working background for the block.
    let currentBg: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      COLOR_DECL.lastIndex = 0;
      let m: RegExpExecArray | null;
      const foregrounds: string[] = [];

      while ((m = COLOR_DECL.exec(line)) !== null) {
        const prop = m[1]!.toLowerCase();
        const value = m[2]!;
        if (prop === "background" || prop === "background-color") currentBg = value;
        else foregrounds.push(value);
      }

      for (const fg of foregrounds) {
        if (!currentBg) {
          undetermined++;
          continue;
        }
        const ratio = ratioFromCss(fg, currentBg);
        if (ratio === null) {
          undetermined++;
          continue;
        }
        const finding: ColorFinding = {
          path: file.relPath,
          line: i + 1,
          fg,
          bg: currentBg,
          ratio,
          text: line.trim().slice(0, 160),
        };
        if (ratio < THRESHOLDS.normalText.required) textFailures.push(finding);
        // Non-text/UI-component threshold is the lower 3:1 bar (SC 1.4.11).
        if (ratio < THRESHOLDS.nonText.required) nonTextFailures.push(finding);
      }
    }
  }

  return { textFailures, nonTextFailures, undetermined };
}

function contrastFix(worst: ColorFinding, required: number, criterion: string) {
  const suggested = suggestAccessibleColor(worst.fg, worst.bg, { required, kind: "normal-text" }) ?? worst.fg;
  return {
    kind: "diff" as const,
    description: `Worst pair ${worst.ratio.toFixed(2)}:1 (${worst.fg} on ${worst.bg}) at ${worst.path}:${worst.line}; ${criterion} requires ≥${required}:1. Suggested foreground ${suggested} yields a passing ratio on the same background.`,
    filePath: worst.path,
    diff: [
      `--- a/${worst.path}`,
      `+++ b/${worst.path}`,
      `@@ -${worst.line},1 +${worst.line},1 @@`,
      `-${worst.text}`,
      `+${worst.text.replace(worst.fg, suggested)}`,
    ].join("\n"),
  };
}

function checkContrast(files: readonly { relPath: string; content: string }[]): ComplianceCheck[] {
  const { textFailures, nonTextFailures, undetermined } = collectContrastFindings(files);
  const checks: ComplianceCheck[] = [];
  const toLocations = (f: ColorFinding[]) =>
    f.slice(0, 10).map((x) => ({
      path: x.path,
      startLine: x.line,
      endLine: x.line,
      snippet: `${x.text}   /* ${x.ratio.toFixed(2)}:1 on ${x.bg} */`,
    }));

  if (textFailures.length > 0) {
    const worst = textFailures.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    checks.push(
      makeCheck("wcag-text-contrast", "fail", toLocations(textFailures), {
        ...contrastFix(worst, THRESHOLDS.normalText.required, "WCAG 2.2 SC 1.4.3"),
        description: `${textFailures.length} colour pair(s) below the 4.5:1 minimum for normal text. ${contrastFix(worst, THRESHOLDS.normalText.required, "WCAG 2.2 SC 1.4.3").description}`,
      }),
    );
  } else if (undetermined > 0) {
    checks.push(
      makeCheck("wcag-text-contrast", "manual_review", [], {
        kind: "code_change",
        description: `${undetermined} text colour declaration(s) had no statically determinable background (inherited, themed, or computed). Verify with a runtime audit (axe/Lighthouse) — Gatepass does not guess at colours it cannot resolve.`,
      }),
    );
  } else {
    checks.push(makeCheck("wcag-text-contrast", "pass", []));
  }

  if (nonTextFailures.length > 0) {
    const worst = nonTextFailures.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    checks.push(
      makeCheck(
        "wcag-non-text-contrast",
        "fail",
        toLocations(nonTextFailures),
        contrastFix(worst, THRESHOLDS.nonText.required, "WCAG 2.2 SC 1.4.11"),
      ),
    );
  } else if (undetermined > 0) {
    checks.push(
      makeCheck("wcag-non-text-contrast", "manual_review", [], {
        kind: "code_change",
        description: `${undetermined} colour declaration(s) had no determinable background; UI-component contrast (3:1) needs manual or runtime verification.`,
      }),
    );
  } else {
    checks.push(makeCheck("wcag-non-text-contrast", "pass", []));
  }

  return checks;
}

function checkAccessibleAuth(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const authHits: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    CAPTCHA_RE.lastIndex = 0;
    if (CAPTCHA_RE.test(lines[i]!)) {
      authHits.push({ line: i + 1, text: lines[i]!.trim() });
    }
  }

  // Check for autocomplete/paste blocking
  const pasteBlock = /onpaste|oncopy|preventDefault|autocomplete\s*=\s*["']off["']/gi;
  const pasteBlockHits: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    pasteBlock.lastIndex = 0;
    if (pasteBlock.test(lines[i]!) && lines[i]!.toLowerCase().includes("password")) {
      pasteBlockHits.push({ line: i + 1, text: lines[i]!.trim() });
    }
  }

  const allIssues = [...authHits, ...pasteBlockHits];
  if (allIssues.length > 0) {
    checks.push(
      makeCheck(
        "wcag-accessible-auth",
        "fail",
        allIssues.slice(0, 5).map((h) => ({
          path: filePath,
          startLine: h.line,
          endLine: h.line,
          snippet: h.text,
        })),
        {
          kind: "code_change",
          description: `Authentication flow relies on cognitive function tests (${authHits.length > 0 ? "CAPTCHA/puzzle" : ""}${pasteBlockHits.length > 0 ? " + paste-blocking" : ""}). Provide password manager autofill and copy-paste support as alternatives.`,
          diff: '// Replace CAPTCHA with:\n// 1. Privacy-pass / Turnstile (invisible)\n// 2. WebAuthn / passkeys\n// 3. Email magic link\n// Enable autocomplete and paste on password fields:\n// autocomplete="current-password"\n// Remove: onpaste="return false"',
        },
      ),
    );
  } else {
    checks.push(makeCheck("wcag-accessible-auth", "pass", []));
  }

  return checks;
}

// `_filePath` is unused: this check reports presence/absence across the whole buffer and emits
// no locations. The parameter stays so every repo-wide check keeps one call signature.
function checkFocusNotObscured(content: string, _filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const hasSticky = lines.some((l) => STICKY_RE.test(l));
  const hasScrollMargin = lines.some((l) => SCROLL_MARGIN_RE.test(l));

  if (hasSticky && !hasScrollMargin) {
    checks.push(
      makeCheck("wcag-focus-not-obscured", "fail", [], {
        kind: "code_change",
        description:
          "Sticky header/footer detected without scroll-margin on focusable elements. Add scroll-margin-top to offset sticky header height.",
        diff: "/* Add to global CSS or target focusable elements */\n*:focus {\n  scroll-margin-top: 80px; /* offset for sticky header */\n}\n/* Or use Tailwind: scroll-mt-20 on section elements */",
      }),
    );
  } else if (hasSticky && hasScrollMargin) {
    checks.push(makeCheck("wcag-focus-not-obscured", "pass", []));
  } else {
    checks.push(makeCheck("wcag-focus-not-obscured", "pass", []));
  }

  return checks;
}

function checkDraggingAlternatives(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const dragItems: { line: number; text: string }[] = [];
  let hasClickAlt = false;

  for (let i = 0; i < lines.length; i++) {
    if (DRAG_ONLY_RE.test(lines[i]!)) {
      dragItems.push({ line: i + 1, text: lines[i]!.trim() });
    }
    if (CLICK_ALT_RE.test(lines[i]!)) {
      hasClickAlt = true;
    }
  }

  if (dragItems.length > 0 && !hasClickAlt) {
    checks.push(
      makeCheck(
        "wcag-dragging-alternative",
        "fail",
        dragItems.slice(0, 3).map((d) => ({
          path: filePath,
          startLine: d.line,
          endLine: d.line,
          snippet: d.text,
        })),
        {
          kind: "code_change",
          description: "Drag-based interactions must have single-pointer alternatives (tap/click/button).",
          diff: "/* Add button-based alternative for each drag interaction */\n{/* Example: reorder list */}\n<button onClick={() => moveItem(id, 'up')}>▲</button>\n<button onClick={() => moveItem(id, 'down')}>▼</button>\n<div draggable onDragStart={...}>...</div>",
        },
      ),
    );
  } else if (dragItems.length > 0 && hasClickAlt) {
    checks.push(makeCheck("wcag-dragging-alternative", "pass", []));
  } else {
    checks.push(makeCheck("wcag-dragging-alternative", "pass", []));
  }

  return checks;
}

function checkConsistentHelp(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  // Look for help/chat widget patterns that might move between routes
  const helpWidgets = /(livechat|chatWidget|helpWidget|zendesk|intercom|crisp|tawk|freshchat)/gi;
  const lines = content.split(/\n/);
  const found = lines.filter((l) => helpWidgets.test(l));

  if (found.length > 0) {
    checks.push(
      makeCheck(
        "wcag-consistent-help",
        "manual_review",
        found.slice(0, 2).map((l, _i) => ({
          path: filePath,
          startLine: lines.indexOf(l) + 1,
          snippet: l.trim(),
        })),
        {
          kind: "code_change",
          description:
            "Chat/help widget detected — ensure it renders in the same position across all routes for WCAG 3.2.6 Consistent Help.",
          diff: '// Ensure help widget renders in a fixed position consistently\n// Move chat widget to a layout-level component, not route-level\n// <ChatWidget className="fixed bottom-4 right-4" />  // consistent positioning',
        },
      ),
    );
  } else {
    checks.push(makeCheck("wcag-consistent-help", "pass", []));
  }

  return checks;
}

function checkRedundantEntry(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  // Check forms for potential re-entry issues (multi-step forms without carry-over)
  const multiStepForm = /(multiStep|step|wizard|page.*form|form.*page)\s/gi;
  const autoPopulate = /(defaultValue|autoFill|auto-populate|carryOver|useEffect.*fill|prefill|preset|autofill)/gi;
  const lines = content.split(/\n/);
  const stepForms: number[] = [];
  let hasAutoFill = false;

  for (let i = 0; i < lines.length; i++) {
    if (multiStepForm.test(lines[i]!)) stepForms.push(i + 1);
    if (autoPopulate.test(lines[i]!)) hasAutoFill = true;
  }

  if (stepForms.length > 0 && !hasAutoFill) {
    checks.push(
      makeCheck(
        "wcag-redundant-entry",
        "manual_review",
        stepForms.slice(0, 3).map((l) => ({
          path: filePath,
          startLine: l,
          snippet: `Multi-step form at line ${l} — ensure previous step data is auto-populated`,
        })),
        {
          kind: "code_change",
          description:
            "Multi-step form detected without auto-population of previously entered data. Add prefill mechanism for WCAG 3.3.7.",
          diff: "// Add useEffect to carry form state between steps\nuseEffect(() => {\n  if (previousStepData) {\n    setValue('email', previousStepData.email);\n  }\n}, [previousStepData, setValue]);",
        },
      ),
    );
  } else {
    checks.push(makeCheck("wcag-redundant-entry", "pass", []));
  }

  return checks;
}

// `_filePath` unused for the same reason as `checkFocusNotObscured` — no locations are emitted.
function checkFocusAppearance(content: string, _filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const hasOutlineNone = lines.some((l) => FOCUS_OUTLINE_RE.test(l));
  const hasFocusStyle = lines.some((l) => FOCUS_STYLE_RE.test(l));

  if (hasOutlineNone && !hasFocusStyle) {
    checks.push(
      makeCheck("wcag-focus-appearance", "fail", [], {
        kind: "code_change",
        description:
          "Focus outline is removed (outline: none) but no custom focus style provided. Add focus-visible styles meeting 2px perimeter and 3:1 contrast.",
        diff: "/* Add focus styles — never use outline: none without replacement */\n*:focus-visible {\n  outline: 2px solid #2563EB;\n  outline-offset: 2px;\n  border-radius: 2px;\n}\n/* Tailwind: focus-visible:outline-2 focus-visible:outline-blue-600 */",
      }),
    );
  } else {
    checks.push(makeCheck("wcag-focus-appearance", "pass", []));
  }

  return checks;
}

export const wcagScanner: DomainScanner = {
  domain: "wcag",
  scan(ctx: ScanContext): ComplianceCheck[] {
    const checks: ComplianceCheck[] = [];
    /*
     * `complianceRelevantFiles` first, extension filter second.
     *
     * The engine deliberately does NOT ignore build output — a secret shipped in a bundle is a
     * real security finding, so `.next/`, `dist/` and `build/` are all in `ctx.files`. That is
     * right for the security engine and wrong here: a contrast failure inside a minified React
     * chunk is not something a developer can act on, and reporting it is the false-positive
     * class this product exists to avoid. `complianceRelevantFiles` is the compliance-only
     * filter that drops them.
     */
    const relevantFiles = complianceRelevantFiles(ctx.files).filter((f) =>
      /\.(tsx|ts|jsx|js|css|scss|html)$/i.test(f.relPath),
    );

    // Per-file checks report REAL paths and REAL line numbers (a reproduction must be
    // openable — see Constitution Principle II).
    checks.push(...checkTargetSizes(relevantFiles));
    checks.push(...checkContrast(relevantFiles));

    /*
     * Repo-wide presence/absence checks legitimately reason over the whole tree, so they run
     * against one combined buffer. They report line numbers into THAT buffer, which is only
     * meaningful once mapped back: `combineFiles` keeps the offset map and `resolveLocations`
     * rewrites each location to its real file and real line.
     *
     * This previously concatenated the files by hand and passed the FIRST file's path as the
     * path for every hit, so a violation found in the four-hundredth file was reported at a
     * line number that did not exist in the file it named. Every such location was unopenable,
     * which under Principle II makes it not a reproduction at all. `REPO_WIDE` is the honest
     * placeholder while the numbers are still buffer-relative; nothing keeps it unless the hit
     * genuinely implicates no single file.
     */
    const src = combineFiles(relevantFiles);
    checks.push(...resolveLocations(checkAccessibleAuth(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkFocusNotObscured(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkDraggingAlternatives(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkConsistentHelp(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkRedundantEntry(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkFocusAppearance(src.content, REPO_WIDE), src));

    return checks;
  },
};

registerScanner(wcagScanner);
