import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import type { Severity } from "@gatepass/findings";
import { lineAtIndex } from "@gatepass/engine";

/**
 * Verified detector: a build input that can change without a change to this repository.
 *
 * The question is not "is there a caret in package.json". It is: for every declared
 * ingredient of the build, does the declaration leave the resolved artifact unbounded, or
 * point it at a moving target? A `*`/`latest` range, a floating Docker tag, a GitHub Actions
 * branch ref, a git dependency with no revision and an open-ended Python requirement are the
 * same defect wearing five costumes — each lets a publish elsewhere (a hijacked maintainer
 * account, a typosquat, a force-pushed action branch) enter the build with no diff here.
 *
 * That test, not syntax, is also what clears the clean cases:
 *   - `image@sha256:…` is fine even though its tag says `latest`;
 *   - `uses: org/action@<40-hex>` is fine even though branches exist;
 *   - `pkg==1.2.3 --hash=sha256:…` is fine;
 *   - `requires-python = ">=3.11"` constrains the interpreter, not a dependency, and a
 *     package merely *named* `latest-version` is a name, not a range — both are read
 *     structurally rather than by grepping for the word.
 *
 * ── On bounded ranges, and why an absent lockfile is not evidence ──
 *
 * A BOUNDED range is not reported, whether or not a lockfile is committed. `^1.2.3`, `~1.2.3`
 * and `1.x` all carry an upper bound they cannot cross, which is the same property that
 * clears Python's `~=`. This detector previously reported a caret whenever no lockfile was
 * present, and that rule was wrong twice over:
 *
 *   - It measured a repository convention rather than the code. Libraries and published CLIs
 *     are advised NOT to commit a lockfile — it is ignored on install by every consumer — so
 *     the rule fired on correctly-configured packages purely for being libraries.
 *   - It disagreed with this detector's own remediation text, which tells the reader the
 *     problem is `*`, `latest` or an x-range. A caret was never in that account.
 *
 * The honest limit of this: a caret does let 1.2.4 into a build without a diff here, and most
 * real supply-chain attacks ship as a patch release. That is a genuine risk — but it is a
 * risk of *every* dependency that is not hash-pinned, so reporting it as an "unpinned
 * dependency" on manifests that already declare a ceiling makes the class fire on nearly
 * every JavaScript repository in existence and stop carrying information. The class is scoped
 * to references that are unbounded or moving; hash-pinning everything is a different control.
 *
 * A published git TAG is likewise treated as pinned, here and for Actions refs. A tag can in
 * principle be force-moved, but treating tags as mutable would report `actions/checkout@v4`,
 * which is the ordinary correct way to reference an action.
 */

interface Issue {
  file: ScanFile;
  index: number;
  subject: string;
  why: string;
  severity: Severity;
  fix: string;
}

/* ── shared helpers ─────────────────────────────────────────────────────────────────── */

function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

function isComment(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#") || t.startsWith("//");
}

/** Index of the first occurrence of `needle` at or after `from`, else `from`. */
function locate(content: string, needle: string, from = 0): number {
  const i = content.indexOf(needle, from);
  return i >= 0 ? i : Math.max(0, from);
}

/* ── npm manifests ──────────────────────────────────────────────────────────────────── */

const NPM_DIST_TAGS = /^(\*|x|latest|next|canary|beta|alpha|rc|dev|nightly|current|experimental)$/i;
/** Specs that point at something local or already resolved — not an external floating ref. */
const LOCAL_PROTOCOL = /^(workspace|file|link|portal|catalog|patch):/i;
const REMOTE_SPEC = /^(git\+|git:|git@|github:|gitlab:|bitbucket:|https?:\/\/)/i;

