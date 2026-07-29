/**
 * Patterns we refuse to publish inside a tool description, parameter
 * description or enum value. Derived from the published MCP tool-poisoning
 * advisories. Keep the list sorted by severity, then by id.
 */
export type Severity = "high" | "medium";

export type Rule = {
  id: string;
  severity: Severity;
  reason: string;
  pattern: RegExp;
};

export const INJECTION_RULES: readonly Rule[] = [
  {
    id: "TP-001",
    severity: "high",
    reason: "attempts to override the host system prompt",
    pattern: /ignore\s+(all\s+)?(previous|prior|earlier)\s+instructions/i,
  },
  {
    id: "TP-002",
    severity: "high",
    reason: "attempts to override the host system prompt",
    pattern: /disregard\s+(the\s+)?(above|system\s+prompt|guidelines)/i,
  },
  {
    id: "TP-003",
    severity: "high",
    reason: "asks the model to conceal an action from the user",
    pattern: /do\s+not\s+(tell|mention|reveal)[^.]{0,30}\buser\b/i,
  },
  {
    id: "TP-004",
    severity: "high",
    reason: "names a credential file as an exfiltration source",
    pattern: /(read|send|attach|exfiltrate)[^.]{0,40}(\.env\b|id_rsa|\.aws\/credentials)/i,
  },
  {
    id: "TP-005",
    severity: "medium",
    reason: "markup is not rendered to the user and can hide text",
    pattern: /<!--[\s\S]*?-->/,
  },
  {
    id: "TP-006",
    severity: "medium",
    reason: "invisible characters can hide text from human review",
    pattern: /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/,
  },
];
