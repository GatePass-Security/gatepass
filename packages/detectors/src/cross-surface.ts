import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import { lineAtIndex } from "@gatepass/engine";
import type { Surface } from "@gatepass/findings";

/**
 * Cross-surface correlation (Constitution Principle IV, FR-002).
 *
 * The general shape: an app DECLARES the authority it needs on one surface — a GitHub App
 * manifest, an OAuth scope list, a Slack manifest, an MCP `server.json` — and EXERCISES
 * authority on another, in code. When the code needs more than the manifest declares, neither
 * surface is a finding on its own; the risk exists only in the gap between them.
 *
 * Two correlations are implemented, both emitting this class:
 *
 *   A. A tool that presents as tenant-scoped (its parameters name a userId/tenantId, or its
 *      description promises per-user data) backed by a data client with no row scoping.
 *
 *   B. Declared permissions vs. the permissions the call sites actually require. This covers
 *      GitHub App `permissions` vs Octokit methods, OAuth scope lists vs REST endpoints,
 *      Slack manifest scopes vs Web API methods, and MCP declared actions — including a
 *      `readOnlyHint: true` annotation contradicted by a write path in the implementation.
 *
 * Three rules keep this from becoming a noise generator, and each corresponds to a real design
 * that must not be flagged:
 *
 *   - Direction. Declaring MORE than you use is the safe direction. Only under-declaration is
 *     a finding.
 *   - Ownership. A manifest governs its own directory subtree, and a call site is matched to
 *     the NEAREST enclosing manifest. A monorepo with two apps and two manifests must never
 *     have one app's manifest cross-matched against the other app's code.
 *   - Enforcement. If a dispatch layer reads the manifest and refuses actions it does not
 *     declare, the declared set is enforced at runtime and the static gap is not exploitable.
 */

/* ── Shared helpers ──────────────────────────────────────────────────────────────────── */

type Lang = "js" | "py" | "go" | "java";

function langOf(relPath: string): Lang | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) return "js";
  if (/\.py$/i.test(relPath)) return "py";
  if (/\.go$/i.test(relPath)) return "go";
  if (/\.java$/i.test(relPath)) return "java";
  return null;
}

function stripComments(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("#") ||
        t.startsWith("--")
      );
    })
    .join("\n");
}

function matchBrace(src: string, open: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/**
 * The subtree a manifest governs. A manifest that lives in a conventional config directory
 * describes the whole app around it; a manifest that lives in the app's own directory
 * describes only that app. This is what stops `apps/pr-reviewer/app.yml` from being matched
 * against `apps/release-bot/src/tag.ts`.
 */
const CONFIG_DIRS = new Set([
  ".github",
  "github",
  "config",
  "configs",
  ".config",
  "mcp",
  ".mcp",
  ".well-known",
  "manifest",
  "manifests",
  "meta",
  "etc",
]);

function appRoot(manifestPath: string): string {
  const dir = dirOf(manifestPath);
  if (dir === "") return "";
  if (CONFIG_DIRS.has(baseOf(dir).toLowerCase())) return dirOf(dir);
  return dir;
}

function underRoot(filePath: string, root: string): boolean {
  return root === "" || filePath === root || filePath.startsWith(root + "/");
}

/* ── Manifest model ──────────────────────────────────────────────────────────────────── */

type ManifestKind = "github-app" | "oauth" | "slack" | "mcp" | "chrome";

interface McpTool {
  name: string;
  readOnly: boolean;
  line: number;
}

interface Manifest {
  path: string;
  root: string;
  kind: ManifestKind;
  line: number;
  /** GitHub App style: resource -> level. */
  perms: Map<string, string>;
  /** OAuth / Slack / MCP style: opaque scope or action strings. */
  scopes: Set<string>;
  tools: McpTool[];
  content: string;
}

const LEVELS: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 };

/** GitHub App permission resources — the discriminator that identifies a GitHub App manifest. */
const GH_RESOURCES = new Set([
  "contents",
  "metadata",
  "pull_requests",
  "issues",
  "checks",
  "actions",
  "administration",
  "members",
  "organization_administration",
  "deployments",
  "statuses",
  "packages",
  "pages",
  "secrets",
  "workflows",
  "security_events",
  "environments",
  "discussions",
  "repository_hooks",
  "organization_hooks",
  "single_file",
  "vulnerability_alerts",
]);

