import { initTRPC, TRPCError } from '@trpc/server';

export type Context = {
  orgId: string | null;
  userId: string | null;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.orgId || !ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { orgId: ctx.orgId, userId: ctx.userId } });
});
