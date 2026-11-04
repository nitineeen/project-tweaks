import { localOnly } from '@/lib/dash-auth';
import { getDb, getThread, ensureShareToken } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/dash/share { conversationId } → { url } (localhost dashboard only)
export async function POST(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.conversationId) return Response.json({ error: 'conversationId required' }, { status: 400 });
  getDb();
  if (!getThread(body.conversationId)) return Response.json({ error: 'no such conversation' }, { status: 404 });
  const token = ensureShareToken(body.conversationId);
  return Response.json({ url: `/share/${token}` });
}
