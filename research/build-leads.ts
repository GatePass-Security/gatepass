import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Turn the raw MCP survey into a segmented outreach list.
 *
 *   pnpm research:scan-mcp -- --limit 300     # produces mcp-survey-raw.json
 *   pnpm research:leads                       # this script
 *
 * WHY THIS EXISTS. The survey's published output is deliberately aggregate — the report never
 * names a repository (see the responsible-disclosure section of STATE-OF-MCP-SECURITY.md). But
 * every verified finding is also a warm introduction to exactly the person who would buy this
 * product, and those two facts are in tension only if you conflate the two artifacts. So: the
 * report stays anonymous and public; this list is named and private.
 *
 * The segmentation this adds over the raw scan is the load-bearing part. A finding in a solo
 * maintainer's weekend MCP server and a finding in a Series-A company's production server are
 * the same JSON and completely different commercially — the first is a disclosure you send
 * because it is the right thing to do, the second is a sales conversation. Sorting those by hand
 * across ~90 repositories is where outreach dies, so it is sorted here.
 *
 * OUTPUTS (all gitignored — they name vulnerable third-party repositories):
 *   out/leads.json                 machine-readable, scored and tiered
 *   out/disclosure-worklist.md     the sheet you actually work from, tier by tier
 *
 * NEVER commit these, never publish a repo name, and send the disclosure before the pitch —
 * the offer at the end of the mail converts precisely because the mail led with a gift.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const CACHE = path.join(OUT, "leads-gh-cache.json");

/**
 * Kept in sync with generate-report.ts. A CORS bug in an MCP server's HTTP layer is a general
 * web finding that happens to live in an MCP repo; only these classes are evidence about
 * agentic security, and only these justify leading a mail with "your MCP server".
 */
const AGENTIC_CLASSES = new Set([
  "tool-poisoning",
  "hbv",
  "unbounded-tool-param",
  "missing-schema-validation",
  "unauth-mcp-transport",
  "confused-deputy",
  "cross-surface-scope-mismatch",
  "over-permissioned-loop",
]);

const CLASS_TITLES: Record<string, string> = {
  "exposed-secret": "Hardcoded secret / credential",
  "cors-misconfig": "Wildcard CORS with credentials",
  "unpinned-dependency": "Unpinned dependency",
  "missing-schema-validation": "Tool input without schema validation",
  "rls-gap": "Multi-tenant table without row-level security",
  "unauth-mcp-transport": "Unauthenticated MCP transport",
  "unbounded-tool-param": "Unbounded tool parameter",
  "tool-poisoning": "Injected instructions in tool description",
  "confused-deputy": "Credential forwarding (confused deputy)",
  hbv: "Tool description hides real behaviour",
  "over-permissioned-loop": "Unbounded / over-permissioned agent loop",
  "cross-surface-scope-mismatch": "Tool scope vs client scope mismatch",
};

interface RawSample {
  classId: string;
  path: string;
  line?: number;
  isTest: boolean;
}

interface RawRepo {
  repo: string;
  stars: number;
  sha: string;
  error?: string;
  verified: number;
  verifiedProd: number;
  byClass: Record<string, number>;
  byClassProd: Record<string, number>;
  samples?: RawSample[];
}

/** The subset of GitHub metadata that changes the commercial read on a repository. */
interface OwnerMeta {
  ownerType: "Organization" | "User" | "unknown";
  /** Repo homepage, else the owner's blog. Presence of a site is the cheapest company signal. */
  site: string;
  /** Owner's self-declared company, when the owner is a User. */
  company: string;
  pushedAt: string;
  description: string;
}

type Tier = "A" | "B" | "C";

interface Lead {
  repo: string;
  owner: string;
  stars: number;
  sha: string;
  tier: Tier;
  score: number;
  reasons: string[];
  meta: OwnerMeta;
  agenticClasses: string[];
  generalClasses: string[];
  verifiedProd: number;
  /** The finding to lead the disclosure mail with: agentic first, production only. */
  headline?: RawSample;
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve({ code: err ? 1 : 0, stdout: stdout ?? "" }),
    );
  });
}

/**
 * GitHub metadata for one repo, memoised on disk.
 *
 * The cache is not an optimisation — a 300-repo survey against the unauthenticated search API
 * will exhaust the rate limit partway through, and re-running from scratch after a 403 loses
 * everything already fetched. `gh` supplies auth when it is installed and logged in; when it is
 * absent every repo degrades to `unknown` rather than failing the run, because a list tiered on
 * findings alone is still worth having.
 */
