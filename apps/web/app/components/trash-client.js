'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function TrashClient({ items }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function restore(id) {
    setBusy(true);
    try {
      await fetch(`/api/dash/saves/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'restore' }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function empty() {
    if (!window.confirm('Permanently delete everything in Trash? This cannot be undone.')) return;
    setBusy(true);
    try {
      await fetch('/api/dash/trash', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return <div className="empty">Trash is empty. Letting go is part of thinking.</div>;
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button className="btn-light" onClick={empty} disabled={busy}>
          Empty trash
        </button>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>ITEM</th>
            <th>DELETED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>
                <b>{s.page_title || '(untitled)'}</b>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.original_url}</div>
              </td>
              <td>{(s.deleted_at || '').slice(0, 10)}</td>
              <td>
                <button className="btn-light" onClick={() => restore(s.id)} disabled={busy}>
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
