import { localOnly } from '@/lib/dash-auth';
import { getDb, searchAll } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get('q') || '';
  if (q.trim().length < 2) return Response.json({ hits: [] });
  getDb();
  return Response.json({ hits: searchAll('local-dev', q.trim()) });
}
