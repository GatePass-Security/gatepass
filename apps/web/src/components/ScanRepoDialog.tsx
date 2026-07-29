"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ScanLine, ShieldCheck, FlaskConical } from "lucide-react";
import { api } from "@/lib/api-client";
import { useOrgId } from "@/providers/SessionProvider";
import type { RemoteScanResult, ScanResult } from "@/lib/types";
import { explainError, type FriendlyError } from "@/lib/errors";
import { Button, Input, Badge, SegmentedControl, ErrorState } from "./ui";

/**
 * "Scan a repo" — the marketing site's primary call to action, wired to the two
 * routes that implement it: `POST /v1/orgs/:org/scan-remote` (clone a GitHub
 * repo) and `POST /v1/orgs/:org/scans` (scan a path already on the API host).
 * Both existed; only the first was reachable from the UI, which left the
 * local-path route callable by curl and by nothing else.
 *
 * Clone-and-scan needs the API's GitHub App credentials, so the not-configured
 * case is surfaced plainly rather than rendered as a generic failure.
 */
type Source = "github" | "path";

/** The clone result carries provenance a local-path scan has no equivalent for. */
function isRemote(r: ScanResult | RemoteScanResult): r is RemoteScanResult {
  return "sha" in r;
}

export function ScanRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const orgId = useOrgId();
  const [source, setSource] = useState<Source>("github");
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [result, setResult] = useState<ScanResult | RemoteScanResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Keep Tab inside the dialog — a modal that leaks focus to the page
      // behind it is not actually modal for keyboard users.
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const target = source === "github" ? repo.trim() : path.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res =
        source === "github"
          ? await api.scanRemoteRepo(orgId, target, ref.trim() || undefined)
          : await api.triggerScan(orgId, target);
      setResult(res);
      router.refresh();
    } catch (err) {
      /*
       * The three special cases that used to live here — missing GitHub App,
       * abort, everything else — are now rules in `lib/errors.ts`, so the same
       * causes read identically wherever they surface rather than only here.
       */
      setError(
        explainError(err, { action: source === "github" ? "clone and scan that repository" : "scan that path" }),
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setRepo("");
    setRef("");
    setPath("");
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
      {/* A plain scrim. The blur that used to sit here bought nothing over a
          near-black canvas and cost a compositing layer on every open. */}
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-dialog-title"
        className="animate-gp-rise gp-card relative w-full max-w-lg border-line-strong"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="scan-dialog-title" className="text-[1rem] font-medium tracking-[-0.02em] text-fg">
              Run a scan
            </h2>
            <p className="mt-1 text-[0.78rem] text-fg-muted">
              {source === "github"
                ? "Gatepass clones the repo, scans it, and discards the working copy."
                : "The engine runs against the directory in place. Nothing is uploaded or copied."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mt-1 -mr-1 cursor-pointer rounded-full p-2 text-fg-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        {result ? (
          <div className="px-5 py-5">
            <p className="text-[0.855rem] text-fg">
              Scanned <span className="font-mono text-accent">{isRemote(result) ? result.repo : target}</span>
            </p>
            {isRemote(result) && (
              <p className="mt-1 font-mono text-[0.72rem] text-fg-muted">
                {result.sha.slice(0, 12)} · {result.ref}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone="verified" dot>
                <ShieldCheck size={11} aria-hidden="true" />
                {result.verified} verified
              </Badge>
              <Badge tone="research" dot>
                <FlaskConical size={11} aria-hidden="true" />
                {result.research} research
              </Badge>
              {result.frameworks.map((f) => (
                <Badge key={f} tone="neutral">
                  {f}
                </Badge>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  onClose();
                  router.push(`/scans/${result.scanId}`);
                }}
              >
                Open scan
              </Button>
              <Button variant="ghost" size="md" onClick={reset}>
                Scan another
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-5 py-5">
            <SegmentedControl<Source>
              label="Scan source"
              value={source}
              onChange={(next) => {
                setSource(next);
                setError(null);
              }}
              options={[
                { value: "github", label: "GitHub repo" },
                { value: "path", label: "Path on host" },
              ]}
            />

            {source === "github" ? (
              <>
                <Input
                  ref={inputRef}
                  label="Repository"
                  placeholder="owner/name"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  hint="Any public repository. Private ones need the Gatepass GitHub App installed on them."
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <Input
                  label="Ref"
                  placeholder="HEAD"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  hint="Branch, tag, or commit. Defaults to the repository head."
                  autoComplete="off"
                  spellCheck={false}
                />
              </>
            ) : (
              <Input
                label="Directory"
                placeholder="/srv/checkouts/my-app"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                hint="An absolute path the API process can read. Nothing is uploaded — the engine runs where the files already are."
                autoComplete="off"
                spellCheck={false}
                required
              />
            )}

            {error && <ErrorState error={error} />}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" isLoading={busy} disabled={!target}>
                {!busy && <ScanLine size={15} aria-hidden="true" />}
                {busy ? "Scanning…" : "Run scan"}
              </Button>
            </div>
            {busy && (
              <p aria-live="polite" className="text-[0.72rem] text-fg-muted">
                {source === "github"
                  ? "Cloning and scanning. This can take a minute on a large repository."
                  : "Scanning. Large trees take longer to parse."}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