function classifyNpmSpec(spec: string): { severity: Severity; why: string; fix: string } | null {
  const s = spec.trim();
  if (s === "")
    return { severity: "high", why: "an empty range, which accepts any published version", fix: "an exact version" };
  if (LOCAL_PROTOCOL.test(s)) return null;

  // Aliased install: judge the aliased spec.
  if (/^npm:/i.test(s)) {
    const at = s.lastIndexOf("@");
    return at > 4
      ? classifyNpmSpec(s.slice(at + 1))
      : { severity: "high", why: "an alias with no version", fix: "an exact version" };
  }

  // Git / tarball dependencies: immutable only when a commit or tag ref is attached.
  if (REMOTE_SPEC.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s)) {
    const hash = s.indexOf("#");
    const ref = hash >= 0 ? s.slice(hash + 1) : "";
    if (/^[0-9a-f]{40}$/i.test(ref) || /^(semver:)?v?\d+\.\d+\.\d+/i.test(ref)) return null;
    if (ref === "")
      return {
        severity: "high",
        why: "a git/remote dependency with no ref, so it installs whatever the default branch points at today",
        fix: "a commit SHA, e.g. #a1b2c3…",
      };
    if (/^(main|master|head|develop|dev|trunk|latest|next)$/i.test(ref))
      return { severity: "high", why: `a git dependency pinned to the moving branch "${ref}"`, fix: "a commit SHA" };
    return null;
  }

  if (NPM_DIST_TAGS.test(s))
    return {
      severity: "high",
      why: `the floating range "${s}", which resolves to whatever is published now`,
      fix: "an exact version",
    };
  // Open-ended comparator with no ceiling.
  if (/^[>≥]=?\s*v?\d/.test(s) && !s.includes("<"))
    return {
      severity: "medium",
      why: `the open-ended range "${s}", which has no upper bound`,
      fix: "an exact version",
    };

  /* A bounded range — `^1.2.3`, `~1.2.3`, `1.x` — is deliberately NOT a finding, with or
     without a lockfile. See the note on bounded ranges at the top of this file. */
  return null;
}

const NPM_DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "resolutions", "overrides"] as const;

