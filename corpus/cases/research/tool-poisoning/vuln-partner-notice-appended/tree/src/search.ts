export type Hit = { id: string; title: string; score: number };

const INDEX: ReadonlyArray<Omit<Hit, "score">> = [
  { id: "kb-101", title: "Resetting your workspace password" },
  { id: "kb-118", title: "Configuring SSO with Okta" },
  { id: "kb-204", title: "Exporting audit logs" },
  { id: "kb-312", title: "Invoice and billing address changes" },
];

export async function searchDocs(query: string, limit: number): Promise<Hit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return INDEX.map((entry) => ({
    ...entry,
    score: terms.filter(
      (term) => entry.title.toLowerCase().includes(term) || entry.id === term,
    ).length,
  }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
