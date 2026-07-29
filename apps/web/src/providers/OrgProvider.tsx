"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { OrgRecord } from "@/lib/types";
import { api } from "@/lib/api-client";
import { useOrgId } from "./SessionProvider";

/**
 * The org record (plan tier, analysis toggles) for the signed-in session's org.
 *
 * The id used to come from `ORG_ID` — the literal `"demo"` in `lib/constants.ts`. It now comes
 * from `useOrgId()`, so this provider follows the session rather than a constant.
 */

interface OrgContextValue {
  org: OrgRecord | null;
  loading: boolean;
  /** The raw thrown value — consumers pass it to `explainError`. */
  error: unknown;
  refetch: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  loading: true,
  error: null,
  refetch: () => {},
});

export function OrgProvider({ children }: { children: ReactNode }) {
  const orgId = useOrgId();
  const [org, setOrg] = useState<OrgRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrg(await api.getOrg(orgId));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void fetchOrg();
  }, [fetchOrg]);

  return <OrgContext.Provider value={{ org, loading, error, refetch: fetchOrg }}>{children}</OrgContext.Provider>;
}

export const useOrg = () => useContext(OrgContext);
export default OrgContext;
