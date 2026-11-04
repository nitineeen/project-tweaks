'use client';

import { useState } from 'react';

export default function DraftEditor({ draft }) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body || '');
  const [status, setStatus] = useState('All changes saved');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus('Saving…');
    try {
      const res = await fetch('/api/dash/drafts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, title, body }),
      });
      setStatus(res.ok ? 'All changes saved' : 'Save failed');
    } catch {
      setStatus('Save failed');
    } finally {
      setBusy(false);
    }
  }

  const words = body.split(/\s+/).filter(Boolean).length;
  return (
    <div>
      <input className="txt h-display" style={{ fontSize: 28 }} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {status} · {words} words · {draft.linked_save_ids.length} linked references
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn-rust" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
      <textarea
        className="txt"
        style={{ minHeight: 320, lineHeight: 1.7 }}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Start writing…"
      />
    </div>
  );
}
