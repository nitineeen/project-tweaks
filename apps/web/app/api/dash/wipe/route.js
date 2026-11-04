import fs from 'node:fs';
import { localOnly } from '@/lib/dash-auth';
import { getDb, wipeSpace } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE { confirm: "DELETE" } — permanent wipe of the user-data plane.
// Never goes to Trash. Admin plane (users, rates, usage) is kept.
export async function DELETE(req) {
  const denied = localOnly(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (body.confirm !== 'DELETE') {
    return Response.json({ error: 'type DELETE to confirm' }, { status: 400 });
  }
  getDb();
  const { counts, shots } = wipeSpace('local-dev');
  let files = 0;
  for (const p of shots) {
    try {
      if (p && fs.existsSync(p)) {
        fs.unlinkSync(p);
        files += 1;
      }
    } catch {
      /* best effort */
    }
  }
  return Response.json({ ok: true, counts: { ...counts, shot_files: files } });
}
