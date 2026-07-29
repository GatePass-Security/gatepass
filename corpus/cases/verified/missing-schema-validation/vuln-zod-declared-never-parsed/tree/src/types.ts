import type { ZodTypeAny } from 'zod';

export interface ToolContext {
  requestId: string;
  log: { info: (obj: unknown, msg: string) => void };
}

export interface Tool<T> {
  name: string;
  description: string;
  schema: ZodTypeAny;
  handler: (args: T, ctx: ToolContext) => Promise<unknown>;
}
