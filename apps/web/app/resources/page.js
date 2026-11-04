import Link from 'next/link';
import Shell from '../components/shell';
import { listResources } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Resources() {
  let resources = [];
  try {
    resources = listResources('local-dev');
  } catch {
    resources = [];
  }
  const groups = {};
  for (const r of resources) (groups[r.resource_kind || 'reading'] = groups[r.resource_kind || 'reading'] || []).push(r);
  return (
    <Shell active="resources" breadcrumb="Resources">
      <div className="kicker">THE THINGS YOU COME BACK TO</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        A well-worn reference shelf.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        The useful reads, tools, and ideas you&apos;ve marked to keep within reach.
      </p>
      {resources.length === 0 ? (
        <div className="empty">
          Nothing shelved yet — open any save and Mark as resource. <Link href="/recents">Browse Recents</Link>
        </div>
      ) : (
        Object.entries(groups).map(([kind, items]) => (
          <div key={kind}>
            <div className="sec-title" style={{ textTransform: 'capitalize' }}>{kind}</div>
            <div className="grid-cards">
              {items.map((s) => (
                <Link key={s.id} href={`/recents/${s.id}`} className="card" style={{ padding: '14px 16px' }}>
                  <b>{s.page_title || '(untitled)'}</b>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.original_url}</div>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </Shell>
  );
}
