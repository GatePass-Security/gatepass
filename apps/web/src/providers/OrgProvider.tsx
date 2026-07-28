"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { OrgRecord } from "@/lib/types";
import { ORG_ID } from "@/lib/constants";
import { api } from "@/lib/api-client";

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
  const [org, setOrg] = useState<OrgRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  async function fetchOrg() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getOrg(ORG_ID);
      setOrg(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrg();
  }, []);

  return <OrgContext.Provider value={{ org, loading, error, refetch: fetchOrg }}>{children}</OrgContext.Provider>;
}

export const useOrg = () => useContext(OrgContext);
export default OrgContext;
