import { ShieldCheck } from "lucide-react";
import type { Finding, Reproduction, Severity, Surface, Tier } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { TONE_FILL, TONE_SOFT, type Tone } from "@/components/ui/Stat";
import { FixKindBadge, SuggestedFixDetail } from "@/components/SuggestedFix";
import { confidencePercent, cx, severityToken, tierToken } from "@/lib/utils";

/**
 * Everything a finding says about itself, in one place.
 *
 * Extracted from the Findings page because the scan detail page needed the same thing and the
 * alternative was a second implementation. Two renderings of the same finding are worse than
 * they sound: the tier boundary is a product guarantee, so a surface that showed the
 * explanation but dropped the reproduction would quietly turn a verified finding into an
 * assertion — which is the one thing this schema exists to prevent.
 */

export const SURFACE_LABEL: Record<Surface, string> = {
  app_code: "App code",
  agent_code: "Agent code",
  mcp_server: "MCP server",
  tool_defs: "Tool definitions",
  permission_scopes: "Permission scopes",
};

/*
 * severityToken()/tierToken() are the single source for the ramp, but they return `string` so
 * lib/utils carries no dependency on the UI layer. Their outputs are exactly Tone members —
 * this is the one place that boundary is crossed, instead of every call site guessing.
 */
export const severityTone = (severity: Severity): Tone => severityToken(severity) as Tone;
export const tierTone = (tier: Tier): Tone => tierToken(tier) as Tone;

export function SectionLabel({ children }: { children: string }) {
  return <h3 className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">{children}</h3>;
}

/**
 * Verified findings are the product's guarantee, so the reproduction is given its own toned
 * panel rather than being one more paragraph in the stack.
 */
export function ReproductionPanel({ reproduction }: { reproduction: Reproduction }) {
  return (
    <section className={cx("rounded-[0.75rem] border p-4", TONE_SOFT.verified)}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-verified" aria-hidden="true" />
        <h3 className="text-[0.82rem] font-medium text-verified">Reproduction</h3>
        <Badge tone="verified" size="sm">
          {reproduction.kind}
        </Badge>
      </div>

      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[0.82rem] leading-relaxed text-fg-secondary marker:font-medium marker:text-verified">
        {reproduction.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <div className="mt-3 rounded-[0.6rem] border border-verified-line bg-surface px-3 py-2.5">
        <p className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Expected</p>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-fg-secondary">{reproduction.expected}</p>
      </div>
    </section>
  );
}

export function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Confidence</SectionLabel>
        <span data-numeric className="text-[0.82rem] font-medium text-research">
          {confidencePercent(confidence)}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Research confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised"
      >
        <div className={cx("h-full rounded-full", TONE_FILL.research)} style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

/**
 * The body of an opened finding: what it is, why it is claimed, and what to do about it.
 *
 * The order is the argument. The explanation comes first because it is the answer to "why am I
 * looking at this"; the tier evidence comes second because that is what makes the explanation
 * worth believing; the fix comes last because it is only useful once the first two have landed.
 */
export function FindingDetail({ finding }: { finding: Finding }) {
  return (
    <div className="space-y-5">
      <p className="text-[0.855rem] leading-relaxed text-fg-secondary">{finding.explanation}</p>

      {/*
        Exactly one of these renders, and which one is decided by the discriminated union rather
        than by a conditional someone could get wrong: a verified finding always has a
        reproduction and never a confidence score, and a research finding is the exact opposite.
      */}
      {finding.tier === "research" && <ConfidenceMeter confidence={finding.confidence} />}
      {finding.tier === "verified" && <ReproductionPanel reproduction={finding.reproduction} />}

      <section>
        <SectionLabel>Locations</SectionLabel>
        <ul className="mt-2 space-y-1.5">
          {finding.locations.map((loc, i) => (
            <li key={`${loc.path}:${loc.startLine}:${i}`} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[0.76rem] break-all text-fg-secondary">
                {loc.path}:{loc.startLine}-{loc.endLine}
              </span>
              <Badge tone="neutral" size="sm">
                {SURFACE_LABEL[loc.surface]}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionLabel>Surfaces affected</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {finding.surfaces.map((s) => (
            <Badge key={s} tone="neutral" size="sm">
              {SURFACE_LABEL[s]}
            </Badge>
          ))}
        </div>
      </section>

      {finding.suggestedFix && (
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel>Suggested fix</SectionLabel>
            <FixKindBadge kind={finding.suggestedFix.kind} />
          </div>
          <div className="mt-2">
            <SuggestedFixDetail fix={finding.suggestedFix} />
          </div>
        </section>
      )}
    </div>
  );
}