async function fetchMeta(repo: string, cache: Record<string, OwnerMeta>): Promise<OwnerMeta> {
  const hit = cache[repo];
  if (hit) return hit;

  const unknown: OwnerMeta = { ownerType: "unknown", site: "", company: "", pushedAt: "", description: "" };
  const { code, stdout } = await run("gh", ["api", `repos/${repo}`]);
  if (code !== 0) return unknown;

  let json: {
    owner?: { type?: string; login?: string; blog?: string };
    homepage?: string;
    pushed_at?: string;
    description?: string;
  };
  try {
    json = JSON.parse(stdout);
  } catch {
    return unknown;
  }

  const ownerType =
    json.owner?.type === "Organization" ? "Organization" : json.owner?.type === "User" ? "User" : "unknown";
  let site = json.homepage ?? "";
  let company = "";

  // The repo payload's embedded owner object is a stub — no blog/company. One extra call per
  // distinct owner fills those in, and it is the difference between "some GitHub user" and
  // "the CTO of a company with a product site".
  const login = json.owner?.login;
  if (login) {
    const who = ownerType === "Organization" ? "orgs" : "users";
    const { code: c2, stdout: s2 } = await run("gh", ["api", `${who}/${login}`]);
    if (c2 === 0) {
      try {
        const o: { blog?: string; company?: string } = JSON.parse(s2);
        if (!site) site = o.blog ?? "";
        company = o.company ?? "";
      } catch {
        /* leave the stub values; a missing blog is not an error worth failing the run over */
      }
    }
  }

  const meta: OwnerMeta = {
    ownerType,
    site,
    company,
    pushedAt: json.pushed_at ?? "",
    description: json.description ?? "",
  };
  cache[repo] = meta;
  return meta;
}

/** Days since a timestamp; Infinity when GitHub metadata was unavailable. */
function daysSince(iso: string, now: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (now - t) / 86_400_000;
}

/**
 * Score a repository as a commercial lead.
 *
 * The weights encode one judgement: **who owns it matters more than how bad the bug is.** A
 * critical finding in an abandoned personal project is worth a disclosure and nothing else,
 * while a moderate finding in an actively-maintained company repo is a sales call. Stars are
 * weighted lowest on purpose — popularity correlates with OSS reach, not with budget.
 */
function score(lead: Omit<Lead, "tier" | "score" | "reasons">, now: number): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;

  if (lead.meta.ownerType === "Organization") {
    s += 4;
    reasons.push("org-owned");
  } else if (lead.meta.company) {
    s += 2;
    reasons.push(`owner works at ${lead.meta.company}`);
  }

  if (lead.meta.site) {
    s += 2;
    reasons.push("has a product site");
  }

  if (lead.agenticClasses.length > 0) {
    s += 4;
    reasons.push(`agentic: ${lead.agenticClasses.join(", ")}`);
  }

  const age = daysSince(lead.meta.pushedAt, now);
  if (age <= 30) {
    s += 3;
    reasons.push("pushed in last 30d");
  } else if (age <= 90) {
    s += 1;
    reasons.push("pushed in last 90d");
  } else if (age !== Number.POSITIVE_INFINITY) {
    reasons.push(`stale (${Math.round(age)}d)`);
  }

  if (lead.stars >= 1000) {
    s += 2;
    reasons.push(`${lead.stars}★`);
  } else if (lead.stars >= 100) {
    s += 1;
    reasons.push(`${lead.stars}★`);
  }

  return { score: s, reasons };
}

/**
 * Tiers are the actual work queue, so they are cut on what you *do*, not on the score alone:
 * A gets a disclosure and a follow-up call, B gets a disclosure and one follow-up, C gets a
 * disclosure and nothing else. A repo with no company signal can never reach A no matter how
 * many findings it has — that guard is what stops the list filling with unmonetisable OSS.
 */
function tierOf(s: number, lead: Omit<Lead, "tier" | "score" | "reasons">): Tier {
  const commercial = lead.meta.ownerType === "Organization" || Boolean(lead.meta.company);
  if (!commercial) return "C";
  if (s >= 10 && lead.agenticClasses.length > 0) return "A";
  if (s >= 6) return "B";
  return "C";
}

const TIER_PLAYBOOK: Record<Tier, string> = {
  A: "Disclose today, then ask for 20 minutes. These are Segment A in GO-TO-MARKET.md — org-owned, active, with an agentic finding in their own production code.",
  B: "Disclose, one follow-up if they reply. Real companies, weaker signal — no agentic class, or a quiet repo.",
  C: "Disclose because it is the right thing to do. No follow-up, no pipeline. Ask for a testimonial or a referral, never a sale.",
};

