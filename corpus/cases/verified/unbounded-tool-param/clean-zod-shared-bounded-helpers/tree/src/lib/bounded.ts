import { z } from 'zod';

/**
 * Shared input primitives. Every tool parameter must be built from one of
 * these so that no schema can accidentally ship an unbounded field.
 */
export const shortText = (max = 120) => z.string().trim().min(1).max(max);

export const repoSlug = () => z.string().regex(/^[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/);

export const relPath = () =>
  z
    .string()
    .max(1024)
    .regex(/^[A-Za-z0-9._\-/]+$/)
    .refine((p) => !p.split('/').includes('..'), 'path traversal is not allowed');

export const pageSize = () => z.number().int().min(1).max(100);

export const idList = () => z.array(z.string().uuid()).min(1).max(50);
