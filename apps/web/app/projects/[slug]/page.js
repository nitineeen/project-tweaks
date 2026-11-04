import Link from 'next/link';
import Shell from '../../components/shell';
import { getProjectBySlug, listSaves, listConversations, listDrafts } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ProjectDetail({ params }) {
  const { slug } = await params;
  let project = null;
  let saves = [];
  let convos = [];
  let drafts = [];
  try {
    project = getProjectBySlug('local-dev', slug);
    if (project) {
      saves = listSaves({ limit: 100, project: slug });
      convos = listConversations('local-dev', 50).filter((c) => c.project_id === project.id);
      drafts = listDrafts('local-dev').filter((d) => d.project_id === project.id);
    }
  } catch {
    project = null;
  }
  if (!project) {
    return (
      <Shell active="projects" breadcrumb="My Projects">
        <div className="empty">
          Project not found. <Link href="/projects">Back to Projects</Link>
        </div>
      </Shell>
    );
  }
  return (
    <Shell active="projects" breadcrumb={`My Projects / ${project.name}`}>
      <div className="kicker">PERSONAL PROJECT · {project.status.toUpperCase()}</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        {project.name}
      </h1>
      {project.intention && <p style={{ color: 'var(--muted)', marginTop: 0 }}>{project.intention}</p>}
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        {saves.length} saves · {convos.length} conversations · {drafts.length} drafts
      </p>
      <div className="sec-title">The references shaping this ({saves.length})</div>
      {saves.length === 0 ? (
        <div className="empty">
          No saves assigned — open any save and pick this project. <Link href="/recents">Browse Recents</Link>
        </div>
      ) : (
        <div className="grid-cards">
          {saves.slice(0, 12).map((s) => (
            <Link key={s.id} href={`/recents/${s.id}`} className="card savecard">
              {s.has_shot ? (
                <img className="shot" src={`/api/dash/shot/${s.id}`} alt="" loading="lazy" />
              ) : (
                <div className="no-shot">{(s.page_title || '·').slice(0, 24)}</div>
              )}
              <div className="body">
                <div className="t">{s.page_title || '(untitled)'}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {convos.length > 0 && (
        <>
          <div className="sec-title">Conversations</div>
          {convos.map((c) => (
            <div key={c.id}>
              <Link href={`/think?c=${c.id}`}>{c.title || 'Untitled thread'}</Link>
            </div>
          ))}
        </>
      )}
      {drafts.length > 0 && (
        <>
          <div className="sec-title">Drafts</div>
          {drafts.map((d) => (
            <div key={d.id}>
              <Link href={`/drafts/${d.id}`}>{d.title}</Link>{' '}
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.word_count} words</span>
            </div>
          ))}
        </>
      )}
    </Shell>
  );
}