/** Collect `key: value` pairs in the indented block under `key:`. */
function yamlMapBlock(content: string, key: string): { entries: [string, string][]; line: number } | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^(\\s*)${key}\\s*:\\s*(.*)$`).exec(lines[i]!);
    if (!m) continue;
    if ((m[2] ?? "").trim() !== "") continue; // scalar, not a block
    const base = m[1]!.length;
    const entries: [string, string][] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= base) break;
      const kv = /^\s*([\w.-]+)\s*:\s*(.+?)\s*$/.exec(line);
      if (kv) entries.push([kv[1]!.toLowerCase(), kv[2]!.replace(/["']/g, "").toLowerCase()]);
    }
    if (entries.length > 0) return { entries, line: i + 1 };
  }
  return null;
}

/** Every `- item` appearing in any block under a `scopes:` key, at any depth. */
function yamlScopes(content: string): { scopes: string[]; line: number } | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)scopes\s*:/.exec(lines[i]!);
    if (!m) continue;
    const base = m[1]!.length;
    const scopes: string[] = [];
    const inline = /scopes\s*:\s*\[(.+)\]/.exec(lines[i]!);
    if (inline) scopes.push(...inline[1]!.split(",").map((s) => s.trim().replace(/["']/g, "")));
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= base) break;
      const item = /^\s*-\s*(.+?)\s*$/.exec(line);
      if (item) scopes.push(item[1]!.replace(/["']/g, ""));
    }
    if (scopes.length > 0) return { scopes, line: i + 1 };
  }
  return null;
}

/** Every string in any array reached through a key named `scopes` (JSON manifests). */
function jsonScopes(node: unknown, underScopes = false, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) {
      if (underScopes && typeof v === "string") out.push(v);
      else jsonScopes(v, underScopes, out);
    }
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      jsonScopes(v, underScopes || /^(scopes?|oauth_scopes)$/i.test(k), out);
    }
  }
  return out;
}

function collectManifests(ctx: ScanContext): Manifest[] {
  const out: Manifest[] = [];

  for (const file of ctx.files) {
    const p = file.relPath.toLowerCase();
    const base = baseOf(p);
    const content = file.content;
    const root = appRoot(file.relPath);

    // GitHub App manifest (yaml or json): a permission map keyed by GitHub resources.
    if (/\.(ya?ml|json)$/.test(base)) {
      const block = yamlMapBlock(content, "default_permissions") ?? yamlMapBlock(content, "permissions");
      if (block) {
        const perms = new Map<string, string>();
        for (const [k, v] of block.entries) if (GH_RESOURCES.has(k) && v in LEVELS) perms.set(k, v);
        if (perms.size > 0) {
          out.push({
            path: file.relPath,
            root,
            kind: "github-app",
            line: block.line,
            perms,
            scopes: new Set(),
            tools: [],
            content,
          });
          continue;
        }
      }
    }

    let parsed: unknown = null;
    if (/\.json$/.test(base)) {
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }
    }

    /* Browser-extension manifest — identified by `manifest_version`. The permission list an
       installer is shown at install time is a declared surface exactly like a GitHub App's
       `permissions:` block, and the extension's own service worker is the code surface. */
    const ext = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    if (ext && typeof ext["manifest_version"] === "number") {
      const declared = new Set<string>();
      /* API permissions and host match patterns live in one set: the two never collide, because
         a host pattern always contains `://` and an API permission never does. MV2 put host
         patterns in `permissions`; MV3 split them out — reading both keeps one code path. */
      for (const key of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"]) {
        const list = ext[key];
        // An optional permission is still declared: the user can grant it without a new review.
        if (Array.isArray(list)) for (const p of list) if (typeof p === "string") declared.add(p);
      }
      const idx = content.search(/"permissions"/);
      out.push({
        path: file.relPath,
        root,
        kind: "chrome",
        line: idx >= 0 ? lineAtIndex(content, idx) : 1,
        perms: new Map(),
        scopes: declared,
        tools: [],
        content,
      });
      continue;
    }

    // Slack app manifest — identified by its oauth_config envelope.
    if (/oauth_config/i.test(content)) {
      const scopes = parsed ? jsonScopes(parsed) : (yamlScopes(content)?.scopes ?? []);
      if (scopes.length > 0) {
        const idx = content.search(/scopes/i);
        out.push({
          path: file.relPath,
          root,
          kind: "slack",
          line: idx >= 0 ? lineAtIndex(content, idx) : 1,
          perms: new Map(),
          scopes: new Set(scopes),
          tools: [],
          content,
        });
        continue;
      }
    }

    // MCP server manifest: declared per-provider actions and/or tool annotations.
    const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const isMcpName = /^(server|mcp|tools?)\.json$/.test(base) || base.endsWith(".mcp.json");
    if (rec && isMcpName && (Array.isArray(rec["tools"]) || rec["permissions"])) {
      const scopes = new Set<string>();
      const perms = rec["permissions"];
      if (perms && typeof perms === "object") {
        for (const [provider, actions] of Object.entries(perms as Record<string, unknown>)) {
          if (Array.isArray(actions)) {
            for (const a of actions) if (typeof a === "string") scopes.add(a.includes(":") ? a : `${provider}:${a}`);
          } else if (typeof actions === "string") {
            scopes.add(actions.includes(":") ? actions : `${provider}:${actions}`);
          }
        }
      }
      const tools: McpTool[] = [];
      for (const t of (rec["tools"] as unknown[] | undefined) ?? []) {
        if (!t || typeof t !== "object") continue;
        const tool = t as Record<string, unknown>;
        const name = typeof tool["name"] === "string" ? tool["name"] : "";
        if (!name) continue;
        const ann = (tool["annotations"] ?? {}) as Record<string, unknown>;
        const readOnly = ann["readOnlyHint"] === true || ann["destructiveHint"] === false;
        const idx = content.indexOf(`"${name}"`);
        tools.push({ name, readOnly, line: idx >= 0 ? lineAtIndex(content, idx) : 1 });
      }
      if (scopes.size > 0 || tools.some((t) => t.readOnly)) {
        out.push({ path: file.relPath, root, kind: "mcp", line: 1, perms: new Map(), scopes, tools, content });
        continue;
      }
    }

    // Plain OAuth scope list.
    if (rec && Array.isArray(rec["scopes"])) {
      const scopes = jsonScopes(rec);
      if (scopes.length > 0) {
        const idx = content.indexOf('"scopes"');
        out.push({
          path: file.relPath,
          root,
          kind: "oauth",
          line: idx >= 0 ? lineAtIndex(content, idx) : 1,
          perms: new Map(),
          scopes: new Set(scopes),
          tools: [],
          content,
        });
      }
    }
  }
  return out;
}

/* ── Requirements exercised by call sites ────────────────────────────────────────────── */

interface Requirement {
  /** GitHub App style. */
  resource?: string;
  level?: string;
  /** OAuth / Slack / MCP / browser-extension style. */
  scope?: string;
  provider: "github" | "slack" | "mcp" | "chrome";
  what: string;
  line: number;
  /** A destination the code reaches, rather than an API it calls — worded differently. */
  isDestination?: boolean;
}

