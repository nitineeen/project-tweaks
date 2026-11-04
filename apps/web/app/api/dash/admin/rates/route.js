import { localOnly } from '@/lib/dash-auth';
import { getDb, getRates, setRate } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  getDb();
  return Response.json({ rates: getRates() });
}

// PUT { model, per_1m_in?, per_1m_out?, per_unit?, unit? } (null clears)
export async function PUT(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!body.model) return Response.json({ error: 'model required' }, { status: 400 });
  const num = (v) => (v === null || v === '' || v === undefined ? null : Number(v));
  getDb();
  setRate(String(body.model), {
    per_1m_in: num(body.per_1m_in),
    per_1m_out: num(body.per_1m_out),
    per_unit: num(body.per_unit),
    unit: body.unit || null,
  });
  return Response.json({ ok: true });
}
