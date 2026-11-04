import { localOnly } from '@/lib/dash-auth';
import { getDb, listProjects, createProject } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  getDb();
  return Response.json({ projects: listProjects() });
}

// POST { name, intention? }
export async function POST(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.name || !String(body.name).trim()) {
    return Response.json({ error: 'name required' }, { status: 400 });
  }
  getDb();
  const project = createProject('local-dev', String(body.name).trim().slice(0, 120), String(body.intention || '').slice(0, 500));
  return Response.json({ project });
}
