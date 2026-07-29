import type { FixOperation, SuggestedFix } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { CodeBlock } from "@/components/ui/CodeBlock";

/**
 * The two ways a suggested fix can be rendered, in one place so Findings and
 * Agent guidance cannot drift apart.
 *
 * Both surfaces previously piped `suggestedFix.content` straight into a
 * `CodeBlock` with `diff` on. That was written for a payload that never shipped:
 * `content` is the human-readable rationale — multi-paragraph prose, with
 * indented bullet and numbered lines — so a monospace panel mangled its wrapping,
 * and diff tinting painted every sentence that happened to open with a hyphen as
 * a deleted line. Prose renders as prose here; the only thing that reaches a
 * `CodeBlock` is `edit.insertedLines`, which genuinely is code.
 */

/**
 * Keyed on the operation rather than hard-coded, so adding a second operation to
 * `FIX_OPERATIONS` fails the build here instead of silently describing a
 * replacement as an insertion.
 */
const OPERATION_NOTE: Record<FixOperation, string> = {
  insert_after: "These lines are added after the range above. Nothing inside it is replaced or removed.",
};

/**
 * `diff` ⇒ an edit Gatepass can apply mechanically. `agent_guidance` ⇒ prose a
 * person (or their coding agent) has to act on, because the correct fix needs a
 * value only they can choose. A reader has to be able to tell those apart at a
 * glance, which is what this badge is for.
 */
export function FixKindBadge({ kind }: { kind: SuggestedFix["kind"] }) {
  return (
    <Badge tone={kind === "diff" ? "verified" : "neutral"} size="sm">
      {kind === "diff" ? "Applicable edit" : "Guidance"}
    </Badge>
  );
}

/**
 * The body of a suggested fix: its rationale, then — only for a `diff` — the
 * exact anchor range and the lines that would be added after it. Callers supply
 * their own heading, so this sits equally well inside a finding's detail stack
 * and inside a card of its own.
 */
export function SuggestedFixDetail({ fix }: { fix: SuggestedFix }) {
  // Narrowed rather than tested twice: the schema guarantees `edit` is present
  // exactly when `kind === "diff"`, and this keeps that pairing in the types.
  const edit = fix.kind === "diff" ? fix.edit : undefined;

  return (
    <div>
      {/* `whitespace-pre-wrap`, not a code panel — the content carries its own
          line breaks and indented bullets, and needs to wrap as text. */}
      <p className="text-[0.82rem] leading-relaxed whitespace-pre-wrap text-fg-secondary">{fix.content}</p>

      {edit && (
        <div className="mt-3 rounded-[0.75rem] border border-line bg-raised p-3.5">
          <p className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Target</p>
          <p className="mt-1 font-mono text-[0.76rem] break-all text-fg-secondary">
            {edit.path}:{edit.startLine}-{edit.endLine}
          </p>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-muted">{OPERATION_NOTE[edit.operation]}</p>
          <div className="mt-2.5">
            <CodeBlock title={edit.path} content={edit.insertedLines} />
          </div>
        </div>
      )}
    </div>
  );
}