function scanNpmManifest(file: ScanFile): Issue[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(file.content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const issues: Issue[] = [];
  for (const field of NPM_DEP_FIELDS) {
    const table = pkg[field];
    if (!table || typeof table !== "object") continue;
    for (const [name, raw] of Object.entries(table as Record<string, unknown>)) {
      if (typeof raw !== "string") continue;
      const verdict = classifyNpmSpec(raw);
      if (!verdict) continue;
      issues.push({
        file,
        index: locate(file.content, `"${name}"`),
        subject: `Dependency "${name}" ("${raw}")`,
        why: verdict.why,
        severity: verdict.severity,
        fix: verdict.fix,
      });
    }
  }
  return issues;
}

/* ── container images ───────────────────────────────────────────────────────────────── */

const MUTABLE_TAGS =
  /^(latest|stable|edge|main|master|dev|devel|nightly|rolling|current|prod|production|slim|alpine)$/i;
const TEMPLATED = /^[$]|\$\{|\{\{|<|%/;

/** A container reference is immutable only when a digest names the exact image. */
function classifyImageRef(ref: string): { severity: Severity; why: string; fix: string } | null {
  const r = ref.trim().replace(/^["']|["']$/g, "");
  if (!r || TEMPLATED.test(r)) return null;
  if (/@sha256:[0-9a-f]{16,}/i.test(r) || /@sha512:/i.test(r)) return null;

  const nameAndTag = r.split("@")[0]!;
  if (/^scratch$/i.test(nameAndTag)) return null;
  const lastSlash = nameAndTag.lastIndexOf("/");
  const lastColon = nameAndTag.lastIndexOf(":");
  const tag = lastColon > lastSlash ? nameAndTag.slice(lastColon + 1) : "";

  if (tag === "")
    return {
      severity: "high",
      why: "no tag at all, which Docker resolves to the moving `:latest`",
      fix: "a digest, e.g. image@sha256:…",
    };
  if (MUTABLE_TAGS.test(tag))
    return {
      severity: "high",
      why: `the moving tag ":${tag}", which is repointed at a new image on every upstream release`,
      fix: "a digest, e.g. image@sha256:…",
    };
  // A version tag with no digest is still technically mutable, but it names a release.
  return null;
}

function scanDockerfile(file: ScanFile): Issue[] {
  const issues: Issue[] = [];
  const lines = file.content.split(/\r?\n/);
  const stages = new Set<string>();
  let offset = 0;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (isComment(line)) continue;
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!m) continue;
    const image = m[1]!;
    const alias = m[2];
    if (alias) stages.add(alias.toLowerCase());
    if (stages.has(image.toLowerCase())) continue; // reference to an earlier build stage
    const verdict = classifyImageRef(image);
    if (!verdict) continue;
    issues.push({
      file,
      index: lineStart + line.indexOf(image),
      subject: `Base image \`${image}\``,
      why: verdict.why,
      severity: verdict.severity,
      fix: verdict.fix,
    });
  }
  return issues;
}

/** `image:` keys in compose files, Kubernetes manifests, and CI service definitions. */
function scanYamlImages(file: ScanFile): Issue[] {
  const issues: Issue[] = [];
  /* The value must be on the same line as the key: `image:` alone is a YAML *key* (a job
     or service can legitimately be named "image"), not a container reference. */
  const re = /^[ \t-]*image[ \t]*:[ \t]+["']?([^"'\s#]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(file.content)) !== null) {
    if (m[1]!.endsWith(":")) continue; // a nested key, not a reference
    const verdict = classifyImageRef(m[1]!);
    if (!verdict) continue;
    issues.push({
      file,
      index: m.index,
      subject: `Container image \`${m[1]}\``,
      why: verdict.why,
      severity: verdict.severity,
      fix: verdict.fix,
    });
  }
  return issues;
}

/* ── GitHub Actions ─────────────────────────────────────────────────────────────────── */

/**
 * A branch ref is repointed on every push to that branch, so `@main` means "run whatever
 * that repository contains at the moment my job starts" — with this workflow's secrets. A
 * commit SHA is immutable; a release tag is a published artifact and is treated as
 * acceptable pinning.
 */
const MUTABLE_ACTION_REF = /^(main|master|head|develop|development|dev|trunk|latest|next|release|canary|nightly)$/i;

function scanWorkflow(file: ScanFile): Issue[] {
  const issues: Issue[] = [];
  const re = /^[ \t-]*uses[ \t]*:[ \t]+["']?([^"'\s#]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(file.content)) !== null) {
    const spec = m[1]!;
    if (spec.endsWith(":")) continue; // a nested key, not an action reference
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith(".\\")) continue; // local action
    if (TEMPLATED.test(spec)) continue;

    if (/^docker:\/\//i.test(spec)) {
      const verdict = classifyImageRef(spec.replace(/^docker:\/\//i, ""));
      if (verdict)
        issues.push({
          file,
          index: m.index,
          subject: `Action container \`${spec}\``,
          why: verdict.why,
          severity: verdict.severity,
          fix: verdict.fix,
        });
      continue;
    }

    const at = spec.lastIndexOf("@");
    const ref = at > 0 ? spec.slice(at + 1) : "";
    const action = at > 0 ? spec.slice(0, at) : spec;
    if (ref === "") {
      issues.push({
        file,
        index: m.index,
        subject: `Action \`${action}\``,
        why: "no ref at all, so the default branch is executed",
        severity: "high",
        fix: "a full commit SHA, e.g. org/action@a1b2c3…",
      });
      continue;
    }
    if (/^[0-9a-f]{40}$/i.test(ref)) continue; // immutable
    if (MUTABLE_ACTION_REF.test(ref)) {
      issues.push({
        file,
        index: m.index,
        subject: `Action \`${action}@${ref}\``,
        why: `the moving branch ref "${ref}" — the action's code can change without a commit in this repository, and it runs with this workflow's secrets`,
        severity: "high",
        fix: "a full commit SHA, e.g. org/action@a1b2c3…",
      });
    }
  }
  return issues;
}

/* ── Python ─────────────────────────────────────────────────────────────────────────── */

const PY_NAME = /^[A-Za-z0-9._-]+(\s*\[[^\]]*\])?/;

/**
 * A requirement is immutable when it names one version (`==`), carries a hash, or has a
 * ceiling. `>=x` alone floats forward forever, which is how a yanked-and-republished
 * package or a compromised release lands in a build unchanged.
 */
function classifyPySpec(entry: string): { severity: Severity; why: string; fix: string } | null {
  const s = entry.trim();
  if (s === "" || s.startsWith("#")) return null;
  if (/--hash=/i.test(s)) return null; // hash-pinned

  if (/^-e\s|^(git\+|https?:\/\/)/i.test(s)) {
    const url = s.replace(/^-e\s+/i, "");
    if (/@[0-9a-f]{40}\b/i.test(url) || /@v?\d+\.\d+/.test(url)) return null;
    return {
      severity: "high",
      why: "a VCS requirement with no pinned revision",
      fix: "append a commit SHA, e.g. git+https://…@a1b2c3…",
    };
  }
  if (s.startsWith("-")) return null; // pip option line (-r, --index-url, …)

  const nameMatch = PY_NAME.exec(s);
  if (!nameMatch) return null;
  const rest = s.slice(nameMatch[0].length).trim().split(/[;#]/)[0]!.trim();

  if (rest === "")
    return {
      severity: "high",
      why: "no version specifier at all, so pip installs the newest release",
      fix: "==<version>",
    };
  if (/==|===/.test(rest)) return null; // exact
  if (/~=/.test(rest)) return null; // compatible-release: has an implicit ceiling
  if (/</.test(rest)) return null; // bounded above
  if (/^[>≥]=?/.test(rest))
    return { severity: "medium", why: `the open-ended range "${rest}", which has no upper bound`, fix: "==<version>" };
  return null;
}

function scanRequirements(file: ScanFile, requireHashes: boolean): Issue[] {
  if (requireHashes || /--require-hashes/i.test(file.content)) return [];
  const issues: Issue[] = [];
  const raw = file.content.split(/\r?\n/);
  let offset = 0;
  let joined = "";
  let joinedStart = 0;

  const flush = () => {
    if (joined.trim() === "") return;
    const verdict = classifyPySpec(joined);
    if (verdict)
      issues.push({
        file,
        index: joinedStart,
        subject: `Requirement \`${joined.trim().split(/\s/)[0]}\``,
        why: verdict.why,
        severity: verdict.severity,
        fix: verdict.fix,
      });
    joined = "";
  };

  for (const line of raw) {
    const start = offset;
    offset += line.length + 1;
    if (joined === "") joinedStart = start;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      flush();
      continue;
    }
    if (trimmed.endsWith("\\")) {
      joined += " " + trimmed.slice(0, -1);
      continue;
    }
    joined += " " + trimmed;
    flush();
  }
  flush();
  return issues;
}

/**
 * TOML dependency declarations. Only array entries under `dependencies`/`requires` (and any
 * key under an `optional-dependencies` table) are treated as dependencies — which is why
 * `requires-python = ">=3.11"`, a scalar that constrains the interpreter, is never read as
 * one. Poetry's `[tool.poetry.dependencies]` table is handled separately, with `python`
 * excluded for the same reason.
 */
function scanPyproject(file: ScanFile): Issue[] {
  const issues: Issue[] = [];
  const lines = file.content.split(/\r?\n/);
  let section = "";
  let offset = 0;
  let buffer: string | null = null;
  let bufferStart = 0;

  const emitArray = (text: string, start: number) => {
    for (const q of text.matchAll(/["']([^"']+)["']/g)) {
      const verdict = classifyPySpec(q[1]!);
      if (!verdict) continue;
      issues.push({
        file,
        index: locate(file.content, q[1]!, start),
        subject: `Dependency \`${q[1]}\``,
        why: verdict.why,
        severity: verdict.severity,
        fix: verdict.fix,
      });
    }
  };

  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();

    if (buffer !== null) {
      buffer += "\n" + line;
      if (trimmed.includes("]")) {
        emitArray(buffer, bufferStart);
        buffer = null;
      }
      continue;
    }
    if (trimmed.startsWith("#")) continue;

    const header = /^\[([^\]]+)\]/.exec(trimmed);
    if (header) {
      section = header[1]!.toLowerCase();
      continue;
    }

    const arrayKey = /^([A-Za-z0-9_.-]+)\s*=\s*\[/.exec(trimmed);
    if (arrayKey) {
      const key = arrayKey[1]!.toLowerCase();
      const isDepArray = key === "dependencies" || key === "requires" || section.endsWith("optional-dependencies");
      if (!isDepArray) continue;
      if (trimmed.includes("]")) emitArray(trimmed, start);
      else {
        buffer = line;
        bufferStart = start;
      }
      continue;
    }

    // Poetry / Pipfile scalar tables: `name = "^1.2.3"`.
    if (/dependencies$/.test(section) || section === "packages" || section === "dev-packages") {
      const scalar = /^([A-Za-z0-9._-]+)\s*=\s*["']([^"']*)["']/.exec(trimmed);
      if (!scalar) continue;
      const name = scalar[1]!;
      if (/^python$/i.test(name)) continue; // interpreter constraint, not a dependency
      const verdict = classifyNpmSpec(scalar[2]!) ?? classifyPySpec(`${name}${scalar[2]}`);
      if (!verdict) continue;
      issues.push({
        file,
        index: start,
        subject: `Dependency \`${name}\` ("${scalar[2]}")`,
        why: verdict.why,
        severity: verdict.severity,
        fix: verdict.fix,
      });
    }
  }
  return issues;
}

/* ── Cargo ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cargo manifests. Same question as everywhere else — does this declaration name exactly one
 * immutable artifact — answered in Cargo's two spellings:
 *
 *   - a bare requirement string, `serde_json = "*"`;
 *   - an inline table, `dep = { git = "…", branch = "main" }` / `{ version = "1", … }`.
 *
 * Two shapes are reported, and both are unbounded for reasons that hold regardless of
 * lockfile policy:
 *
 *   - `*` (and `x`): the wildcard requirement accepts *any* published version, including the
 *     next breaking major. There is no ceiling to fall back on.
 *   - a `git` dependency with no `rev` and no `tag`: `branch = "main"` resolves to whatever
 *     that branch's HEAD is at build time, and omitting the ref entirely resolves to the
 *     default branch's HEAD. Either way a force-push or a new commit in another repository
 *     enters this build with no diff here. A `rev` is a commit; a `tag` names a published
 *     release — both are treated as pinned, exactly as they are for npm git specs and for
 *     GitHub Actions refs.
 *
 * A plain caret/compatible requirement (`"1.0"`, `"^0.7"`, `"~1.2"`) is deliberately NOT
 * reported, for the same reason npm's and Python's bounded ranges are not: it carries an
 * implicit upper bound. Rust makes the point especially plainly — its own guidance is that
 * library crates do not commit `Cargo.lock`, so an absent lockfile is a statement about the
 * kind of crate this is, not about whether the build floats.
 */
const CARGO_DEP_SECTION = /(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)$/i;

/** `{ key = "value", … }` → the inline table's scalar entries. */
function parseInlineTable(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,}\s]+))/g)) {
    out.set(m[1]!.toLowerCase(), (m[2] ?? m[3] ?? m[4] ?? "").trim());
  }
  return out;
}

