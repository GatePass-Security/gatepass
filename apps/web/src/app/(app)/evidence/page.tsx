"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSpreadsheet, ShieldCheck, Upload, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useOrgId } from "@/providers/SessionProvider";
import type { CompliancePlatform, DraftedAnswer, EvidenceExport, ScanSummary } from "@/lib/types";
import { pluralize, relativeTime, repoLabel } from "@/lib/utils";
import { errorToast } from "@/lib/errors";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorPanel,
  PageHeader,
  PageSkeleton,
  Select,
  Stat,
  Textarea,
  useToast,
} from "@/components/ui";

/**
 * Audit evidence: control coverage for a scan, export to a compliance platform,
 * and questionnaire drafting.
 *
 * All three routes existed and none of them had a page. `GET .../evidence`
 * returns control *coverage* (`EvidenceItem[]`), not a history of export jobs —
 * a distinction the old client's naming got wrong — so this reads as "which
 * controls does this scan satisfy", with every row citing the scan id and
 * ruleset version it was derived from (SC-008).
 */
type Status = "loading" | "ready" | "unreachable";

const PLATFORMS: Array<{ value: CompliancePlatform; label: string }> = [
  { value: "vanta", label: "Vanta" },
  { value: "drata", label: "Drata" },
];

const FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "XLSX" },
  { value: "sig-lite", label: "SIG Lite" },
];

const SAMPLE_QUESTIONNAIRE = `id,question
Q1,Do you scan application code for vulnerabilities before release?
Q2,Are secrets prevented from being committed to source control?
Q3,Do you enforce row-level security on multi-tenant data?`;

export default function EvidencePage() {
  const orgId = useOrgId();
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scanId, setScanId] = useState("");
  const [items, setItems] = useState<EvidenceExport[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<unknown>(null);
  const [loadingItems, setLoadingItems] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const rows = await api.listScans(orgId);
      const sorted = [...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setScans(sorted);
      /*
       * Opens on the newest scan that found something, not simply the newest.
       *
       * Control coverage is derived from a scan's findings, so opening on a clean one shows an
       * export with nothing in it — an accurate answer to a question nobody asked. Any scan is
       * still selectable; this only decides where the page starts.
       */
      const opening = sorted.find((s) => s.verified + s.research > 0) ?? sorted[0];
      setScanId((current) => current || (opening?.id ?? ""));
      setStatus("ready");
    } catch (err) {
      setFailure(err);
      setStatus("unreachable");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    setLoadingItems(true);
    api
      .getEvidence(orgId, scanId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, scanId]);

  if (status === "loading") return <PageSkeleton stats={3} rows={8} />;

  const description =
    "Control coverage derived from a scan, ready to hand to an auditor. Every row cites the scan and ruleset version it came from.";

  if (status === "unreachable") {
    return (
      <div className="space-y-6">
        <PageHeader title="Evidence" description={description} />
        <ErrorPanel error={failure} context={{ action: "load evidence" }} onRetry={() => void load()} />
      </div>
    );
  }

  if (scans.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Evidence" description={description} />
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="Nothing to evidence yet"
          description="Evidence is derived from a scan. Run one and its control coverage will appear here."
        />
      </div>
    );
  }

  const passing = items.filter((i) => i.status === "pass").length;
  const failing = items.length - passing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence"
        description={description}
        actions={
          <div className="w-full sm:w-72">
            <Select
              label="Scan"
              value={scanId}
              onChange={(e) => setScanId(e.target.value)}
              options={scans.map((s) => ({
                value: s.id,
                label: `${repoLabel(s.repo) ?? s.id.slice(0, 8)} — ${relativeTime(s.createdAt) || "unknown time"}`,
              }))}
            />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Controls assessed" value={items.length} tone="neutral" />
        <Stat label="Passing" value={passing} tone="verified" />
        <Stat label="Failing" value={failing} tone={failing > 0 ? "critical" : "neutral"} />
      </div>

      <Card
        padding={false}
        header={
          <CardTitle icon={<ShieldCheck size={15} aria-hidden="true" />}>
            {items.length > 0
              ? `${items.length} ${pluralize(items.length, "control")} · ruleset ${items[0]?.rulesetVersion ?? "—"}`
              : "Control coverage"}
          </CardTitle>
        }
      >
        <ControlTable items={items} loading={loadingItems} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ExportPanel scanId={scanId} controlCount={items.length} />
        <QuestionnairePanel scanId={scanId} />
      </div>
    </div>
  );
}

