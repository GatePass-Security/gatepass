# Contract: Findings Schema (canonical JSON)

The single findings format emitted by engine, CLI, runner, and hosted workers; consumed by
dashboard, PR commenter, gate, evidence, and benchmark. Versioned with the ruleset.

```jsonc
{
  "schema": "gatepass.findings/1",
  "scan": {
    "id": "uuid",
    "rulesetVersion": "2026.07.0",
    "executionMode": "hosted | runner | cli",
    "commitSha": "…",
    "surfacesScanned": ["app_code", "agent_code", "mcp_server", "tool_defs", "permission_scopes"]
  },
  "findings": [
    {
      "fingerprint": "sha256:…",              // stable across scans for dedupe
      "tier": "verified",                       // closed enum: verified | research
      "classId": "exposed-secret",
      "severity": "critical",
      "surfaces": ["app_code"],
      "locations": [{ "path": "…", "startLine": 1, "endLine": 3, "surface": "app_code" }],
      "explanation": "plain-language, always present",
      "reproduction": {                          // REQUIRED iff tier=verified (FR-008)
        "kind": "command | http | inspection",
        "steps": ["…"],                          // secrets redacted (edge case: redaction)
        "expected": "what confirms the issue"
      },
      "confidence": null,                        // REQUIRED (0.000–1.000) iff tier=research
      "suggestedFix": {                          // optional; see validation rules below
        "kind": "diff",
        "content": "human-readable rationale for the fix",
        "edit": {                                // REQUIRED iff kind="diff"; absent for "agent_guidance"
          "path": "…",
          "startLine": 12,
          "endLine": 12,
          "operation": "insert_after",
          "insertedLines": "…generated lines, never customer source…"
        }
      }
    }
  ]
}
```

**Validation rules (enforced by `packages/findings` on every producer and consumer):**

1. `tier=verified` ⇒ `reproduction` present ∧ `confidence` null.
2. `tier=research` ⇒ `confidence` present ∧ rendered UIs must display it (FR-010).
3. Unknown `tier` values are a hard parse error — no third state can enter the system.
4. `surfaces.length ≥ 2` marks a cross-surface finding (FR-002 reporting).
5. Reproduction steps must pass the redaction linter (no secret values verbatim).
6. `suggestedFix.kind="diff"` ⇔ `suggestedFix.edit` present; `kind="agent_guidance"` never
   carries `edit`. An `edit` is an `insert_after` operation anchored at an exact 1-indexed,
   inclusive `startLine`–`endLine` range; `insertedLines` is generated text and MUST NOT contain
   verbatim customer source, so the findings document itself never becomes a channel for source
   code.

**Backward compatibility**: `edit` is a new optional field, so every existing consumer of this
schema keeps parsing unchanged. The one tightening is that `kind="diff"` with no `edit` is now
rejected; no producer ever emitted `suggestedFix` before this change, so no document that exists
in the wild becomes invalid. The schema id stays `gatepass.findings/1`.

**Exports**: lossless JSON (above), SARIF 2.1.0 (tier encoded via `properties.tier`,
confidence via `properties.confidence`) for GitHub code-scanning ingestion.
