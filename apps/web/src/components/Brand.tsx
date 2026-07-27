import { Shield } from "lucide-react";

/**
 * The Gatepass mark: a mint-gradient tile carrying a shield glyph, exactly as it
 * appears in the marketing header. This is the one place in the product that
 * uses a gradient — everywhere else the accent is flat, so the mark reads as
 * brand rather than as decoration.
 *
 * Its colours come from `--gp-mark-*` in globals.css and deliberately do NOT
 * flip with the theme: a logo that changes colour between light and dark is two
 * logos. Keeping them as tokens means the mark is still restyled in one place.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[0.55rem]"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(150deg, var(--gp-mark-from) 0%, var(--gp-mark-via) 55%, var(--gp-mark-to) 100%)",
      }}
    >
      <Shield
        size={Math.round(size * 0.52)}
        strokeWidth={2.25}
        style={{ color: "var(--gp-mark-ink)" }}
        aria-hidden="true"
      />
    </span>
  );
}

export function BrandLockup({ size = 28, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[0.95rem] font-semibold tracking-[-0.02em] text-fg">Gatepass</span>
        {subtitle && <span className="mt-1 text-[0.7rem] text-fg-muted">{subtitle}</span>}
      </span>
    </span>
  );
}
