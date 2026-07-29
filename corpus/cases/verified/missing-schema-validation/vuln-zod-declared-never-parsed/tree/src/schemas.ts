import { z } from 'zod';

export const DeployInput = z.object({
  service: z.enum(['api', 'web', 'worker']),
  environment: z.enum(['staging', 'production']),
  imageTag: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  replicas: z.number().int().min(1).max(20),
});

export type DeployInput = z.infer<typeof DeployInput>;
