'use client';

import { useState } from 'react';

export default function DraftsClient() {
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/dash/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled draft' }),
      });
      if (res.ok) {
        const { draft } = await res.json();
        window.location.href = `/drafts/${draft.id}`;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn-rust" onClick={create} disabled={busy}>
      New draft
    </button>
  );
}
