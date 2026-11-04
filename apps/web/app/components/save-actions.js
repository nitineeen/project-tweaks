'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SaveActions({ id, projects, projectSlug, isResource, deleted }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function put(op, value) {
    setBusy(true);
    try {
      await fetch(`/api/dash/saves/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, value }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
      <select
        className="txt"
        style={{ width: 220 }}
        value={projectSlug || ''}
        disabled={busy}
        onChange={(e) => put('project', e.target.value || null)}
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn-light" disabled={busy} onClick={() => put(isResource ? 'unresource' : 'resource', 'reading')}>
        {isResource ? 'Unmark resource' : 'Mark as resource'}
      </button>
      {!deleted ? (
        <button className="btn-light" disabled={busy} onClick={() => put('trash')}>
          Move to Trash
        </button>
      ) : (
        <button className="btn-light" disabled={busy} onClick={() => put('restore')}>
          Restore
        </button>
      )}
    </div>
  );
}
