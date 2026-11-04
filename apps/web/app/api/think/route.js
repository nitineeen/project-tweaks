import { spaceFromRequest } from '@/lib/auth';
import { getDb, checkBudget } from '@/lib/db';
import { runThink, streamThink } from '@/lib/think';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/think  { query, conversationId?, project? }  ?stream=1 → SSE
export async function POST(req) {
  const auth = spaceFromRequest(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.query) return Response.json({ error: 'query required' }, { status: 400 });
  getDb();
  const budget = checkBudget(auth.userId);
  if (!budget.ok) {
    return Response.json({ error: budget.reason === 'banned' ? 'Account blocked.' : 'Usage limit reached — upgrade to keep thinking.', upgrade: budget.reason === 'limit' }, { status: 402 });
  }
  const args = {
    spaceId: auth.spaceId,
    userId: auth.userId,
    query: String(body.query).slice(0, 2000),
    conversationId: body.conversationId || null,
    projectSlug: body.project || '',
    pinIds: Array.isArray(body.pinIds) ? body.pinIds.filter((x) => typeof x === 'string').slice(0, 6) : [],
    mode: body.mode === 'deep' ? 'deep' : 'quick',
  };
  if (new URL(req.url).searchParams.get('stream') === '1') {
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
  const result = await runThink(args);
  return Response.json(result);
}
