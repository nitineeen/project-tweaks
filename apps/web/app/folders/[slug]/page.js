import Link from 'next/link';
import Shell from '../../components/shell';
import { listSaves } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pretty(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function FolderDetail({ params }) {
  const { slug } = await params;
  const folder = decodeURIComponent(slug);
  let saves = [];
  try {
    saves = listSaves({ limit: 100, folder });
  } catch {
    saves = [];
  }
  return (
    <Shell active="folders" breadcrumb={`Folders / ${pretty(folder)}`}>
      <h1 className="h-display" style={{ fontSize: 36, margin: '0 0 4px' }}>
        {pretty(folder)}
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>{saves.length} saves</p>
      {saves.length === 0 ? (
        <div className="empty">
          Nothing filed here yet. <Link href="/recents">Browse Recents</Link>
        </div>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>NAME</th>
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
                </td>
                <td>{pretty(s.save_type)}</td>
                <td>{(s.created_at || '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