function classifyCargoVersion(spec: string): { severity: Severity; why: string; fix: string } | null {
  const s = spec.trim();
  if (/^\*$/.test(s) || /^[xX]$/.test(s) || /^\d+\.\*$/.test(s) || /^\d+\.\d+\.\*$/.test(s))
    return {
      severity: "high",
      why: `the wildcard requirement "${s}", which accepts any published version including the next breaking release`,
      fix: "an exact version, e.g. =1.2.3",
    };
  return null;
}

function classifyCargoTable(table: Map<string, string>): { severity: Severity; why: string; fix: string } | null {
  if (table.has("path")) return null; // a local crate in this workspace
  if (table.has("git")) {
    if (table.has("rev")) return null; // a commit is immutable
    if (table.has("tag")) return null; // a published release
    const branch = table.get("branch");
    return branch
      ? {
          severity: "high",
          why: `a git dependency pinned to the moving branch "${branch}", whose HEAD changes without a commit here`,
          fix: 'rev = "<commit sha>"',
        }
      : {
          severity: "high",
          why: "a git dependency with no rev or tag, so it resolves to whatever the default branch points at today",
          fix: 'rev = "<commit sha>"',
        };
  }
  const version = table.get("version");
  return version === undefined ? null : classifyCargoVersion(version);
}

