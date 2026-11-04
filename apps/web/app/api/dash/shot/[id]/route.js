import fs from 'node:fs';
import { localOnly } from '@/lib/dash-auth';
import { getDb, getSave } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const denied = localOnly(req);
  if (denied) return denied;
  const { id } = await params;
  getDb();
  const save = getSave(id);
  if (!save || !save.screenshot_path || !fs.existsSync(save.screenshot_path)) {
    return new Response('not found', { status: 404 });
  }
  const buf = fs.readFileSync(save.screenshot_path);
  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