const GH_NS: Record<string, string> = {
  repos: "contents",
  git: "contents",
  pulls: "pull_requests",
  issues: "issues",
  checks: "checks",
  actions: "actions",
  orgs: "members",
  teams: "members",
  projects: "issues",
  reactions: "issues",
  packages: "packages",
  codeScanning: "security_events",
  secretScanning: "security_events",
  dependabot: "security_events",
};

/** Known exceptions where the namespace does not imply the permission resource. */
const GH_OVERRIDES: Record<string, [string, string]> = {
  "repos.createCommitStatus": ["statuses", "write"],
  "repos.listCommitStatusesForRef": ["statuses", "read"],
  "repos.getCombinedStatusForRef": ["statuses", "read"],
  "repos.createDeployment": ["deployments", "write"],
  "repos.createDeploymentStatus": ["deployments", "write"],
  "repos.listDeployments": ["deployments", "read"],
  "repos.get": ["metadata", "read"],
  "repos.listForOrg": ["metadata", "read"],
  "repos.addCollaborator": ["administration", "write"],
  "repos.createWebhook": ["repository_hooks", "write"],
  "repos.createOrUpdateEnvironmentSecret": ["secrets", "write"],
  "repos.createDispatchEvent": ["contents", "write"],
  "actions.createWorkflowDispatch": ["actions", "write"],
  "orgs.setMembershipForUser": ["members", "write"],
  "orgs.removeMembershipForUser": ["members", "write"],
  "orgs.listMembers": ["members", "read"],
};

const READ_VERB =
  /^(get|list|check|compare|download|is|has|find|search|retrieve|fetch|read|count|exists|render|preview)/;
const WRITE_VERB =
  /^(create|update|delete|add|remove|set|merge|submit|upload|dismiss|lock|unlock|transfer|rename|replace|move|dispatch|request|enable|disable|rerequest|rerun|cancel|approve|decline|accept|start|stop|restart|sync|push|apply|write|put|post|patch|edit|assign|unassign|invite|revoke|generate|convert|mark|clear|reset|force|import|install|uninstall|publish|unpublish|archive|restore)/;

function verbLevel(method: string): string | null {
  if (READ_VERB.test(method)) return "read";
  if (WRITE_VERB.test(method)) return "write";
  return null;
}

