import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import { db } from '../db.js';

export const ticketRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(['open', 'pending', 'closed']),
        cursor: z.string().uuid().optional(),
        take: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input, ctx }) => {
      return db.ticket.findMany({
        where: { orgId: ctx.orgId, status: input.status },
        cursor: input.cursor ? { id: input.cursor } : undefined,
        take: input.take,
      });
    }),

  comment: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return db.comment.create({
        data: {
          ticketId: input.ticketId,
          orgId: ctx.orgId,
          authorId: ctx.userId,
          body: input.body,
        },
      });
    }),
});
