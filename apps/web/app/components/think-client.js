'use client';

import Link from 'next/link';
import { useState } from 'react';

const STARTERS = ['Brainstorm from my saves', 'Find unexpected connections', 'Turn a collection into a draft'];

function inlineRich(line, key, refs = []) {
  const parts = String(line).split(/(\*\*.+?\*\*|\[\d+\])/g).filter(Boolean);
  return parts.map((p, i) => {
    if (/^\*\*.+\*\*$/.test(p)) return <b key={`${key}-${i}`}>{p.slice(2, -2)}</b>;
    const cm = p.match(/^\[(\d+)\]$/);
    if (cm) {
      const ref = refs[Number(cm[1]) - 1];
      if (ref) {
        return (
          <Link key={`${key}-${i}`} href={`/recents/${ref.id}`} className="cite" title={ref.title}>
            {p}
          </Link>
        );
      }
      return (
        <span key={`${key}-${i}`} className="cite cite-dead" title="No matching reference for this number">
          {p}
        </span>
      );
    }
    return <span key={`${key}-${i}`}>{p}</span>;
  });
}

function renderAnswer(text, refs = []) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ol key={`l${blocks.length}`}>
          {list.map((t, i) => (
            <li key={i}>{inlineRich(t, `li${i}`, refs)}</li>
          ))}
        </ol>
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*\d+\.\s+(.*)/);
    if (m) list.push(m[1]);
    else {
      flush();
      blocks.push(<p key={`p${i}`}>{line ? inlineRich(line, `p${i}`, refs) : <br />}</p>);
    }
  });
  flush();
  return blocks;
}

function lastRefs(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant' && messages[i].refs && messages[i].refs.length) {
      return messages[i].refs;
    }
  }
  return [];
}

