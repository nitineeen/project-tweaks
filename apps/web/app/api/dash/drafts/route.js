import { localOnly } from '@/lib/dash-auth';
import { getDb, listDrafts, createDraft, updateDraft, getThread } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  getDb();
  return Response.json({ drafts: listDrafts('local-dev') });
}

// POST { conversationId } → draft from last assistant answer · { title } → blank draft
export async function POST(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  getDb();
  if (body.conversationId) {
    const thread = getThread(body.conversationId);
    if (!thread) return Response.json({ error: 'no such conversation' }, { status: 404 });
    const last = [...thread.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return Response.json({ error: 'nothing to save yet' }, { status: 400 });
    const draft = createDraft({
      spaceId: 'local-dev',
      projectId: thread.project_id || null,
      conversationId: thread.id,
      title: thread.title || 'Untitled draft',
      body: last.content,
      linkedSaveIds: last.cited_save_ids || [],
    });
    return Response.json({ draft });
  }
  if (!body.title) return Response.json({ error: 'title or conversationId required' }, { status: 400 });
  const draft = createDraft({ spaceId: 'local-dev', title: String(body.title).slice(0, 200) });
  return Response.json({ draft });
}

// PUT { id, title, body }
export async function PUT(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 });
  getDb();
  const draft = updateDraft(body.id, { title: body.title || 'Untitled draft', body: body.body || '' });
  return Response.json({ draft });
}