function ControlTable({ items, loading }: { items: EvidenceExport[]; loading: boolean }) {
  if (loading) {
    return <p className="px-5 py-10 text-center text-[0.82rem] text-fg-muted">Loading control coverage…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-[0.82rem] text-fg-muted">
        No control coverage was returned for this scan.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-[0.855rem]">
        <caption className="sr-only">Control coverage derived from the selected scan</caption>
        <thead>
          <tr className="border-b border-line bg-sunken">
            {["Control", "SOC 2", "ISO 27001", "Status", "Evidence"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-4 py-2.5 text-left text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.controlId}
              className="border-b border-line transition-colors last:border-b-0 hover:bg-raised/60"
            >
              <td className="px-4 py-3">
                <span className="block font-medium text-fg">{item.controlId}</span>
                <span className="mt-0.5 block max-w-[24rem] text-[0.75rem] leading-relaxed text-fg-muted">
                  {item.description}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-[0.76rem] text-fg-muted">{item.soc2}</td>
              <td className="px-4 py-3 font-mono text-[0.76rem] text-fg-muted">{item.iso27001}</td>
              <td className="px-4 py-3">
                {item.status === "pass" ? (
                  <Badge tone="verified" dot>
                    Pass
                  </Badge>
                ) : (
                  <Badge tone="critical" dot>
                    Fail
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-[0.75rem] text-fg-muted">
                {item.failingFingerprints.length > 0
                  ? `${item.failingFingerprints.length} ${pluralize(item.failingFingerprints.length, "finding")}`
                  : "No open findings"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Push control coverage into Vanta or Drata.
 *
 * This is the one control on the page that leaves the building, so it says so
 * before it is pressed rather than after — the button reads as a transfer to a
 * named third party, not a generic "Export".
 */
function ExportPanel({ scanId, controlCount }: { scanId: string; controlCount: number }) {
  const orgId = useOrgId();
  const { toast } = useToast();
  const [platform, setPlatform] = useState<CompliancePlatform>("vanta");
  const [busy, setBusy] = useState(false);
  const [delivered, setDelivered] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setDelivered(null);
    try {
      const res = await api.exportEvidence(orgId, scanId, platform);
      setDelivered(res.delivered);
      toast(`Delivered ${res.delivered} ${pluralize(res.delivered, "item")} to ${platform}`, "success");
    } catch (err) {
      toast(errorToast(err, { action: `send evidence to ${platform}` }), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card header={<CardTitle icon={<Upload size={15} aria-hidden="true" />}>Send to a compliance platform</CardTitle>}>
      <p className="text-[0.82rem] leading-relaxed text-fg-secondary">
        Transmits this scan&rsquo;s control coverage to your connected platform. Findings, control results and the
        originating scan id are sent; source code never is.
      </p>
      <div className="mt-4 space-y-3">
        <Select
          label="Platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as CompliancePlatform)}
          options={PLATFORMS}
        />
        <Button
          variant="secondary"
          size="md"
          isLoading={busy}
          disabled={!scanId || controlCount === 0}
          onClick={() => void run()}
        >
          <Upload size={15} aria-hidden="true" />
          Send {controlCount > 0 ? `${controlCount} ${pluralize(controlCount, "control")}` : "coverage"} to{" "}
          {platform === "vanta" ? "Vanta" : "Drata"}
        </Button>
        {delivered !== null && (
          <p aria-live="polite" className="flex items-center gap-1.5 text-[0.78rem] text-verified">
            <CheckCircle2 size={14} aria-hidden="true" />
            {delivered} {pluralize(delivered, "item")} delivered.
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Draft questionnaire answers from posture. Answers are drafts by construction —
 * the API returns `reviewStatus: "draft"` on every row and marks anything it
 * cannot ground as `needs_human_input` (FR-022/023), so this panel never
 * presents an answer as ready to send.
 */
function QuestionnairePanel({ scanId }: { scanId: string }) {
  const orgId = useOrgId();
  const { toast } = useToast();
  const [format, setFormat] = useState("csv");
  const [content, setContent] = useState(SAMPLE_QUESTIONNAIRE);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<DraftedAnswer[] | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await api.draftQuestionnaire(orgId, { scanId, format, content });
      setAnswers(res);
      toast(`Drafted ${res.length} ${pluralize(res.length, "answer")}`, "success");
    } catch (err) {
      toast(errorToast(err, { action: "draft answers" }), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      header={
        <CardTitle icon={<FileSpreadsheet size={15} aria-hidden="true" />}>Draft questionnaire answers</CardTitle>
      }
    >
      <p className="text-[0.82rem] leading-relaxed text-fg-secondary">
        Paste a security questionnaire. Gatepass drafts answers from this scan&rsquo;s posture and flags anything it
        cannot ground in a control result for a human to answer.
      </p>
      <div className="mt-4 space-y-3">
        <Select label="Source format" value={format} onChange={(e) => setFormat(e.target.value)} options={FORMATS} />
        <Textarea
          label="Questionnaire"
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
        <Button
          variant="secondary"
          size="md"
          isLoading={busy}
          disabled={!scanId || !content.trim()}
          onClick={() => void run()}
        >
          Draft answers
        </Button>
      </div>

      {answers && (
        <ul className="mt-4 space-y-2.5 border-t border-line pt-4" aria-live="polite">
          {answers.map((a) => (
            <li key={a.questionId} className="text-[0.82rem]">
              <span className="flex items-start gap-2">
                {a.status === "answered" ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-verified" aria-hidden="true" />
                ) : (
                  <XCircle size={14} className="mt-0.5 shrink-0 text-medium" aria-hidden="true" />
                )}
                <span className="min-w-0">
                  <span className="block text-fg">{a.question}</span>
                  <span className="mt-0.5 block leading-relaxed text-fg-muted">
                    {a.answer ?? "Needs a human answer — no control result grounds this question."}
                  </span>
                  {a.citations.length > 0 && (
                    <span className="mt-1 block font-mono text-[0.7rem] text-fg-muted">
                      {a.citations.map((c) => c.controlId).join(", ")}
                    </span>
                  )}
                </span>
              </span>
            </li>
          ))}
          <li className="pt-1 text-[0.72rem] text-fg-muted">
            Every answer is a draft for human review — none are submitted anywhere.
          </li>
        </ul>
      )}
    </Card>
  );
}