export default function ThinkClient({ initial, convos }) {
  const [convId, setConvId] = useState(initial?.id || null);
  const [messages, setMessages] = useState(initial?.messages || []);
  const [refs, setRefs] = useState(() => lastRefs(initial?.messages || []));
  const [liveRefs, setLiveRefs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [draftLink, setDraftLink] = useState('');
  const [mode, setMode] = useState('quick');
  const [pins, setPins] = useState([]);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxQ, setCtxQ] = useState('');
  const [ctxHits, setCtxHits] = useState([]);
  const [threads, setThreads] = useState(convos || []);
  const [timing, setTiming] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [memNote, setMemNote] = useState([]);
  const [toolNote, setToolNote] = useState('');

const TOOL_LABELS = {
  search_saves: 'Searching your saves…',
  read_save: 'Reading a save…',
  fetch_page: 'Fetching a live page…',
  remember: 'Remembering…',
  web_search: 'Searching the web…',
};

  async function send(q) {
    const query = (q ?? input).trim();
    if (!query || busy) return;
    setInput('');
    setBusy(true);
    setStreamed('');
    setLiveRefs([]);
    setDraftLink('');
    setShareUrl('');
    setMemNote([]);
    setToolNote('');
    setMessages((m) => [...m, { role: 'user', content: query }]);
    try {
      const res = await fetch('/api/dash/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, conversationId: convId, pinIds: pins.map((p) => p.id), mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages((m) => [...m, { role: 'assistant', content: err.error || 'Thinking failed — is the backend running?', refs: [] }]);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';
      let done = null;
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const p of parts) {
          const line = p.trim();
          if (!line.startsWith('data:')) continue;
          const o = JSON.parse(line.slice(5));
          if (o.t === 'tok') {
            full += o.s;
            setStreamed(full);
          } else if (o.t === 'refs' && o.refs) {
            setLiveRefs(o.refs);
            if (o.refs.length) setRefs(o.refs);
          } else if (o.t === 'mem' && o.mem) {
            setMemNote(o.mem);
          } else if (o.t === 'tool' && o.name) {
            setToolNote(TOOL_LABELS[o.name] || 'Thinking…');
          } else if (o.t === 'done') {
            done = o;
          }
        }
      }
      if (done) {
        if (done.mem && done.mem.length) setMemNote(done.mem);
        const answerRefs = done.refs || liveRefs;
        setConvId(done.conversationId);
        setRefs(answerRefs);
        setMessages((m) => [...m, { role: 'assistant', content: full, refs: answerRefs, cited_save_ids: done.cited || [] }]);
        if (done.timings) {
          const total = ((done.timings.retrieveMs + done.timings.aiMs) / 1000).toFixed(1);
          setTiming(`⚡${total}s (find ${(done.timings.retrieveMs / 1000).toFixed(1)}s · think ${(done.timings.aiMs / 1000).toFixed(1)}s)`);
        }
        setThreads((t) =>
          t.some((x) => x.id === done.conversationId)
            ? t
            : [{ id: done.conversationId, title: query.slice(0, 60) }, ...t].slice(0, 8)
        );
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Thinking failed — is the backend running?', refs: [] }]);
    } finally {
      setBusy(false);
      setStreamed('');
      setLiveRefs([]);
    }
  }

  async function delThread(id) {
    try {
      const res = await fetch('/api/dash/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) return;
    } catch {
      return;
    }
    if (id === convId) {
      window.location.href = '/think';
      return;
    }
    setThreads((t) => t.filter((x) => x.id !== id));
  }

  async function clearThreads() {
    if (!window.confirm('Delete all recent threads? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/dash/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) return;
    } catch {
      return;
    }
    window.location.href = '/think';
  }

  async function saveDraft() {
    if (!convId) return;
    const res = await fetch('/api/dash/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId }),
    });
    if (res.ok) {
      const { draft } = await res.json();
      setDraftLink(draft.id);
    }
  }

  async function shareChat() {
    if (!convId || shareBusy) return;
    setShareBusy(true);
    try {
      const res = await fetch('/api/dash/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId }),
      });
      if (res.ok) {
        const { url } = await res.json();
        const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        setShareUrl(absolute);
        try {
          await navigator.clipboard.writeText(absolute);
        } catch {
          /* clipboard is best-effort */
        }
      }
    } finally {
      setShareBusy(false);
    }
  }

  async function ctxSearch(q) {
    setCtxQ(q);
    if (q.trim().length < 2) {
      setCtxHits([]);
      return;
    }
    try {
      const res = await fetch(`/api/dash/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const { hits } = await res.json();
        setCtxHits((hits || []).filter((h) => h.kind === 'save' && !pins.some((p) => p.id === h.id)).slice(0, 5));
      }
    } catch {
      /* ignore */
    }
  }

  function pin(h) {
    if (pins.length >= 6 || pins.some((p) => p.id === h.id)) return;
    setPins([...pins, { id: h.id, title: h.title }]);
    setCtxQ('');
    setCtxHits([]);
  }

  return (
    <div className="two-col">
      <div className="thread">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <h1 className="h-display" style={{ fontSize: 34, margin: '0 0 4px', flex: 1 }}>
            {initial?.title || 'What\u2019s on your mind?'}
          </h1>
          {convId && !busy && messages.some((m) => m.role === 'assistant') && (
            <button
              className="btn-light"
              onClick={shareChat}
              disabled={shareBusy}
              title="Share this chat (copies a read-only link)"
              aria-label="Share this chat"
              style={{ marginTop: 6, padding: '7px 10px', lineHeight: 1 }}
            >
              {shareBusy ? (
                '…'
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                  <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
              )}
            </button>
          )}
        </div>
        {shareUrl && (
          <small style={{ color: 'var(--muted)' }}>
            Link copied: <Link href={shareUrl} style={{ color: 'var(--rust)' }}>{shareUrl}</Link>
          </small>
        )}
        {memNote.length > 0 && (
          <div style={{ display: 'flex', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
            {memNote.map((m) => (
              <span key={m.key} className="chip" title="Saved to your memory">
                Remembered: {m.label} = {m.value} ✓
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <small style={{ color: 'var(--muted)' }}>Think mode:</small>
          {['quick', 'deep'].map((m) => (
            <button
              key={m}
              className={mode === m ? 'btn-rust' : 'btn-light'}
              style={{ padding: '5px 14px', fontSize: 12 }}
              onClick={() => setMode(m)}
              title={m === 'deep' ? 'More references, longer comparison' : 'Fast answer from top references'}
            >
              {m === 'deep' ? 'Deep' : 'Quick'}
            </button>
          ))}
          {mode === 'deep' && <small style={{ color: 'var(--muted)' }}>uses tools: search, read, fetch · up to 10 references</small>}
        </div>
        {messages.length === 0 && !busy && (
          <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
            {STARTERS.map((s) => (
              <button key={s} className="btn-light" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="you msg-in">
              <small>YOU</small>
              {m.content}
            </div>
          ) : (
            <div key={i} className="ai msg-in">
              <div className="who">
                <span className="mark">✳</span> <b>Tweaks</b> <span className="pill">Grounded in your saves</span>
              </div>
              {renderAnswer(m.content, m.refs || [])}
              {Array.isArray(m.cited_save_ids) && m.cited_save_ids.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {(m.refs || [])
                    .filter((r) => m.cited_save_ids.includes(r.id))
                    .map((r) => (
                      <Link key={r.id} href={`/recents/${r.id}`} className="chip" title={r.title}>
                        [{r.n}] {r.title.slice(0, 34)}
                      </Link>
                    ))}
                </div>
              )}
            </div>
          )
        )}
        {busy && (
          <div className="ai">
            <div className="who">
              <span className="mark thinking">✳</span> <b>Tweaks</b>
            </div>
            {streamed ? (
              <div>
                {renderAnswer(streamed, liveRefs)}
                <span className="caret" />
              </div>
            ) : (
              <p className="thinking-row">
                {toolNote || 'Connecting the dots'}
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
              </p>
            )}
          </div>
        )}
        {pins.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {pins.map((p) => (
              <span key={p.id} className="chip" style={{ cursor: 'pointer' }} onClick={() => setPins(pins.filter((x) => x.id !== p.id))} title="Remove">
                📌 {p.title.slice(0, 32)} ✕
              </span>
            ))}
          </div>
        )}
        <div className="composer">
          <textarea
            placeholder="Ask a question, follow a thread, make something new…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="row">
            <span className="chip">Your saved context</span>
            {timing && <small style={{ color: 'var(--muted)' }}>{timing}</small>}
            <button className="send" onClick={() => send()} disabled={busy} aria-label="Send" title="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
        {convId && !busy && messages.some((m) => m.role === 'assistant') && (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-light" onClick={saveDraft}>
              Save as draft
            </button>
            {draftLink && (
              <Link href={`/drafts/${draftLink}`} style={{ color: 'var(--rust)' }}>
                Open draft ↗
              </Link>
            )}
          </div>
        )}
        {threads.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="sec-title">Recent threads</div>
              <button className="btn-ghost" onClick={clearThreads} title="Delete all threads">
                Clear all
              </button>
            </div>
            {threads.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link
                  href={`/think?c=${c.id}`}
                  style={{ flex: 1, color: c.id === convId ? 'var(--rust)' : undefined }}
                >
                  {c.title || 'Untitled thread'}
                </Link>
                <button
                  className="btn-ghost"
                  onClick={() => delThread(c.id)}
                  title="Delete this thread"
                  aria-label="Delete thread"
                  style={{ padding: '2px 8px' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rail">
        <b>Thinking with</b>
        {refs.length === 0 && <small style={{ color: 'var(--muted)' }}>References you think with appear here.</small>}
        {refs.map((r) => (
          <Link key={r.id} href={`/recents/${r.id}`} className="refcard">
            {r.has_shot && <img src={`/api/dash/shot/${r.id}`} alt="" loading="lazy" />}
            <div className="b">
              [{r.n}] {r.title}
              <small>
                <br />
                {r.reason || r.excerpt.slice(0, 90)}
              </small>
            </div>
          </Link>
        ))}
        {!ctxOpen ? (
          <button className="btn-light" onClick={() => setCtxOpen(true)}>
            + Add more context
          </button>
        ) : (
          <div className="card" style={{ padding: 10 }}>
            <input
              className="txt"
              autoFocus
              placeholder="Search your saves…"
              value={ctxQ}
              onChange={(e) => ctxSearch(e.target.value)}
            />
            {ctxHits.map((h) => (
              <div key={h.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
                <span style={{ flex: 1 }}>{h.title}</span>
                <button className="btn-light" style={{ padding: '3px 10px' }} onClick={() => pin(h)}>
                  Pin
                </button>
              </div>
            ))}
            <button className="btn-ghost" style={{ marginTop: 6 }} onClick={() => { setCtxOpen(false); setCtxQ(''); setCtxHits([]); }}>
              Done
            </button>
          </div>
        )}
        <small style={{ color: 'var(--muted)' }}>
          Answers use only the references in this conversation. Your notes help shape the direction.
        </small>
      </div>
    </div>
  );
}
