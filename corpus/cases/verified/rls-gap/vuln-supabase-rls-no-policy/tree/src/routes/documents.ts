import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';

const db = createClient(
  process.env.SUPABASE_URL ?? 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

export async function documentRoutes(app: FastifyInstance) {
  app.get('/documents', async () => {
    const { data, error } = await db
      .from('documents')
      .select('id, org_id, title, body, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return { documents: data };
  });

  app.get('/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { data, error } = await db.from('documents').select('*').eq('id', id).single();

    if (error) throw error;
    return data;
  });
}
