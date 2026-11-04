import Shell from '../components/shell';
import TrashClient from '../components/trash-client';
import { listTrash } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Trash() {
  let items = [];
  try {
    items = listTrash('local-dev');
  } catch {
    items = [];
  }
  return (
    <Shell active="trash" breadcrumb="Trash">
      <div className="kicker">A LITTLE SPACE TO RECONSIDER</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        Letting a few things go.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Deleted saves stay here for 30 days. Items in Trash aren&apos;t used as thinking context.
      </p>
      <TrashClient items={items} />
    </Shell>
  );
}
