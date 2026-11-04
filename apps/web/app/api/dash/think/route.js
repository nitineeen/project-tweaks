import { localOnly } from '@/lib/dash-auth';
import { getDb, checkBudget } from '@/lib/db';
import { streamThink } from '@/lib/think';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/dash/think  { query, conversationId? } → SSE (localhost dashboard only)
export async function POST(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.query) return Response.json({ error: 'query required' }, { status: 400 });
  getDb();
  const budget = checkBudget('local-user');
  if (!budget.ok) {
    return Response.json({ error: budget.reason === 'banned' ? 'Account blocked.' : 'Usage limit reached — upgrade to keep thinking.', upgrade: budget.reason === 'limit' }, { status: 402 });
  }
  const args = {
    spaceId: 'local-dev',
    userId: 'local-user',
    query: String(body.query).slice(0, 2000),
    conversationId: body.conversationId || null,
    projectSlug: '',
    pinIds: Array.isArray(body.pinIds) ? body.pinIds.filter((x) => typeof x === 'string').slice(0, 6) : [],
    mode: body.mode === 'deep' ? 'deep' : 'quick',
  };
  return new Response(
    new ReadableStream({
      async start(c) {
        try {
          await streamThink(c, args);
        } catch {
          try {
            c.close();
          } catch {
            /* already closed */
          }
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }
  );
}
