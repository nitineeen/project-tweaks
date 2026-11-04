import Link from 'next/link';
import Shell from '../components/shell';
import DraftsClient from '../components/drafts-client';
import { listDrafts } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Drafts() {
  let drafts = [];
  try {
    drafts = listDrafts('local-dev');
  } catch {
    drafts = [];
  }
  return (
    <Shell active="drafts" breadcrumb="Drafts">
      <div className="kicker">ROOM FOR UNFINISHED THOUGHTS</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        A thought, taking shape.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Not polished. Not published. Just yours to keep working on.
      </p>
      <DraftsClient />
      {drafts.length === 0 ? (
        <div className="empty" style={{ marginTop: 18 }}>
          No drafts yet — think something through, then Save as draft.
        </div>
      ) : (
        <div className="grid-cards" style={{ marginTop: 18 }}>
          {drafts.map((d) => (
            <Link key={d.id} href={`/drafts/${d.id}`} className="card" style={{ padding: '14px 16px' }}>
              <b>{d.title}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {d.word_count} words · {d.linked_save_ids.length} linked references
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
