const BASE = process.env.JIRA_BASE_URL ?? 'https://tracker.internal/api';

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${process.env.JIRA_TOKEN ?? ''}` },
  });
  if (!res.ok) throw new Error(`jira ${res.status}`);
  return res.json();
}

export function searchIssues(project: string, text: string, limit: number) {
  const query = new URLSearchParams({ project, text, limit: String(limit) });
  return get(`/issues?${query.toString()}`);
}

export function getIssue(key: string) {
  return get(`/issues/${encodeURIComponent(key)}`);
}
