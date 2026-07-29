import { Router } from 'express';
import { collections } from '../db.js';

export const searchRouter = Router();

// POST /api/search  { "filter": { ... }, "sort": { ... }, "limit": 25 }
searchRouter.post('/search', async (req, res) => {
  const { filter, sort, limit } = req.body;

  const docs = await collections.tickets
    .find(filter)
    .sort(sort)
    .limit(limit)
    .toArray();

  res.json({ count: docs.length, docs });
});

searchRouter.post('/search/count', async (req, res) => {
  const total = await collections.tickets.countDocuments(req.body.filter);
  res.json({ total });
});

searchRouter.patch('/tickets/:id', async (req, res) => {
  const result = await collections.tickets.updateOne(
    { _id: req.params.id },
    { $set: req.body },
  );
  res.json({ modified: result.modifiedCount });
});
