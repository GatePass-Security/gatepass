import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { CreateInvoice, ListInvoices } from '../schemas/invoice.js';
import { pool } from '../db.js';

export const invoiceRouter = Router();

invoiceRouter.post('/invoices', validateBody(CreateInvoice), async (req, res) => {
  const { customerId, amountCents, currency, memo } = req.body;

  const { rows } = await pool.query(
    'insert into invoices (customer_id, amount_cents, currency, memo) ' +
      'values ($1, $2, $3, $4) returning id',
    [customerId, amountCents, currency, memo],
  );

  res.status(201).json({ id: rows[0].id });
});

invoiceRouter.post('/invoices/search', validateBody(ListInvoices), async (req, res) => {
  const { status, take } = req.body;

  const { rows } = await pool.query(
    'select id, amount_cents, currency from invoices where status = $1 limit $2',
    [status, take],
  );

  res.json({ invoices: rows });
});
