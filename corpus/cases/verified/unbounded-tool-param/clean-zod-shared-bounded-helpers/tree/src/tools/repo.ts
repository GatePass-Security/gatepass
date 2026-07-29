import { z } from 'zod';
import { idList, pageSize, relPath, repoSlug, shortText } from '../lib/bounded.js';

export const ReadPathInput = z.object({
  repo: repoSlug(),
  path: relPath(),
  ref: shortText(80),
});

export const ListTreeInput = z.object({
  repo: repoSlug(),
  path: relPath(),
  perPage: pageSize(),
});

export const CloseIssuesInput = z.object({
  repo: repoSlug(),
  issueIds: idList(),
  comment: shortText(500),
});

export type ReadPathInput = z.infer<typeof ReadPathInput>;
export type ListTreeInput = z.infer<typeof ListTreeInput>;
export type CloseIssuesInput = z.infer<typeof CloseIssuesInput>;
