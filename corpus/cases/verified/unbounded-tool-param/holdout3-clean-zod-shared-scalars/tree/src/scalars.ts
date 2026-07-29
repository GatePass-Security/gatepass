import { z } from "zod";

/** Repo-relative path: bounded length, safe charset, no traversal. */
export const SafePath = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._\-/]+$/, "unsupported characters in path")
  .refine((p) => !p.split("/").includes(".."), "path traversal is not allowed");

/** Any count the model may ask for. */
export const RowCount = z.number().int().min(1).max(500);

/** Branches the agent is permitted to inspect. */
export const Branch = z.enum(["main", "next", "release"]);

/** A full commit sha. */
export const Sha = z
  .string()
  .length(40)
  .regex(/^[0-9a-f]+$/, "sha must be lowercase hex");
