import { spaceFromRequest } from '@/lib/auth';
import { getDb, getSave } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const auth = spaceFromRequest(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });
  const { id } = await params;
  getDb();
  const save = getSave(id);
  if (!save || save.deleted_at) return Response.json({ error: 'not found' }, { status: 404 });
  let topSignals = [];
  try {
    topSignals = JSON.parse(save.top_signals || '[]');
  } catch {
    topSignals = [];
  }
  return Response.json({
    id: save.id,
    status: save.status,
    folder_slug: save.folder_slug,
    meta_l1: save.meta_l1,
    meta_l2: save.meta_l2,
    meta_l3: save.meta_l3,
    meta_confidence: save.meta_confidence,
    top_signals: topSignals,
    ai_explanation: save.ai_explanation,
  });
}
