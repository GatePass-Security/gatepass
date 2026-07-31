import { Fragment } from "react";

/**
 * Render a plain string, honouring `backtick` spans as inline code.
 *
 * Error copy lives in `lib/errors.ts` as strings, not JSX, because the same message is reused by
 * a toast, a panel and a full page — and a `FriendlyError` that carried React elements could not
 * be logged, compared or tested as data. Backticks are the smallest markup that survives that
 * constraint, so this is the one place that turns them back into something typeset.
 *
 * Deliberately not a Markdown parser. It handles exactly one construct, and a stray unmatched
 * backtick leaves the whole string as prose rather than typesetting the tail of a sentence as
 * code — the failure mode of a half-parsed message is worse than no parsing at all.
 */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split("`");
  // An even number of backticks splits into an odd number of parts; anything else means one is
  // unpaired, so nothing is marked up.
  if (parts.length % 2 === 0) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded-[0.3rem] bg-raised px-1 py-0.5 font-mono text-[0.92em] text-fg-secondary">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
