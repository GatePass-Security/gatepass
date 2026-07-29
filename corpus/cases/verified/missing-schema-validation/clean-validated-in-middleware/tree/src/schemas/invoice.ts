import { z } from 'zod';

export const CreateInvoice = z.object({
  customerId: z.string().uuid(),
  amountCents: z.number().int().min(1).max(1_000_000),
  currency: z.enum(['usd', 'eur', 'gbp']).default('usd'),
  memo: z.string().max(280).default(''),
});

export const ListInvoices = z.object({
  status: z.enum(['draft', 'open', 'paid', 'void']),
  take: z.number().int().min(1).max(100).default(25),
});