/** OAuth scope required for a (method, path) pair on the GitHub REST API. */
function githubOauthScope(method: string, path: string): string | null {
  const write = /^(post|put|patch|delete)$/i.test(method);
  if (/^\/orgs\/[^/]+\/(memberships|members|teams|invitations|outside_collaborators)/.test(path))
    return write ? "admin:org" : "read:org";
  if (/^\/orgs\/[^/]+\/hooks/.test(path)) return write ? "admin:org_hook" : "read:org_hook";
  if (/^\/orgs\//.test(path)) return write ? "admin:org" : "read:org";
  if (/^\/user\/emails/.test(path)) return "user:email";
  if (/^\/user\/(followers|following)/.test(path)) return write ? "user:follow" : "read:user";
  if (/^\/user\b/.test(path)) return write ? "user" : "read:user";
  if (/^\/repos\/[^/]+\/[^/]+\/hooks/.test(path)) return write ? "admin:repo_hook" : "read:repo_hook";
  if (/^\/repos\/[^/]+\/[^/]+\/actions\/workflows/.test(path) && write) return "workflow";
  if (/^\/repos\//.test(path)) return "repo";
  if (/^\/gists/.test(path)) return write ? "gist" : null;
  if (/^\/notifications/.test(path)) return "notifications";
  return null;
}

/** GitHub App permission required for a (method, path) pair. */
function githubPathPermission(method: string, path: string): [string, string] | null {
  const level = /^(post|put|patch|delete)$/i.test(method) ? "write" : "read";
  if (/^\/orgs\/[^/]+\/(memberships|members|invitations|outside_collaborators)/.test(path)) return ["members", level];
  if (/^\/orgs\/[^/]+\/teams/.test(path)) return ["members", level];
  if (/^\/repos\/[^/]+\/[^/]+\/(contents|git|commits|branches|tags|releases)/.test(path)) return ["contents", level];
  if (/^\/repos\/[^/]+\/[^/]+\/pulls/.test(path)) return ["pull_requests", level];
  if (/^\/repos\/[^/]+\/[^/]+\/issues/.test(path)) return ["issues", level];
  if (/^\/repos\/[^/]+\/[^/]+\/check-(runs|suites)/.test(path)) return ["checks", level];
  if (/^\/repos\/[^/]+\/[^/]+\/statuses/.test(path)) return ["statuses", level];
  if (/^\/repos\/[^/]+\/[^/]+\/actions/.test(path)) return ["actions", level];
  if (/^\/repos\//.test(path)) return ["contents", level];
  return null;
}

const SLACK_SCOPES: Record<string, string> = {
  "chat.postmessage": "chat:write",
  "chat.postephemeral": "chat:write",
  "chat.update": "chat:write",
  "chat.delete": "chat:write",
  "chat.schedulemessage": "chat:write",
  "chat.memessage": "chat:write",
  "conversations.create": "channels:manage",
  "conversations.rename": "channels:manage",
  "conversations.archive": "channels:manage",
  "conversations.unarchive": "channels:manage",
  "conversations.invite": "channels:manage",
  "conversations.kick": "channels:manage",
  "conversations.settopic": "channels:manage",
  "conversations.setpurpose": "channels:manage",
  "conversations.close": "channels:manage",
  "conversations.open": "im:write",
  "conversations.join": "channels:join",
  "conversations.list": "channels:read",
  "conversations.info": "channels:read",
  "conversations.members": "channels:read",
  "conversations.history": "channels:history",
  "conversations.replies": "channels:history",
  "users.list": "users:read",
  "users.info": "users:read",
  "users.lookupbyemail": "users:read.email",
  "users.profile.set": "users.profile:write",
  "files.upload": "files:write",
  "files.uploadv2": "files:write",
  "files.delete": "files:write",
  "files.list": "files:read",
  "files.info": "files:read",
  "reactions.add": "reactions:write",
  "reactions.remove": "reactions:write",
  "reactions.list": "reactions:read",
  "pins.add": "pins:write",
  "pins.remove": "pins:write",
  "pins.list": "pins:read",
  "bookmarks.add": "bookmarks:write",
  "bookmarks.edit": "bookmarks:write",
  "usergroups.create": "usergroups:write",
  "usergroups.update": "usergroups:write",
  "usergroups.list": "usergroups:read",
  "team.info": "team:read",
  "emoji.list": "emoji:read",
  // Workspace-admin surface. These are the highest-authority Slack methods there are, so a
  // manifest that does not declare them and code that calls them is the widest possible gap.
  "admin.conversations.archive": "admin.conversations:write",
  "admin.conversations.delete": "admin.conversations:write",
  "admin.conversations.create": "admin.conversations:write",
  "admin.conversations.invite": "admin.conversations:write",
  "admin.conversations.rename": "admin.conversations:write",
  "admin.conversations.setteams": "admin.conversations:write",
  "admin.conversations.search": "admin.conversations:read",
  "admin.users.invite": "admin.users:write",
  "admin.users.remove": "admin.users:write",
  "admin.users.setadmin": "admin.users:write",
  "admin.users.setowner": "admin.users:write",
  "admin.users.list": "admin.users:read",
  "admin.teams.list": "admin.teams:read",
  "admin.usergroups.adduser": "admin.usergroups:write",
};

/**
 * The same Web API method, keyed the way a non-JS SDK spells it.
 *
 * Slack's own Java, Kotlin and Go clients flatten `conversations.history` into a single camelCase
 * member — `slack.conversationsHistory(...)`, `slack.filesUploadV2(...)`,
 * `slack.adminConversationsArchive(...)`. There is no dot to key on, so a `namespace.method`
 * pattern is blind to every non-JS Slack app. Normalising both sides to letters-and-digits makes
 * the one table serve every SDK.
 */
const SLACK_FLAT: Map<string, { key: string; scope: string }> = new Map(
  Object.entries(SLACK_SCOPES).map(([key, scope]) => [key.replace(/[^a-z0-9]/gi, "").toLowerCase(), { key, scope }]),
);

/**
 * Chrome/WebExtension APIs whose use requires the same-named manifest permission. Deliberately a
 * closed list of the unambiguous ones: `chrome.tabs` and `chrome.windows` work without any
 * permission for most of their surface, so including them would flag ordinary extensions.
 */
const CHROME_PERMISSION_APIS = new Set([
  "cookies",
  "downloads",
  "history",
  "bookmarks",
  "topSites",
  "management",
  "debugger",
  "webRequest",
  "webNavigation",
  "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess",
  "alarms",
  "notifications",
  "contextMenus",
  "idle",
  "identity",
  "proxy",
  "privacy",
  "tabCapture",
  "desktopCapture",
  "pageCapture",
  "scripting",
  "storage",
  "sessions",
  "tabGroups",
  "readingList",
  "sidePanel",
  "offscreen",
  "power",
  "printing",
  "processes",
  "browsingData",
  "fontSettings",
  "contentSettings",
  "gcm",
  "platformKeys",
  "nativeMessaging",
  "wallpaper",
  "ttsEngine",
  "documentScan",
  "fileSystemProvider",
  "geolocation",
  "clipboardRead",
  "clipboardWrite",
]);

/** An absolute URL in request position inside an extension script. */
const EXT_REQUEST_URL =
  /\bfetch\s*\(\s*[`'"]([a-z][a-z0-9+.-]*:\/\/[^`'"\s]+)|\bnew\s+Request\s*\(\s*[`'"]([a-z][a-z0-9+.-]*:\/\/[^`'"\s]+)|\.\s*open\s*\(\s*[`'"][A-Za-z]+[`'"]\s*,\s*[`'"]([a-z][a-z0-9+.-]*:\/\/[^`'"\s]+)/gi;

/**
 * A Chrome match pattern — a wildcard scheme, a `*.` host suffix, or `<all_urls>` — against a
 * concrete origin. Only the scheme and host are compared. A pattern's path further NARROWS what
 * it grants, so ignoring it can only make this matcher more permissive — and for a rule whose
 * output is a finding, more permissive is the safe direction to be wrong in.
 */
function matchPatternCoversOrigin(pattern: string, scheme: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p === "<all_urls>") return /^(https?|wss?|ftp|file)$/.test(scheme);
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)/.exec(p);
  if (!m) return false;
  const pScheme = m[1]!;
  const pHost = m[2]!;
  // `*` as a scheme means http or https only — it never covers ws, ftp or file.
  if (pScheme === "*" ? !/^https?$/.test(scheme) : pScheme !== scheme) return false;
  if (pHost === "*") return true;
  if (pHost.startsWith("*.")) {
    const suffix = pHost.slice(2);
    return host === suffix || host.endsWith("." + suffix);
  }
  return host === pHost;
}
/** Alternatives that legitimately satisfy a required Slack scope (private/DM variants). */
const SLACK_ALTS: Record<string, string[]> = {
  "channels:manage": ["groups:write", "im:write", "mpim:write"],
  "channels:read": ["groups:read", "im:read", "mpim:read"],
  "channels:history": ["groups:history", "im:history", "mpim:history"],
  "chat:write": ["chat:write.public", "chat:write.customize"],
};

const AWS_S3_ACTIONS: Record<string, string> = {
  listobjects: "s3:ListBucket",
  listobjectsv2: "s3:ListBucket",
  listbuckets: "s3:ListAllMyBuckets",
  getobject: "s3:GetObject",
  headobject: "s3:GetObject",
  getobjecttagging: "s3:GetObject",
  getobjectattributes: "s3:GetObject",
  putobject: "s3:PutObject",
  copyobject: "s3:PutObject",
  uploadpart: "s3:PutObject",
  createmultipartupload: "s3:PutObject",
  completemultipartupload: "s3:PutObject",
  deleteobject: "s3:DeleteObject",
  deleteobjects: "s3:DeleteObject",
  createbucket: "s3:CreateBucket",
  deletebucket: "s3:DeleteBucket",
};

function normalisePath(raw: string): string {
  return raw
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/\{[^}]*\}/g, "*")
    .replace(/:[A-Za-z_]\w*/g, "*")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "");
}

