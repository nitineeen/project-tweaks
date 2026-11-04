import { localOnly } from '@/lib/dash-auth';
import { getDb, trashSave, restoreSave, setResource, setSaveProject } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT /api/dash/saves/:id  { op: trash|restore|resource|unresource|project, value? }
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
  switch (body.op) {
    case 'trash':
      trashSave(id);
      break;
    case 'restore':
      restoreSave(id);
      break;
    case 'resource':
      setResource(id, true, body.value || 'reading');
      break;
    case 'unresource':
      setResource(id, false);
      break;
    case 'project':
      setSaveProject(id, body.value || null);
      break;
    default:
      return Response.json({ error: 'unknown op' }, { status: 400 });
  }
  return Response.json({ ok: true });
}
