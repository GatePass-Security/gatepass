"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cx } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

const KIND_STYLES: Record<ToastKind, { border: string; icon: ReactNode }> = {
  success: { border: "border-verified-line", icon: <CheckCircle2 size={16} className="text-verified" /> },
  error: { border: "border-critical-line", icon: <AlertTriangle size={16} className="text-critical" /> },
  info: { border: "border-line-strong", icon: <Info size={16} className="text-fg-muted" /> },
};

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      // Failures stay put. Auto-dismissing the one message the user needs to act
      // on is how a failed write ends up looking like a successful one.
      if (kind !== "error") setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        Two regions, not one. A screen reader learns the outcome of an action it
        cannot see — but a failure queued politely behind a success announcement
        and then auto-dismissed is a failure the user never hears about, so
        errors get their own assertive region.
      */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
          {toasts
            .filter((t) => t.kind === "error")
            .map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {toasts
            .filter((t) => t.kind !== "error")
            .map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  return (
    <div
      className={cx(
        "animate-gp-toast-in gp-chrome pointer-events-auto flex items-start gap-2.5 rounded-[0.8rem] border px-3.5 py-3 shadow-lg shadow-black/20",
        KIND_STYLES[toast.kind].border,
      )}
    >
      <span className="mt-0.5 shrink-0">{KIND_STYLES[toast.kind].icon}</span>
      <p className="flex-1 text-[0.82rem] leading-snug text-fg">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 cursor-pointer rounded p-0.5 text-fg-muted transition-colors hover:text-fg"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
