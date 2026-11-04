import Link from 'next/link';
import { getThreadByShareToken } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Cite({ n, refs }) {
  const ref = refs[n - 1];
  if (!ref) return <span className="cite cite-dead">[{n}]</span>;
  return (
    <Link href={`/recents/${ref.id}`} className="cite" title={ref.title}>
      [{n}]
    </Link>
  );
}

function Rich({ text, refs }) {
  const parts = String(text || '').split(/(\*\*.+?\*\*|\[\d+\])/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*.+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>;
        const m = p.match(/^\[(\d+)\]$/);
        if (m) return <Cite key={i} n={Number(m[1])} refs={refs} />;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export default async function SharePage({ params }) {
  const { token } = await params;
  let thread = null;
  try {
    thread = getThreadByShareToken(token);
  } catch {
    thread = null;
  }
  if (!thread) {
    return (
      <main style={{ maxWidth: 680, margin: '60px auto', padding: '0 20px' }}>
        <h1 className="h-display">This shared chat isn’t available</h1>
        <p style={{ color: 'var(--muted)' }}>The link may be wrong, or the conversation was wiped.</p>
        <Link href="/think" style={{ color: 'var(--rust)' }}>
          Open your think space ↗
        </Link>
      </main>
    );
  }
  const allRefs = new Map();
  for (const m of thread.messages) {
    for (const r of m.refs || []) {
      if (!allRefs.has(r.id)) allRefs.set(r.id, r);
    }
  }
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>tweaks</span>
        <span className="pill">Shared conversation · read-only</span>
      </div>
      <h1 className="h-display" style={{ fontSize: 30, margin: '6px 0 4px' }}>
        {thread.title || 'A thought, taking shape'}
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Shared from a Tweaks think space. Citations open the saver’s references on their machine.
      </p>
      <div className="thread" style={{ maxWidth: 'none' }}>
        {thread.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="you">
              <small>YOU</small>
              {m.content}
            </div>
          ) : (
            <div key={i} className="ai">
              <div className="who">
                <span className="mark">✳</span> <b>Tweaks</b>
              </div>
              {String(m.content)
                .split('\n')
                .map((line, j) => (
                  <p key={j}>
                    {line ? <Rich text={line} refs={m.refs || []} /> : <br />}
                  </p>
                ))}
            </div>
          )
        )}
      </div>
      {allRefs.size > 0 && (
        <>
          <div className="sec-title">References in this chat</div>
          <div className="rail" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {[...allRefs.values()].map((r) => (
              <Link key={r.id} href={`/recents/${r.id}`} className="refcard">
                {r.has_shot && <img src={`/api/dash/shot/${r.id}`} alt="" loading="lazy" />}
                <div className="b">
                  {r.title}
                  <small>
                    <br />
                    {r.reason || r.excerpt.slice(0, 90)}
                  </small>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
