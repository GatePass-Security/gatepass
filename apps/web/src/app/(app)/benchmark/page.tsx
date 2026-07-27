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
    error = e instanceof Error ? e.message : "Failed to load benchmark data";
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <BenchmarkClient data={data} error={error} />
    </div>
  );
}
