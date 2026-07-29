import { INJECTION_RULES, type Severity } from "./injection-patterns.js";

export type ToolLike = {
  name: string;
  description: string;
  parameters?: Record<string, { description?: string; enum?: string[] }>;
};

export type Violation = {
  toolName: string;
  field: string;
  ruleId: string;
  severity: Severity;
  reason: string;
};

function fieldsOf(tool: ToolLike): Array<[string, string]> {
  const fields: Array<[string, string]> = [["description", tool.description]];
  for (const [param, schema] of Object.entries(tool.parameters ?? {})) {
    if (schema.description) fields.push([`${param}.description`, schema.description]);
    for (const value of schema.enum ?? []) fields.push([`${param}.enum`, value]);
  }
  return fields;
}

export function scanTools(tools: readonly ToolLike[]): Violation[] {
  const violations: Violation[] = [];
  for (const tool of tools) {
    for (const [field, text] of fieldsOf(tool)) {
      for (const rule of INJECTION_RULES) {
        if (rule.pattern.test(text)) {
          violations.push({
            toolName: tool.name,
            field,
            ruleId: rule.id,
            severity: rule.severity,
            reason: rule.reason,
          });
        }
      }
    }
  }
  return violations;
}

export function assertNoInjection(tools: readonly ToolLike[]): void {
  const violations = scanTools(tools);
  if (violations.length > 0) {
    const summary = violations.map((v) => `${v.toolName}#${v.field}:${v.ruleId}`).join(", ");
    throw new Error(`Refusing to publish poisoned tool metadata: ${summary}`);
  }
}
