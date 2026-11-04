import { localOnly } from '@/lib/dash-auth';
import { getDb, emptyTrash } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  getDb();
  emptyTrash('local-dev');
  return Response.json({ ok: true });
}
