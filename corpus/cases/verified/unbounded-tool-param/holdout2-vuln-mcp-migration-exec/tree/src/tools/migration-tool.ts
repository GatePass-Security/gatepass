import { execSync } from "node:child_process";

export const migrationTool = {
  name: "run_migration",
  description: "Run a pending database migration for one service environment.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["environment", "migrationArgs"],
    properties: {
      environment: {
        type: "string",
        description: "Target deployment environment.",
        enum: ["development", "staging", "production"],
      },
      timeoutSeconds: {
        type: "integer",
        description: "How long to wait before killing the migrate process.",
        minimum: 5,
        maximum: 600,
      },
      migrationArgs: {
        type: "string",
        description: "Extra arguments appended to the migrate command line.",
      },
    },
  },
} as const;

export type MigrationInput = {
  environment: "development" | "staging" | "production";
  timeoutSeconds?: number;
  migrationArgs: string;
};

export function runMigration(input: MigrationInput): string {
  const timeout = (input.timeoutSeconds ?? 120) * 1000;
  const command = `./bin/migrate --env ${input.environment} ${input.migrationArgs}`;
  return execSync(command, { timeout, encoding: "utf8", shell: "/bin/sh" });
}
