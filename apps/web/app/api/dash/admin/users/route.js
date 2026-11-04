import { localOnly } from '@/lib/dash-auth';
import { getDb, listUsers, createUser } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  getDb();
  return Response.json({ users: listUsers() });
}

// POST { email, name? }
export async function POST(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.email || !String(body.email).includes('@')) {
    return Response.json({ error: 'valid email required' }, { status: 400 });
  }
  getDb();
  try {
    const user = createUser({ email: body.email, name: body.name || '' });
    return Response.json({ user });
  } catch (e) {
    return Response.json({ error: 'could not create user (duplicate email?)' }, { status: 400 });
  }
}
