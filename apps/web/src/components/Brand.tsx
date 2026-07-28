import Image from "next/image";

/**
 * The Gatepass mark — the same asset the marketing header uses
 * (`public/landing/gatepass-logo.png`), rendered through next/image so the rail
 * gets a small optimised variant rather than the 1024px original.
 *
 * It used to be a mint-gradient tile with a lucide `Shield` inside it. That was
 * a stand-in from before the marketing site lived in this repo, and it made the
 * product and the landing page carry two different logos — the product's being
 * the gradient-chip-with-a-glyph that every generative-AI app ships. The real
 * mark is flat, has its own silhouette, and reads on either theme, so nothing
 * here flips with the colour scheme.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <Image
      src="/landing/gatepass-logo.png"
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      priority
    />
  );
}

export function BrandLockup({ size = 28, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <span className="flex items-center gap-2">
      <BrandMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[1.02rem] font-semibold tracking-[-0.035em] text-fg">Gatepass</span>
        {subtitle && <span className="mt-1.5 text-[0.68rem] tracking-[0.02em] text-fg-muted">{subtitle}</span>}
      </span>
    </span>
  );
}
