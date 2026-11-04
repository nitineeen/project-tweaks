import Link from 'next/link';
import Shell from '../components/shell';
import ProjectsClient from '../components/projects-client';
import { listProjects } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Projects() {
  let projects = [];
  try {
    projects = listProjects();
  } catch {
    projects = [];
  }
  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status !== 'active');
  return (
    <Shell active="projects" breadcrumb="My Projects">
      <div className="kicker">FROM COLLECTING TO CREATING</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        Ideas with somewhere to go.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Bring references, conversations, and first drafts around something you want to make.
      </p>
      {active.length === 0 ? (
        <div className="empty">No projects yet — create one below, then assign saves from any save page.</div>
      ) : (
        <div className="grid-cards" style={{ marginTop: 18 }}>
          {active.map((p) => (
            <Link key={p.id} href={`/projects/${p.slug}`} className="card" style={{ padding: '14px 16px' }}>
              <b>{p.name}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {p.saves} saves · {p.conversations} conversations · {p.drafts} drafts
              </div>
            </Link>
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <>
          <div className="sec-title">Archived</div>
          {archived.map((p) => (
            <div key={p.id}>
              <Link href={`/projects/${p.slug}`}>{p.name}</Link>
            </div>
          ))}
        </>
      )}
      <ProjectsClient />
    </Shell>
  );
}