function moduleConsts(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:const|let|var)?\s*\b([A-Za-z_$]\w*)\s*(?::=|=)\s*(["'`][^"'`\n]*["'`])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) if (!map.has(m[1]!)) map.set(m[1]!, m[2]!.slice(1, -1));
  return map;
}

function collectRequirements(file: ScanFile): Requirement[] {
  const lang = langOf(file.relPath);
  if (!lang) return [];
  const content = stripComments(file.content);
  const reqs: Requirement[] = [];
  const consts = moduleConsts(content);
  let m: RegExpExecArray | null;

  // ── GitHub via an Octokit-shaped client: `octokit.rest.repos.createOrUpdateFileContents`.
  if (/octokit|@octokit|api\.github\.com|github\./i.test(content)) {
    const re = /\b\w+\s*\.\s*(?:rest\s*\.\s*)?(\w+)\s*\.\s*(\w+)\s*\(/g;
    while ((m = re.exec(content))) {
      const ns = m[1]!;
      const method = m[2]!;
      const resource = GH_NS[ns];
      if (!resource) continue;
      const override = GH_OVERRIDES[`${ns}.${method}`];
      const level = override ? override[1] : verbLevel(method);
      if (!level) continue;
      reqs.push({
        resource: override ? override[0] : resource,
        level,
        provider: "github",
        what: `${ns}.${method}()`,
        line: lineAtIndex(content, m.index),
      });
    }

    // ── GitHub via raw REST: `session.put(f"{API}/orgs/{org}/memberships/{login}")`.
    const rest = /\b\w+\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*[fbru]*(["'`])((?:[^"'`\\]|\\.)*)\2/gi;
    while ((m = rest.exec(content))) {
      const method = m[1]!;
      let raw = m[3]!;
      const head = /^\$?\{(\w+)\}/.exec(raw);
      if (head) {
        const base = consts.get(head[1]!) ?? "";
        if (!/api\.github\.com/i.test(base)) continue;
        raw = raw.slice(head[0].length);
      } else if (/^https?:\/\//i.test(raw)) {
        if (!/api\.github\.com/i.test(raw)) continue;
        raw = raw.replace(/^https?:\/\/[^/]+/i, "");
      } else {
        continue;
      }
      const path = normalisePath(raw);
      if (!path.startsWith("/")) continue;
      const line = lineAtIndex(content, m.index);
      const perm = githubPathPermission(method, path);
      const scope = githubOauthScope(method, path);
      reqs.push({
        resource: perm?.[0],
        level: perm?.[1],
        scope: scope ?? undefined,
        provider: "github",
        what: `${method.toUpperCase()} ${path}`,
        line,
      });
    }

    // ── `octokit.request("PUT /orgs/{org}/memberships/{username}")`.
    const reqCall = /\.\s*request\s*\(\s*["'`](\w+)\s+([^"'`]+)["'`]/g;
    while ((m = reqCall.exec(content))) {
      const method = m[1]!;
      const path = normalisePath(m[2]!.replace(/^https?:\/\/[^/]+/i, ""));
      const perm = githubPathPermission(method, path);
      const scope = githubOauthScope(method, path);
      if (!perm && !scope) continue;
      reqs.push({
        resource: perm?.[0],
        level: perm?.[1],
        scope: scope ?? undefined,
        provider: "github",
        what: `${method.toUpperCase()} ${path}`,
        line: lineAtIndex(content, m.index),
      });
    }
  }

  // ── Slack Web API methods.
  if (/@slack\/|slack\.com\/api|WebClient|slack_sdk|slack_bolt|com\.slack\.api|MethodsClient/i.test(content)) {
    const re =
      /\b\w+\s*\.\s*(chat|conversations|users|files|reactions|pins|bookmarks|usergroups|team|emoji|views|admin)\s*\.\s*([\w.]+?)\s*\(/g;
    while ((m = re.exec(content))) {
      const key = `${m[1]!}.${m[2]!}`.toLowerCase();
      const scope = SLACK_SCOPES[key];
      if (!scope) continue;
      reqs.push({ scope, provider: "slack", what: key, line: lineAtIndex(content, m.index) });
    }
    // Flattened camelCase spelling used by every non-JS Slack SDK: `slack.usersList(...)`.
    const flat = /\.\s*([A-Za-z][A-Za-z0-9]{3,})\s*\(/g;
    while ((m = flat.exec(content))) {
      const hit = SLACK_FLAT.get(m[1]!.toLowerCase());
      if (!hit) continue;
      reqs.push({ scope: hit.scope, provider: "slack", what: hit.key, line: lineAtIndex(content, m.index) });
    }
    const api = /slack\.com\/api\/([\w.]+)/g;
    while ((m = api.exec(content))) {
      const scope = SLACK_SCOPES[m[1]!.toLowerCase()];
      if (scope) reqs.push({ scope, provider: "slack", what: m[1]!, line: lineAtIndex(content, m.index) });
    }
  }

  /* ── Browser-extension APIs. The manifest permission a WebExtension call needs is the API
     namespace itself — `chrome.cookies.getAll()` needs `cookies` — which makes the declared and
     exercised surfaces directly comparable without a per-method table. */
  if (/\b(?:chrome|browser)\s*\.\s*\w+\s*\.\s*\w+\s*\(/.test(content)) {
    const re = /\b(?:chrome|browser)\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g;
    while ((m = re.exec(content))) {
      const ns = m[1]!;
      if (!CHROME_PERMISSION_APIS.has(ns)) continue;
      reqs.push({
        scope: ns,
        provider: "chrome",
        what: `chrome.${ns}.${m[2]!}()`,
        line: lineAtIndex(content, m.index),
      });
    }
  }

  /* ── ...and the other half of the same declaration: a cross-origin request from an extension
     needs a host permission covering its origin. This is NOT gated on the file naming a
     `chrome.*` API, because a service worker that only fetches never touches one — and it costs
     nothing, since a requirement is only ever compared against a manifest that governs the file.
     Only URLs in REQUEST position count, in the comment-stripped view: a documentation link in a
     comment or a string built for display is not a request, and treating every absolute URL in a
     file as one would make the rule unusable. */
  EXT_REQUEST_URL.lastIndex = 0;
  while ((m = EXT_REQUEST_URL.exec(content))) {
    const url = m[1] ?? m[2] ?? m[3] ?? "";
    const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url);
    if (!parts) continue;
    const scheme = parts[1]!.toLowerCase();
    const host = parts[2]!.toLowerCase();
    // An extension's own resources need no permission, and a templated host cannot be judged.
    if (!/^(https?|wss?|ftp)$/.test(scheme) || /[${}*]/.test(host)) continue;
    reqs.push({
      scope: `${scheme}://${host}`,
      provider: "chrome",
      what: `${scheme}://${host}`,
      line: lineAtIndex(content, m.index),
      isDestination: true,
    });
  }
  EXT_REQUEST_URL.lastIndex = 0;

  // ── MCP-declared cloud actions, via AWS SDK command classes.
  const svc = /@aws-sdk\/client-([\w-]+)/.exec(content);
  if (svc) {
    const service = svc[1]!.toLowerCase();
    const re = /new\s+(\w+?)Command\s*\(/g;
    while ((m = re.exec(content))) {
      const cmd = m[1]!;
      const action = service === "s3" ? AWS_S3_ACTIONS[cmd.toLowerCase()] : undefined;
      reqs.push({
        scope: action ?? `${service}:${cmd.replace(/V\d$/, "")}`,
        provider: "mcp",
        what: `${cmd}Command`,
        line: lineAtIndex(content, m.index),
      });
    }
  }

  return reqs;
}

/* ── Satisfaction tests (under-declaration only) ─────────────────────────────────────── */

function levelSatisfied(declared: Map<string, string>, resource: string, level: string): boolean {
  const have = declared.get(resource);
  if (have === undefined) return false;
  return (LEVELS[have] ?? 0) >= (LEVELS[level] ?? 0);
}

const OAUTH_IMPLIES: Record<string, string[]> = {
  "admin:org": ["write:org", "read:org"],
  "write:org": ["read:org"],
  repo: ["public_repo", "repo:status", "repo_deployment", "repo:invite", "security_events", "read:repo_hook"],
  user: ["read:user", "user:email", "user:follow"],
  "admin:repo_hook": ["write:repo_hook", "read:repo_hook"],
  "write:repo_hook": ["read:repo_hook"],
  "admin:org_hook": ["read:org_hook"],
  "admin:public_key": ["write:public_key", "read:public_key"],
  "admin:gpg_key": ["write:gpg_key", "read:gpg_key"],
};

function expandOauth(declared: Set<string>): Set<string> {
  const out = new Set(declared);
  for (const s of declared) for (const implied of OAUTH_IMPLIES[s] ?? []) out.add(implied);
  return out;
}

function scopeSatisfied(kind: ManifestKind, declared: Set<string>, required: string): boolean {
  if (declared.has(required) || declared.has("*")) return true;
  if (kind === "chrome") {
    // An API permission is a bare word and was settled by the exact-match test above; anything
    // with a scheme is an origin, and origins are granted through match patterns.
    const origin = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i.exec(required);
    if (!origin) return false;
    return [...declared].some((p) => matchPatternCoversOrigin(p, origin[1]!.toLowerCase(), origin[2]!.toLowerCase()));
  }
  if (kind === "oauth") return expandOauth(declared).has(required);
  if (kind === "slack") return (SLACK_ALTS[required] ?? []).some((alt) => declared.has(alt));
  // MCP action strings support IAM-style wildcards.
  for (const d of declared) {
    if (d.endsWith(":*") && required.startsWith(d.slice(0, -1))) return true;
    if (d === required.split(":")[0] + ":*") return true;
  }
  return false;
}

/* ── Runtime enforcement derived from the manifest ───────────────────────────────────── */

const ENFORCEMENT_DENY =
  /(throw\b)|(raise\b)|(\bdeny\b)|(denied)|(not\s+(?:permitted|allowed|declared))|(Forbidden)|(403)|(status\s*[=(]\s*4)/i;
const ENFORCEMENT_CHECK =
  /(\.\s*includes\s*\()|(\.\s*has\s*\()|(\bin\s+\w)|(\.\s*indexOf\s*\()|(\bany\s*\()|(\.\s*some\s*\()/;

/**
 * A dispatch layer that reads the manifest and refuses undeclared actions enforces the
 * declared set at runtime, so the static gap cannot be reached.
 */
function hasDispatchEnforcement(ctx: ScanContext, manifest: Manifest): boolean {
  const manifestBase = baseOf(manifest.path);
  for (const file of ctx.files) {
    if (!langOf(file.relPath)) continue;
    if (!underRoot(file.relPath, manifest.root)) continue;
    const c = file.content;
    const readsManifest =
      c.includes(manifestBase) ||
      /\b(manifest|declaredScopes|declared_scopes|allowedActions|allowed_actions|declaredPermissions|declared_permissions|SCOPES|PERMISSIONS)\b/.test(
        c,
      );
    if (!readsManifest) continue;
    if (ENFORCEMENT_CHECK.test(c) && ENFORCEMENT_DENY.test(c)) return true;
  }
  return false;
}

/* ── readOnlyHint contradicted by the implementation ─────────────────────────────────── */

const MUTATION =
  /(new\s+(?:Delete|Put|Create|Update|Write|Remove)\w*Command\s*\()|(\bdelete\s+from\b)|(\binsert\s+into\b)|(\bupdate\b[^\n]*\bset\b)|(\bdrop\s+table\b)|(\btruncate\b)|(method\s*:\s*["'`](?:POST|PUT|PATCH|DELETE))|(\.\s*(?:unlink|rmdir|rm|writeFile|appendFile|rename|mkdir)\s*\()|(\.\s*(?:destroy|remove|deleteMany|deleteOne|insertOne|insertMany|updateOne|updateMany|drop)\s*\()/i;

interface Impl {
  path: string;
  file: ScanFile;
  body: string;
  /** Absolute offset of `body` within the file, so reported lines are the real ones. */
  bodyStart: number;
  content: string;
  line: number;
}

function matchParen(src: string, open: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

/**
 * The body block, not the parameter list. `function f(args: { key: string }) { ... }` opens a
 * brace inside its own signature, so taking the first `{` after the name yields the type
 * annotation and the real body is never examined.
 */
function bodyOf(content: string, declIndex: number): { body: string; start: number } {
  const paren = content.indexOf("(", declIndex);
  const afterSig = paren < 0 ? declIndex : matchParen(content, paren);
  const open = content.indexOf("{", afterSig);
  if (open >= 0 && open - afterSig < 200 && !content.slice(afterSig, open).includes(";")) {
    return { body: content.slice(open, matchBrace(content, open) + 1), start: open };
  }
  return { body: content.slice(declIndex, declIndex + 2000), start: declIndex };
}

function normaliseName(n: string): string {
  return n.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/** Index every named function/const declaration under `root`, keyed by normalised name. */
function indexImplementations(ctx: ScanContext, root: string): Map<string, Impl> {
  const index = new Map<string, Impl>();
  for (const file of ctx.files) {
    const lang = langOf(file.relPath);
    if (!lang) continue;
    if (!underRoot(file.relPath, root)) continue;
    const content = file.content;
    const decl =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]|^\s*(?:async\s+)?def\s+(\w+)\s*\(|func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = decl.exec(content))) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!name) continue;
      const key = normaliseName(name);
      if (index.has(key)) continue;
      const { body, start } =
        lang === "py" ? { body: content.slice(m.index, m.index + 2000), start: m.index } : bodyOf(content, m.index);
      index.set(key, {
        path: file.relPath,
        file,
        body,
        bodyStart: start,
        content,
        line: lineAtIndex(content, m.index),
      });
    }
  }
  return index;
}

/* ── Correlation A: scoped tool vs unscoped data client ──────────────────────────────── */

interface ScopedTool {
  name: string;
  path: string;
  root: string;
  line: number;
  reason: string;
}

const SCOPE_PARAM = /"(user_?id|tenant_?id|org_?id|account_?id|customer_?id)"/i;
const SCOPE_DESC = /(the user'?s|per-user|per-tenant|their own|for a (single )?(user|tenant|customer))/i;
const UNSCOPED_CLIENT =
  /(new\s+Pool\s*\()|(new\s+Client\s*\()|(createClient\s*\([^)]*service_role)|(application_name\s*[:=]\s*["'`][^"'`]*admin)/i;
const SCOPING_GUARD = /(withTenant|forUser|rls|row.?level|set\s+local\s+"?app\.|auth\.uid\(\)|tenant_id\s*=)/i;

function collectScopedTools(ctx: ScanContext): ScopedTool[] {
  const tools: ScopedTool[] = [];
  for (const file of ctx.files) {
    if (!file.surfaces.includes("tool_defs")) continue;
    let parsed: { tools?: { name?: string; description?: string; parameters?: Record<string, unknown> }[] };
    try {
      parsed = JSON.parse(file.content);
    } catch {
      continue;
    }
    for (const tool of parsed.tools ?? []) {
      const raw = JSON.stringify(tool);
      const byParam = SCOPE_PARAM.test(raw);
      const byDesc = tool.description ? SCOPE_DESC.test(tool.description) : false;
      if (!byParam && !byDesc) continue;
      const idx = tool.name ? file.content.indexOf(`"${tool.name}"`) : -1;
      tools.push({
        name: tool.name ?? "(anonymous)",
        path: file.relPath,
        root: appRoot(file.relPath),
        line: idx >= 0 ? lineAtIndex(file.content, idx) : 1,
        reason: byParam ? "takes a tenant-scoped parameter" : "description claims per-user scope",
      });
    }
  }
  return tools;
}

function correlateScopedTools(ctx: ScanContext): DetectorFinding[] {
  const tools = collectScopedTools(ctx);
  if (tools.length === 0) return [];
  const findings: DetectorFinding[] = [];

  for (const tool of tools) {
    for (const file of ctx.files) {
      if (!file.surfaces.includes("app_code")) continue;
      if (!underRoot(file.relPath, tool.root)) continue;
      if (SCOPING_GUARD.test(stripComments(file.content))) continue;
      const lines = file.content.split(/\r?\n/);
      lines.forEach((text, i) => {
        if (!UNSCOPED_CLIENT.test(text)) return;
        const confidence = tool.reason.startsWith("takes") ? 0.68 : 0.55;
        findings.push({
          tier: "research",
          classId: "cross-surface-scope-mismatch",
          severity: "high",
          surfaces: ["tool_defs", "app_code"],
          locations: [
            { path: tool.path, startLine: tool.line, endLine: tool.line, surface: "tool_defs" },
            { path: file.relPath, startLine: i + 1, endLine: i + 1, surface: "app_code" },
          ],
          explanation:
            `Tool "${tool.name}" (${tool.path}:${tool.line}) ${tool.reason}, but it is backed by an ` +
            `unscoped data client (${file.relPath}:${i + 1}). The tool looks tenant-safe while the ` +
            `client can read across all tenants — a mismatch only visible across both surfaces.`,
          confidence,
        });
      });
    }
  }
  return findings;
}

/* ── Correlation B: declared permissions vs exercised permissions ────────────────────── */

function surfaceOf(file: ScanFile): Surface {
  if (file.surfaces.includes("mcp_server")) return "mcp_server";
  if (file.surfaces.includes("agent_code")) return "agent_code";
  return "app_code";
}

function correlateManifests(ctx: ScanContext): DetectorFinding[] {
  const manifests = collectManifests(ctx);
  if (manifests.length === 0) return [];
  const findings: DetectorFinding[] = [];
  const enforced = new Map<string, boolean>();

  const owner = (filePath: string, kind: ManifestKind): Manifest | null => {
    let best: Manifest | null = null;
    for (const man of manifests) {
      if (man.kind !== kind) continue;
      if (!underRoot(filePath, man.root)) continue;
      if (!best || man.root.length > best.root.length) best = man;
    }
    return best;
  };

  for (const file of ctx.files) {
    if (!langOf(file.relPath)) continue;
    const reqs = collectRequirements(file);
    if (reqs.length === 0) continue;

    for (const req of reqs) {
      // Match this requirement to the nearest manifest that can express it.
      const kinds: ManifestKind[] =
        req.provider === "github"
          ? ["github-app", "oauth"]
          : req.provider === "slack"
            ? ["slack"]
            : req.provider === "chrome"
              ? ["chrome"]
              : ["mcp"];
      for (const kind of kinds) {
        const man = owner(file.relPath, kind);
        if (!man) continue;

        let missing: string | null = null;
        if (kind === "github-app") {
          if (!req.resource || !req.level) continue;
          if (!levelSatisfied(man.perms, req.resource, req.level)) {
            const have = man.perms.get(req.resource);
            missing = `${req.resource}: ${req.level} (manifest declares ${have ? `${req.resource}: ${have}` : "no such permission"})`;
          }
        } else {
          if (!req.scope) continue;
          if (!scopeSatisfied(kind, man.scopes, req.scope)) missing = req.scope;
        }
        if (!missing) continue;

        if (!enforced.has(man.path)) enforced.set(man.path, hasDispatchEnforcement(ctx, man));
        if (enforced.get(man.path)) continue;

        findings.push({
          tier: "research",
          classId: "cross-surface-scope-mismatch",
          severity: "high",
          surfaces: ["permission_scopes", surfaceOf(file)],
          locations: [
            { path: man.path, startLine: man.line, endLine: man.line, surface: "permission_scopes" },
            { path: file.relPath, startLine: req.line, endLine: req.line, surface: surfaceOf(file) },
          ],
          explanation:
            (req.isDestination
              ? `${file.relPath}:${req.line} sends a request to \`${req.what}\`, which no host permission declared ` +
                `at ${man.path}:${man.line} covers.`
              : `${file.relPath}:${req.line} calls \`${req.what}\`, which requires \`${missing}\`, but the manifest ` +
                `at ${man.path}:${man.line} does not declare it.`) +
            ` The declared surface understates the authority the code actually exercises, so reviewers and ` +
            `installers approve less than the app will use. Either declare the permission the code needs, or ` +
            `change the code to stay inside the declared set.`,
          confidence: 0.72,
        });
      }
    }
  }

  // readOnlyHint contradicted by the tool's own implementation.
  for (const man of manifests) {
    if (man.kind !== "mcp") continue;
    const readOnly = man.tools.filter((t) => t.readOnly);
    if (readOnly.length === 0) continue;
    if (!enforced.has(man.path)) enforced.set(man.path, hasDispatchEnforcement(ctx, man));
    if (enforced.get(man.path)) continue;
    const impls = indexImplementations(ctx, man.root);
    for (const tool of readOnly) {
      const impl = impls.get(normaliseName(tool.name));
      if (!impl || impl.path === man.path) continue;
      const hit = MUTATION.exec(stripComments(impl.body));
      if (!hit) continue;
      const line = lineAtIndex(impl.content, impl.bodyStart + hit.index);
      findings.push({
        tier: "research",
        classId: "cross-surface-scope-mismatch",
        severity: "high",
        surfaces: ["permission_scopes", surfaceOf(impl.file)],
        locations: [
          { path: man.path, startLine: tool.line, endLine: tool.line, surface: "permission_scopes" },
          { path: impl.path, startLine: line, endLine: line, surface: surfaceOf(impl.file) },
        ],
        explanation:
          `Tool "${tool.name}" is annotated \`readOnlyHint: true\` in ${man.path}:${tool.line}, but its ` +
          `implementation at ${impl.path}:${line} takes a destructive path (\`${hit[0].trim().slice(0, 60)}\`). ` +
          `Clients and human reviewers use that annotation to decide a tool is safe to auto-approve, so a write ` +
          `behind a read-only hint bypasses the consent the annotation earns. Drop the hint or split the write ` +
          `path into its own declared tool.`,
        confidence: 0.74,
      });
    }
  }

  return findings;
}

export const crossSurfaceScopeDetector: Detector = {
  classIds: ["cross-surface-scope-mismatch"],
  tier: "research",
  run(ctx: ScanContext): DetectorFinding[] {
    return [...correlateScopedTools(ctx), ...correlateManifests(ctx)];
  },
};
