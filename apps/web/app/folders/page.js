import Link from 'next/link';
import Shell from '../components/shell';
import { savesByFolder, folderActivity, topStats } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pretty(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function Folders() {
  let folders = [];
  let activity = [];
  let themes = [];
  try {
    folders = savesByFolder('local-dev');
    activity = folderActivity('local-dev', 8);
    themes = [
      ...topStats('local-dev', 'aesthetic', 6),
      ...topStats('local-dev', 'intent', 6),
    ]
      .sort((a, b) => b.saves_count - a.saves_count)
      .slice(0, 8);
  } catch {
    /* db boots on first api call */
  }
  return (
    <Shell active="folders" breadcrumb="Folders">
      <div className="kicker">A HOME FOR EVERY CURIOSITY</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        Your shelves of inspiration.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Browse by a familiar thread. Tweaks sorts quietly; you can always rearrange.
      </p>
      {folders.length === 0 ? (
        <div className="empty">No folders yet — they appear as saves get filed.</div>
      ) : (
        <div className="grid-cards" style={{ marginTop: 18 }}>
          {folders.map((f) => (
            <Link key={f.folder} href={`/folders/${encodeURIComponent(f.folder)}`} className="card" style={{ padding: '14px 16px' }}>
              <b>{pretty(f.folder)}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {f.n} saves · updated {(f.latest || '').slice(0, 10)}
              </div>
            </Link>
          ))}
        </div>
      )}
      {themes.length > 0 && (
        <>
          <div className="sec-title">Emerging themes</div>
          <div>
            {themes.map((t, i) => (
              <Link
                key={`${i}:${t.label}`}
                href={`/recents?label=${encodeURIComponent(t.label)}`}
                className="chip"
                title={`Show saves filed as ${pretty(t.label)}`}
              >
                {pretty(t.label)} · {t.saves_count}
              </Link>
            ))}
          </div>
        </>
      )}
      {activity.length > 0 && (
        <>
          <div className="sec-title">Recent activity</div>
          <div className="card" style={{ padding: '6px 16px' }}>
            {activity.map((a) => (
              <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                <Link href={`/recents/${a.id}`} style={{ fontWeight: 600 }}>
                  {a.page_title || '(untitled)'}
                </Link>{' '}
                <span style={{ color: 'var(--muted)' }}>
                  found a home in{' '}
                  <Link href={`/folders/${encodeURIComponent(a.folder_slug || 'loose-threads')}`}>
                    {pretty(a.folder_slug)}
                  </Link>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