async function main() {
  const rawPath = path.join(OUT, "mcp-survey-raw.json");
  const raw: RawRepo[] = await fs
    .readFile(rawPath, "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => {
      throw new Error(
        `${rawPath} not found. It is gitignored (it names vulnerable third-party repos), so regenerate it first:\n` +
          `  pnpm research:scan-mcp -- --limit 300`,
      );
    });

  const cache: Record<string, OwnerMeta> = await fs
    .readFile(CACHE, "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => ({}));

  // Only repos that actually have something to disclose. A clean scan is a fine outcome for the
  // maintainer and a non-event for outreach — there is no mail to send.
  const affected = raw.filter((r) => !r.error && r.verifiedProd > 0);
  const now = Date.now();
  const leads: Lead[] = [];

  for (const [i, r] of affected.entries()) {
    const meta = await fetchMeta(r.repo, cache);
    const prodClasses = Object.keys(r.byClassProd ?? {});
    const agenticClasses = prodClasses.filter((c) => AGENTIC_CLASSES.has(c));
    const generalClasses = prodClasses.filter((c) => !AGENTIC_CLASSES.has(c));

    // Lead the mail with a production agentic finding when one exists — that is the sentence
    // that makes the recipient care. Fall back to any production finding.
    const prodSamples = (r.samples ?? []).filter((s) => !s.isTest);
    const headline = prodSamples.find((s) => AGENTIC_CLASSES.has(s.classId)) ?? prodSamples[0];

    const base = {
      repo: r.repo,
      owner: r.repo.split("/")[0] ?? "",
      stars: r.stars,
      sha: r.sha,
      meta,
      agenticClasses,
      generalClasses,
      verifiedProd: r.verifiedProd,
      headline,
    };
    const { score: s, reasons } = score(base, now);
    leads.push({ ...base, score: s, reasons, tier: tierOf(s, base) });

    if ((i + 1) % 10 === 0) console.log(`  …${i + 1}/${affected.length} enriched`);
    await fs.writeFile(CACHE, JSON.stringify(cache, null, 2));
  }

  leads.sort((a, b) => b.score - a.score || b.verifiedProd - a.verifiedProd);
  await fs.writeFile(path.join(OUT, "leads.json"), JSON.stringify(leads, null, 2));

  const byTier = (t: Tier) => leads.filter((l) => l.tier === t);
  const ghMissing = leads.filter((l) => l.meta.ownerType === "unknown").length;

  const section = (t: Tier) => {
    const rows = byTier(t);
    if (rows.length === 0) return `### Tier ${t} — none\n`;
    const body = rows
      .map((l) => {
        const h = l.headline;
        const where = h ? `\`${h.path}${h.line ? `:${h.line}` : ""}\`` : "—";
        const cls = h ? (CLASS_TITLES[h.classId] ?? h.classId) : "—";
        return [
          `#### ${l.repo}  ·  score ${l.score}`,
          `- **Lead with:** ${cls} — ${where}`,
          `- **Commit:** \`${l.sha}\``,
          `- **Production findings:** ${l.verifiedProd}` +
            (l.agenticClasses.length ? ` · agentic: ${l.agenticClasses.join(", ")}` : "") +
            (l.generalClasses.length ? ` · general: ${l.generalClasses.join(", ")}` : ""),
          `- **Signals:** ${l.reasons.join(" · ") || "none"}`,
          l.meta.site ? `- **Site:** ${l.meta.site}` : "",
          l.meta.description ? `- **What they do:** ${l.meta.description}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    return `### Tier ${t} — ${rows.length} repo${rows.length === 1 ? "" : "s"}\n\n${TIER_PLAYBOOK[t]}\n\n${body}\n`;
  };

  const md = `# Disclosure worklist — PRIVATE, DO NOT COMMIT OR PUBLISH

Generated from \`mcp-survey-raw.json\` · ${affected.length} repositories with at least one
verified finding in production code, out of ${raw.length} scanned.

**Tier A ${byTier("A").length} · Tier B ${byTier("B").length} · Tier C ${byTier("C").length}**
${ghMissing > 0 ? `\n> ⚠ ${ghMissing} repos have no GitHub metadata (\`gh\` not installed, not authenticated, or rate-limited), so they were tiered on findings alone and are almost certainly under-ranked. Run \`gh auth login\` and re-run to fix.\n` : ""}
## Rules

1. **Never name these repositories publicly.** The published report is aggregate-only, and that
   promise is what makes maintainers reply instead of getting defensive.
2. **Give the fix, not just the finding.** The mail is a gift; the offer at the end is the ask.
3. **Send by email or a private GitHub security advisory** — never a public issue for a real
   vulnerability.
4. **Verify the line before you send it.** \`pnpm research:verify\` re-clones at the recorded SHA.
   One wrong finding costs more credibility than ten right ones earn.

Template: [\`LAUNCH-KIT.md\`](../../LAUNCH-KIT.md) → "Disclosure outreach".
Segmentation rationale: [\`GO-TO-MARKET.md\`](../../GO-TO-MARKET.md) §5.1.

---

${section("A")}
---

${section("B")}
---

${section("C")}`;

  await fs.writeFile(path.join(OUT, "disclosure-worklist.md"), md);

  console.log(
    `\nLeads: ${leads.length} affected repos → A ${byTier("A").length} · B ${byTier("B").length} · C ${byTier("C").length}`,
  );
  if (ghMissing > 0) console.log(`⚠ ${ghMissing} repos missing GitHub metadata — run 'gh auth login' and re-run.`);
  console.log(`  out/leads.json`);
  console.log(`  out/disclosure-worklist.md   ← work from this`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
