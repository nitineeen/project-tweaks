import { localOnly } from '@/lib/dash-auth';
import { getDb, getThread, deleteConversation, clearConversations } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/dash/conversations { id } → one thread (messages + row)
// DELETE /api/dash/conversations { all: true } → every thread in the space
export async function DELETE(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  getDb();
  if (body.all === true) {
    clearConversations('local-dev');
    return Response.json({ ok: true, cleared: true });
  }
  if (!body.id || !getThread(body.id)) {
    return Response.json({ error: 'no such conversation' }, { status: 404 });
  }
  deleteConversation(body.id);
  return Response.json({ ok: true });
}
