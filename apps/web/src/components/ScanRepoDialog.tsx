"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ScanLine, ShieldCheck, FlaskConical } from "lucide-react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import { ApiError, type RemoteScanResult } from "@/lib/types";
import { Button, Input, Badge } from "./ui";

/**
 * "Scan a repo" — the marketing site's primary call to action, wired to the
 * route that already implements it: `POST /v1/orgs/:org/scan-remote`
 * (apps/api/src/server.ts:163). Clone-and-scan needs the API's GitHub App
 * credentials, so the not-configured case is surfaced plainly rather than
 * rendered as a generic failure.
 */
export function ScanRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemoteScanResult | null>(null);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = repo.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.scanRemoteRepo(ORG_ID, target, ref.trim() || undefined);
      setResult(res);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && /repo fetcher/i.test(err.message)) {
        setError(
          "The API has no GitHub App credentials configured, so it cannot clone repositories. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_INSTALLATION_ID on the API service.",
        );
      } else if (err instanceof DOMException && err.name === "AbortError") {
        setError("The scan did not finish within 3 minutes. Large repositories may need the hosted runner.");
      } else {
        setError(err instanceof Error ? err.message : "Scan failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setRepo("");
    setRef("");
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-black/65 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-dialog-title"
        className="animate-gp-rise gp-card relative w-full max-w-lg shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="scan-dialog-title" className="text-[1rem] font-medium tracking-[-0.02em] text-fg">
              Scan a repository
            </h2>
            <p className="mt-1 text-[0.78rem] text-fg-muted">
              Gatepass clones the repo, scans it, and discards the working copy.
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
              Scanned <span className="font-mono text-accent">{result.repo}</span>
            </p>
            <p className="mt-1 font-mono text-[0.72rem] text-fg-muted">
              {result.sha.slice(0, 12)} · {result.ref}
            </p>

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
                  router.push("/findings");
                }}
              >
                View findings
              </Button>
              <Button variant="ghost" size="md" onClick={reset}>
                Scan another
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-5 py-5">
            <Input
              ref={inputRef}
              label="Repository"
              placeholder="owner/name"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              hint="A GitHub repository the Gatepass App can read."
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

            {error && (
              <p
                role="alert"
                className="rounded-[0.6rem] border border-critical-line bg-critical-soft px-3 py-2.5 text-[0.78rem] leading-relaxed text-critical"
              >
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="accent" size="md" isLoading={busy} disabled={!repo.trim()}>
                {!busy && <ScanLine size={15} aria-hidden="true" />}
                {busy ? "Scanning…" : "Run scan"}
              </Button>
            </div>
            {busy && (
              <p aria-live="polite" className="text-[0.72rem] text-fg-muted">
                Cloning and scanning. This can take a minute on a large repository.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
