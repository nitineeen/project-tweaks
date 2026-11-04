import Link from 'next/link';
import Shell from '../../components/shell';
import DraftEditor from '../../components/draft-editor';
import { getDraft, getSaveFull } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DraftDetail({ params }) {
  const { id } = await params;
  let draft = null;
  let linked = [];
  try {
    draft = getDraft(id);
    if (draft) linked = draft.linked_save_ids.map((sid) => getSaveFull(sid)).filter(Boolean);
  } catch {
    draft = null;
  }
  if (!draft) {
    return (
      <Shell active="drafts" breadcrumb="Drafts">
        <div className="empty">
          Draft not found. <Link href="/drafts">Back to Drafts</Link>
        </div>
      </Shell>
    );
  }
  return (
    <Shell active="drafts" breadcrumb={`Drafts / ${draft.title}`}>
      <div className="two-col">
        <DraftEditor draft={draft} />
        <div className="rail">
          <b>Linked references ({linked.length})</b>
          {linked.length === 0 && (
            <small style={{ color: 'var(--muted)' }}>Drafts saved from Think space link their citations here.</small>
          )}
          {linked.map((s) => (
            <Link key={s.id} href={`/recents/${s.id}`} className="refcard">
              <div className="b">
                {s.page_title || '(untitled)'}
                <small>
                  <br />
                  {s.user_reason || ''}
                </small>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
