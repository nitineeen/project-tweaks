import { localOnly } from '@/lib/dash-auth';
import { getDb, putMemoryRow } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = {
  permanent: ['name', 'email', 'address'],
  occupational: ['role', 'company'],
  dynamic: ['current_project'],
  temporary: ['current_task'],
};

// PUT { layer, key, value }
export async function PUT(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  const { layer, key } = body;
  if (!ALLOWED[layer] || !ALLOWED[layer].includes(key)) {
    return Response.json({ error: 'layer/key not editable here' }, { status: 400 });
  }
  const value = String(body.value ?? '').slice(0, 2000);
  getDb();
  putMemoryRow('local-dev', layer, key, value, 100);
  return Response.json({ ok: true });
}
