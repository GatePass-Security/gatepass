import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  OPENAI_API_KEY: z.string().min(20),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().length(64),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
