'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ProjectsClient() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [intention, setIntention] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/dash/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), intention: intention.trim() }),
      });
      if (res.ok) {
        setName('');
        setIntention('');
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 18 }}>
      <b>New project</b>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="txt" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="txt"
          placeholder="Intention (optional)"
          value={intention}
          onChange={(e) => setIntention(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className="btn-rust" onClick={create} disabled={busy}>
          Create
        </button>
      </div>
    </div>
  );
}
