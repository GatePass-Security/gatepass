export interface Incident {
  id: string;
  title: string;
  severity: "minor" | "major";
  startedAt: string;
  resolvedAt: string | null;
}

const INCIDENTS: Incident[] = [
  {
    id: "inc_2026_07_19",
    title: "Elevated API latency in eu-west-1",
    severity: "minor",
    startedAt: "2026-07-19T09:12:00Z",
    resolvedAt: "2026-07-19T10:04:00Z",
  },
];

export function currentIncidents(): Incident[] {
  return INCIDENTS.filter((incident) => incident.resolvedAt === null);
}

export function uptime(): { api: number; dashboard: number } {
  return { api: 99.982, dashboard: 99.995 };
}
