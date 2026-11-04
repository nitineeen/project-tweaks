'use client';

import { useState } from 'react';

export default function SettingsClient({ memory, interests }) {
  const [vals, setVals] = useState(memory);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [wipeResult, setWipeResult] = useState('');

  async function saveMemory() {
    setBusy(true);
    try {
      const rows = [
        ['permanent', 'name', vals.name],
        ['permanent', 'email', vals.email],
        ['occupational', 'role', vals.role],
        ['dynamic', 'current_project', vals.project],
      ];
      for (const [layer, key, value] of rows) {
        await fetch('/api/dash/memory', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layer, key, value }),
        });
      }
      setSaved('Saved ✓');
      setTimeout(() => setSaved(''), 2000);
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    if (confirm !== 'DELETE' || busy) return;
    if (!window.confirm('Permanently delete ALL saves, memory, stats, threads, drafts and projects? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/dash/wipe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const j = await res.json();
      if (res.ok) {
        const c = j.counts;
        setWipeResult(
          `Deleted: ${c.saves} saves, ${c.user_memory} memory rows, ${c.taxonomy_stats} stats, ${c.conversations} threads, ${c.drafts} drafts, ${c.projects} projects, ${c.shot_files} screenshots.`
        );
        setConfirm('');
      } else {
        setWipeResult(j.error || 'Wipe failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (label, k, placeholder) => (
    <div>
      <small style={{ color: 'var(--muted)' }}>{label}</small>
      <input
        className="txt"
        style={{ marginTop: 4 }}
        placeholder={placeholder}
        value={vals[k] || ''}
        onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
      />
    </div>
  );

  return (
    <div>
      <div className="sec-title">Memory</div>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {field('Name', 'name', 'Your name')}
        {field('Email', 'email', 'you@example.com')}
        {field('Role', 'role', 'What you do')}
        {field('Current project', 'project', 'What you are working on right now')}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Top interests: <b>{interests.join(', ') || '—'}</b> (grows automatically as saves file)
        </div>
        <div>
          <button className="btn-rust" onClick={saveMemory} disabled={busy}>
            Save memory
          </button>{' '}
          <small style={{ color: 'var(--moss)' }}>{saved}</small>
        </div>
      </div>
      <div className="sec-title" style={{ color: 'var(--rust)' }}>Danger zone</div>
      <div className="card" style={{ padding: 16, borderColor: 'var(--rust)' }}>
        <b>Delete everything</b>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Permanently deletes all saves, screenshots, memory, stats, threads, drafts and projects.
          Nothing goes to Trash. Users, rates and usage history are kept.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="txt"
            style={{ width: 220 }}
            placeholder='Type DELETE to confirm'
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            className="btn-rust"
            onClick={wipe}
            disabled={busy || confirm !== 'DELETE'}
            style={{ opacity: confirm === 'DELETE' ? 1 : 0.5 }}
          >
            Delete everything
          </button>
        </div>
        {wipeResult && <p style={{ fontSize: 13, marginBottom: 0 }}>{wipeResult}</p>}
      </div>
    </div>
  );
}
