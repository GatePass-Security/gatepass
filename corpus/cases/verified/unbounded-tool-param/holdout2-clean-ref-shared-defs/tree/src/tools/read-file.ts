import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import commonSchema from "../../schemas/common.schema.json" with { type: "json" };
import argsSchema from "../../schemas/read-file.args.json" with { type: "json" };

const ajv = new Ajv2020({ schemas: [commonSchema], allErrors: true });
addFormats(ajv);
const validateArgs = ajv.compile(argsSchema);

const CHECKOUT_ROOT = resolve(process.env.CHECKOUT_ROOT ?? "/srv/checkout");

export const readFileTool = {
  name: "read_repo_file",
  description: "Read the first N lines of a file from the checked-out repository.",
  inputSchema: argsSchema,
};

export function readRepoFile(args: unknown): string {
  if (!validateArgs(args)) {
    throw new Error(`invalid arguments: ${ajv.errorsText(validateArgs.errors)}`);
  }

  const { path, maxLines = 200 } = args as { path: string; maxLines?: number };
  const target = resolve(CHECKOUT_ROOT, path);
  if (!target.startsWith(CHECKOUT_ROOT + sep)) {
    throw new Error("path escapes the checkout root");
  }

  return readFileSync(target, "utf8").split("\n").slice(0, maxLines).join("\n");
}
