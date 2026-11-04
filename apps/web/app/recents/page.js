import Link from 'next/link';
import Shell from '../components/shell';
import { counts, listProjects, listSaves } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TABS = [
  ['', 'All saves'],
  ['image', 'Images'],
  ['article', 'Articles'],
  ['effect', 'Effects'],
  ['page', 'Pages'],
  ['video', 'Videos'],
];

const TYPE_LABEL = { page: 'Page', article: 'Article', image: 'Image', region: 'Design reference', effect: 'Effect', design_reference: 'Design reference', video: 'Video', link: 'Link', chat: 'AI chat' };

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pretty(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function Recents({ searchParams }) {
  const sp = await searchParams;
  const type = sp?.type || '';
  const label = sp?.label || '';
  let saves = [];
  let c = { saves: 0, filed: 0 };
  let projects = [];
  try {
    saves = listSaves({ limit: 60, type, label });
    c = counts();
    projects = listProjects('active').slice(0, 3);
  } catch {
    /* db boots on first api call; page shows empty state */
  }
  const pname = Object.fromEntries(projects.map((p) => [p.slug, p.name]));
  const cards = saves.filter((s) => s.has_shot).slice(0, 8);
  return (
    <Shell active="recents" breadcrumb="Recents">
      <div className="kicker">YOUR EVER-GROWING COLLECTION</div>
      <h1 className="h-display" style={{ fontSize: 44, margin: '6px 0' }}>
        Good things, kept close.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Every spark you&apos;ve saved. A little less scattered, a little more connected.
      </p>
      {label && (
        <div style={{ marginTop: 10 }}>
          <span className="chip" style={{ fontSize: 12 }}>
            Theme: {pretty(label)}{' '}
            <Link href="/recents" title="Clear filter" style={{ color: 'var(--rust)' }}>
              ✕
            </Link>
          </span>
        </div>
      )}
      <div className="grid-cards" style={{ marginTop: 18 }}>
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.slug}`} className="card" style={{ padding: '14px 16px' }}>
            <b>{p.name}</b>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.saves} saves</div>
          </Link>
        ))}
      </div>
      <div className="tabs">
        {TABS.map(([v, label]) => (
          <Link key={label} href={v ? `/recents?type=${v}` : '/recents'} className={`tab${type === v ? ' active' : ''}`}>
            {label}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c.saves} saves · Date added ↓</span>
      </div>
      {saves.length === 0 ? (
        <div className="empty">Nothing here yet — save from the extension and it lands here, filed.</div>
      ) : (
        <>
          {cards.length > 0 && (
            <>
              <div className="sec-title">Latest</div>
              <div className="grid-cards">
                {cards.map((s) => (
                  <Link key={s.id} href={`/recents/${s.id}`} className="card savecard">
                    <img className="shot" src={`/api/dash/shot/${s.id}`} alt="" loading="lazy" />
                    <div className="body">
                      <div className="host">{hostOf(s.original_url)}</div>
                      <div className="t">{s.page_title || '(untitled)'}</div>
                      <div className="meta">
                        <b>{TYPE_LABEL[s.save_type] || s.save_type}</b>
                        {s.project_slug ? ` · ${pname[s.project_slug] || s.project_slug}` : ''}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className="sec-title">All saves</div>
          <table className="list">
            <thead>
              <tr>
                <th>NAME</th>
                <th>PROJECT</th>
                <th>TYPE</th>
                <th>ADDED</th>
              </tr>
            </thead>
            <tbody>
              {saves.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/recents/${s.id}`} style={{ fontWeight: 600 }}>
                      {s.page_title || '(untitled)'}
                    </Link>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{hostOf(s.original_url)}</div>
                  </td>
                  <td>{(s.project_slug && (pname[s.project_slug] || s.project_slug)) || '—'}</td>
                  <td>{TYPE_LABEL[s.save_type] || s.save_type}</td>
                  <td>{(s.created_at || '').slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Shell>
  );
}
