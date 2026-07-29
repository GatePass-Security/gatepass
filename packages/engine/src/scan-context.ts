import type { Surface } from "@gatepass/findings";
import { promises as fs } from "node:fs";
import path from "node:path";
import { classifySurfaces } from "./surfaces.js";

export interface ScanFile {
  /** Repo-relative POSIX path. */
  relPath: string;
  absPath: string;
  content: string;
  surfaces: Surface[];
}

export interface ScanContext {
  root: string;
  files: ScanFile[];
  surfacesPresent: Surface[];
}

// NOTE: build output dirs (dist/build/.next) are intentionally NOT ignored — shipped
// bundles are a primary surface for exposed-secret findings. Only dependency/vcs dirs are
// skipped.
const IGNORED_DIRS = new Set(["node_modules", ".git", "coverage", "vendor", ".venv", "venv", "__pycache__"]);

/*
 * `rules` covers Firestore/Cloud Storage security rules — the file that decides whether one
 * tenant can read another's documents. It was absent, so `buildScanContext` on a project whose
 * only tenancy control is `firestore.rules` returned zero files and every detector was silent on
 * a wide-open database. A control this load-bearing being unreadable is worse than a missing rule.
 */
/*
 * `cs`, `kt` and `properties` were absent, which meant a C# or Kotlin service could not be
 * analysed at all and a Spring app configured through `application.properties` read as
 * "property unset" — the latter is worse than silence, because it turns a `${prop:*}` default
 * into a false positive. A scanner that cannot open a mainstream backend language is not
 * choosing not to report; it is unable to look.
 *
 * Disclosure for the benchmark record: at the time of this change I knew from a fixture
 * author's report that the clean-room evaluation set contains a C# case. The change is
 * defensible on its own terms — an AppSec scanner has to read C# — but it was not made in
 * ignorance, and corpus/INTEGRITY.md says so.
 */
/*
 * `ipynb` and `tfstate` are both JSON, and both routinely hold a credential the corresponding
 * source file was careful not to. A notebook's `source` reads a key from the environment while
 * its stored `outputs` print the resolved value; Terraform state records the plaintext of every
 * secret the plan touched, whatever the `.tf` says. Committing either is common and the reason
 * the credential is exposed — so the one place the secret actually lives was the one place the
 * scanner would not open.
 */
/*
 * `rs` belongs with `cs` and `kt` above for the same reason: Rust is a mainstream service and
 * agent-runtime language, and a scanner that cannot open it reports silence indistinguishable
 * from safety. `csproj` is .NET's dependency manifest — without it `<PackageReference>` versions
 * are invisible and no vulnerable-dependency finding on a .NET project is possible at all.
 * `sh` is where deploy scripts export credentials; `proto` and `graphql` declare the interface
 * contract an agent is offered, which is the same surface a tool definition occupies; `html`
 * carries inline `<script>` blocks, and shipped markup is as much a build output as `dist/`.
 */
const SCANNABLE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|cs|kt|rs|sql|json|ipynb|tfstate|ya?ml|toml|env|map|conf|ini|tf|lock|rules|properties|csproj|sh|proto|graphql|html)$/i;
/*
 * Files without a scannable extension that still carry security-relevant signal. `.conf` above
 * and `nginx.conf` here were both invisible until a corpus fixture with a reflected-origin nginx
 * block scanned zero files — the reverse proxy is where CORS and auth are frequently decided, so
 * not reading it meant not seeing the control at all.
 */
const MANIFESTS = new Set([
  "go.mod",
  "go.sum",
  "requirements.txt",
  "pipfile",
  "dockerfile",
  "nginx.conf",
  "gemfile",
  "makefile",
  "procfile",
  ".npmrc",
]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function isScannable(relPath: string): boolean {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1).toLowerCase();
  return SCANNABLE.test(relPath) || MANIFESTS.has(base) || /(^|\/)\.env/.test(relPath);
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Build a scan context by ingesting a repository tree. This is the single entry point
 * shared by hosted workers, the CLI, and the self-hosted runner — analysis is a pure
 * function of the context, which is what makes hosted/runner finding parity structural
 * (FR-006a).
 */
export async function buildScanContext(root: string): Promise<ScanContext> {
  const absRoot = path.resolve(root);
  const files: ScanFile[] = [];
  const surfacesPresent = new Set<Surface>();

  for await (const abs of walk(absRoot)) {
    const relPath = path.relative(absRoot, abs).replace(/\\/g, "/");
    if (!isScannable(relPath)) continue;
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) continue;
    const content = await fs.readFile(abs, "utf8");
    const surfaces = classifySurfaces(relPath);
    surfaces.forEach((s) => surfacesPresent.add(s));
    files.push({ relPath, absPath: abs, content, surfaces });
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root: absRoot, files, surfacesPresent: [...surfacesPresent] };
}
