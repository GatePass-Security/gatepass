import { api } from "@/lib/api-client";
import type { BenchmarkData } from "@/lib/types";
import BenchmarkClient from "./BenchmarkClient";

export default async function BenchmarkPage() {
  let data: BenchmarkData[] = [];
  let error: string | null = null;

  try {
    const result = await api.getBenchmark();
    data = Array.isArray(result) ? result : [result];
  } catch (e) {
    // The message crosses the server/client boundary as a string because an
    // Error instance cannot be serialised. The client rebuilds one and hands it
    // to `ErrorPanel` — it is never rendered raw.
    error = e instanceof Error ? e.message : "Failed to load benchmark data";
  }

  return <BenchmarkClient data={data} error={error} />;
}
