import Link from 'next/link';
import { counts, draftCount, listProjects } from '@/lib/db';
import { getMemoryRows } from '@/lib/db';
import CommandK from './commandk';

const NAV = [
  ['think', 'Think space', '/think'],
  ['recents', 'Recents', '/recents'],
  ['folders', 'Folders', '/folders'],
  ['projects', 'My Projects', '/projects'],
  ['drafts', 'Drafts', '/drafts'],
  ['resources', 'Resources', '/resources'],
  ['trash', 'Trash', '/trash'],
  ['admin', 'Admin', '/admin'],
];

export default async function Shell({ active, breadcrumb, breadcrumbRoot, children }) {
  let c = { saves: 0, filed: 0 };
  let drafts = 0;
  let projects = [];
  let name = '';
  try {
    c = counts();
    drafts = draftCount();
    projects = listProjects('active').slice(0, 5);
    const rows = getMemoryRows('local-dev');
    name = rows.find((r) => r.layer === 'permanent' && r.key === 'name')?.value || '';
  } catch {
    /* first boot before db init */
  }
  const badge = { recents: c.saves || '', drafts: drafts || '' };
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="mark">✳</span> tweaks
        </div>
        <div className="space">
          <b>{name ? `${name}'s space` : "Alex's space"}</b>
          <span>Personal workspace</span>
        </div>
        {NAV.map(([key, label, href]) => (
          <Link key={key} href={href} className={`navlink${active === key ? ' active' : ''}`}>
            {label}
            {badge[key] !== '' && badge[key] !== undefined && <span className="n">{badge[key]}</span>}
          </Link>
        ))}
        <h4>PINNED PROJECTS</h4>
        {projects.length === 0 && <div className="pin" style={{ color: 'var(--muted)' }}>No projects yet</div>}
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.slug}`} className="pin">
            <i /> {p.name}
          </Link>
        ))}
        <div className="extcard">
          <b>
            <span className="dot" />
            Chrome extension connected
          </b>
          <span>A little inspiration, wherever you are.</span>
        </div>
        <Link href="/settings" className={`navlink${active === 'settings' ? ' active' : ''}`}>
          Settings
        </Link>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="crumb">
            {breadcrumbRoot && breadcrumb && breadcrumb.startsWith(breadcrumbRoot.label) ? (
              <>
                <Link href={breadcrumbRoot.href} style={{ color: 'var(--rust)' }}>
                  {breadcrumbRoot.label}
                </Link>
                {breadcrumb.slice(breadcrumbRoot.label.length)}
              </>
            ) : (
              breadcrumb || ''
            )}
          </span>
          <span className="sp" />
          <CommandK />
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
