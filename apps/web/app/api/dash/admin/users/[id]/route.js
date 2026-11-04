import { localOnly } from '@/lib/dash-auth';
import { getDb, getUser, setUserStatus, setUserLimit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { status?: active|banned, token_limit?: number|null }
export async function PUT(req, { params }) {
  const denied = localOnly(req);
  if (denied) return denied;
  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  getDb();
  if (!getUser(id)) return Response.json({ error: 'no such user' }, { status: 404 });
  try {
    if (body.status) setUserStatus(id, body.status);
    if (body.token_limit !== undefined) {
      setUserLimit(id, body.token_limit === null || body.token_limit === '' ? null : Number(body.token_limit));
    }
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 400 });
  }
  return Response.json({ user: getUser(id) });
}
