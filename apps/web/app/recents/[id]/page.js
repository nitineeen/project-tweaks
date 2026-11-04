import Link from 'next/link';
import Shell from '../../components/shell';
import SaveActions from '../../components/save-actions';
import { getSaveFull, listProjects } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function SaveDetail({ params }) {
  const { id } = await params;
  let save = null;
  let projects = [];
  try {
    save = getSaveFull(id);
    projects = listProjects('active');
  } catch {
    save = null;
  }
  if (!save) {
    return (
      <Shell active="recents" breadcrumb="Recents">
        <div className="empty">
          Save not found. <Link href="/recents">Back to Recents</Link>
        </div>
      </Shell>
    );
  }
  const vm = save.visual_metadata || {};
  const winners = save.winners || {};
  return (
    <Shell active="recents" breadcrumb={`Recents / ${save.page_title || 'Save'}`}>
      <div className="two-col">
        <div>
          <div className="kicker">{hostOf(save.original_url)}</div>
          <h1 className="h-display" style={{ fontSize: 36, margin: '6px 0' }}>
            {save.page_title || '(untitled)'}
          </h1>
          <p>
            <a href={save.original_url} target="_blank" rel="noreferrer" style={{ color: 'var(--rust)' }}>
              Open original ↗
            </a>
          </p>
          {save.has_shot && (
            <img
              src={`/api/dash/shot/${save.id}`}
              alt=""
              style={{ width: '100%', borderRadius: 14, margin: '8px 0' }}
            />
          )}
          {save.user_reason && (
            <div className="you">
              <small>YOUR INTENTION</small>
              {save.user_reason}
            </div>
          )}
          {save.ai_explanation && <p style={{ color: 'var(--muted)' }}>{save.ai_explanation}</p>}
          {save.selection && (
            <>
              <div className="sec-title">Saved selection</div>
              <div className="hunch">{save.selection}</div>
            </>
          )}
          {(save.top_signals || []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              {(save.top_signals || []).map((t) => (
                <span key={t} className="chip">
                  {pretty(t)}
                </span>
              ))}
            </div>
          )}
          <SaveActions
            id={save.id}
            projects={projects}
            projectSlug={save.project_slug}
            isResource={Boolean(save.is_resource)}
            deleted={Boolean(save.deleted_at)}
          />
        </div>
        <div className="rail">
          <div className="card" style={{ padding: 14 }}>
            <div className="sec-title" style={{ marginTop: 0 }}>Filing</div>
            <div style={{ fontSize: 13 }}>
              <div>
                Status: <b>{save.status}</b>
              </div>
              <div>
                Folder: <b>{save.folder_slug || '—'}</b>
              </div>
              <div>
                Meta: <code style={{ fontSize: 12 }}>{save.meta_l1 || '—'}</code>
              </div>
              <div>
                Confidence: <b>{save.meta_confidence ?? '—'}</b>
              </div>
            </div>
            {Object.keys(winners).length > 0 && (
              <>
                <div className="sec-title">Winners</div>
                {Object.entries(winners).map(([set, w]) => (
                  <div key={set} style={{ fontSize: 12 }}>
                    {pretty(set)}: <b>{pretty(w.label)}</b> ({w.score})
                  </div>
                ))}
              </>
            )}
          </div>
          {vm && vm.status === 'ok' && (vm.regions || []).length > 0 && (
            <div className="card" style={{ padding: 14 }}>
              <div className="sec-title" style={{ marginTop: 0 }}>Visual</div>
              <div style={{ fontSize: 12 }}>Images: {vm.image_count}</div>
              <div style={{ fontSize: 12 }}>Aesthetics: {(vm.aesthetics || []).join(', ')}</div>
              {(vm.regions || []).slice(0, 6).map((r) => (
                <div key={r.id} style={{ fontSize: 12, marginTop: 6 }}>
                  <b>{r.label}</b> — {r.description}
                  <div style={{ color: 'var(--muted)' }}>{(r.labels || []).join(' · ')}</div>
                </div>
              ))}
              {vm.overall_design_idea && <p style={{ fontSize: 12 }}>{vm.overall_design_idea}</p>}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
