import type { FixEdit } from "./schema.js";

/**
 * Applying a suggested fix. Shared by every consumer (the PR-suggestion builder, the
 * fix-pull-request opener, the CLI) so "what this edit means" is defined once instead of
 * re-derived per call site — the classic way two consumers drift and one of them starts
 * writing to the wrong lines.
 *
 * Line numbers throughout are 1-indexed and inclusive, matching `locationSchema`.
 */

export class FixEditError extends Error {}

/**
 * Split file content into lines, remembering whether it ended with a newline so a rewrite
 * can restore the file's original ending rather than silently adding or dropping one.
 */
export function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  return { lines: body.split("\n"), trailingNewline };
}

export function joinLines(lines: string[], trailingNewline: boolean): string {
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

/**
 * The anchor lines an edit attaches to, or `undefined` when the range does not exist in
 * this content. Callers treat `undefined` as "the file moved on since the scan" and MUST
 * degrade rather than guess — applying an edit to the wrong lines is the failure mode this
 * whole module exists to prevent.
 */
export function anchorLines(content: string, edit: FixEdit): string[] | undefined {
  const { lines } = splitLines(content);
  if (edit.startLine > lines.length || edit.endLine > lines.length) return undefined;
  return lines.slice(edit.startLine - 1, edit.endLine);
}

/**
 * Apply one edit to file content, returning the new content.
 *
 * Throws rather than clamping when the anchor is out of bounds: a fix that lands on the
 * wrong lines is worse than a fix that does not land at all.
 */
export function applyFixEdit(content: string, edit: FixEdit): string {
  const { lines, trailingNewline } = splitLines(content);
  if (edit.endLine > lines.length) {
    throw new FixEditError(
      `fix edit for ${edit.path} anchors at line ${edit.endLine} but the file has ${lines.length} lines`,
    );
  }
  const inserted = splitLines(edit.insertedLines).lines;
  const next = [...lines.slice(0, edit.endLine), ...inserted, ...lines.slice(edit.endLine)];
  return joinLines(next, trailingNewline);
}

/**
 * Apply several edits to the same file. Applied from the bottom up so an earlier insertion
 * cannot shift the anchor of a later one — every edit's line numbers refer to the ORIGINAL
 * file, which is the only interpretation a caller can reason about.
 *
 * Overlapping anchors are rejected: two fixes fighting over the same statement is a bug in
 * fix generation, and resolving it by insertion order would make the result depend on
 * finding sort order.
 */
export function applyFixEdits(content: string, edits: readonly FixEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.endLine - a.endLine || b.startLine - a.startLine);
  for (let i = 1; i < ordered.length; i++) {
    const later = ordered[i - 1]!;
    const earlier = ordered[i]!;
    if (earlier.endLine >= later.startLine) {
      throw new FixEditError(
        `overlapping fix edits in ${later.path}: lines ${earlier.startLine}-${earlier.endLine} and ` +
          `${later.startLine}-${later.endLine}`,
      );
    }
  }
  return ordered.reduce((acc, edit) => applyFixEdit(acc, edit), content);
}