function scanCargoManifest(file: ScanFile): Issue[] {
  const issues: Issue[] = [];
  let section = "";
  let offset = 0;

  for (const line of file.content.split(/\r?\n/)) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const header = /^\[\[?([^\]]+)\]\]?/.exec(trimmed);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      continue;
    }
    if (!CARGO_DEP_SECTION.test(section)) continue;

    const entry = /^["']?([A-Za-z0-9_.-]+)["']?\s*=\s*(.+?)\s*(?:#.*)?$/.exec(trimmed);
    if (!entry) continue;
    const name = entry[1]!;
    const rhs = entry[2]!;

    const verdict = rhs.startsWith("{")
      ? classifyCargoTable(parseInlineTable(rhs))
      : classifyCargoVersion(rhs.replace(/^["']|["']$/g, ""));
    if (!verdict) continue;

    issues.push({
      file,
      index: start,
      subject: `Crate \`${name}\``,
      why: verdict.why,
      severity: verdict.severity,
      fix: verdict.fix,
    });
  }
  return issues;
}

/* ── detector ───────────────────────────────────────────────────────────────────────── */

const MAX_PER_FILE = 12;

export const dependenciesDetector: Detector = {
  classIds: ["unpinned-dependency"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    // A CI step that installs with --require-hashes cannot install an unpinned requirement.
    const requireHashes = ctx.files.some((f) => /\.ya?ml$/i.test(f.relPath) && /--require-hashes/i.test(f.content));

    const issues: Issue[] = [];
    for (const file of ctx.files) {
      const base = baseName(file.relPath).toLowerCase();
      let produced: Issue[] = [];

      if (base === "package.json") produced = scanNpmManifest(file);
      else if (base.startsWith("dockerfile") || base.endsWith(".dockerfile") || base === "containerfile")
        produced = scanDockerfile(file);
      else if (/^(requirements|constraints)[\w.-]*\.txt$/i.test(base)) produced = scanRequirements(file, requireHashes);
      else if (base === "cargo.toml") produced = scanCargoManifest(file);
      else if (base === "pyproject.toml" || base === "pipfile") produced = scanPyproject(file);
      else if (/\.ya?ml$/i.test(base)) {
        produced =
          /(^|\/)\.github\/workflows\//i.test(file.relPath) || base === "action.yml" || base === "action.yaml"
            ? [...scanWorkflow(file), ...scanYamlImages(file)]
            : scanYamlImages(file);
      }

      issues.push(...produced.slice(0, MAX_PER_FILE));
    }

    const findings: DetectorFinding[] = [];
    const seen = new Set<string>();
    for (const issue of issues) {
      const line = lineAtIndex(issue.file.content, issue.index);
      const key = `${issue.file.relPath}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        tier: "verified",
        classId: "unpinned-dependency",
        severity: issue.severity,
        surfaces: issue.file.surfaces,
        locations: [{ path: issue.file.relPath, startLine: line, endLine: line, surface: issue.file.surfaces[0]! }],
        explanation:
          `${issue.subject} in ${issue.file.relPath}:${line} is declared with ${issue.why}. ` +
          `The build can therefore change without a change to this repository — an unreviewed, ` +
          `typosquatted or compromised version can enter it silently.`,
        reproduction: {
          kind: "inspection",
          steps: [
            `Open ${issue.file.relPath} at line ${line}.`,
            `Observe ${issue.subject} declared with ${issue.why}.`,
            `Re-resolve this manifest at a later date and compare the resolved artifact.`,
          ],
          expected: `The reference is not immutable; pin it to ${issue.fix} so the build is reproducible.`,
        },
      });
    }
    return findings;
  },
};
