'use client';

import { useEffect, useState } from 'react';

export default function CommandK() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);

  useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  useEffect(() => {
    if (!open || q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/dash/search?q=${encodeURIComponent(q)}`);
        if (r.ok) setHits((await r.json()).hits || []);
      } catch {
        /* search API lands in Step 5 */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [open, q]);

  if (!open) {
    return (
      <button className="kbtn" onClick={() => setOpen(true)}>
        Search anything ⌘K
      </button>
    );
  }
  return (
    <div className="modal-back" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search saves, projects, drafts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {hits.map((h) => (
          <a key={`${h.kind}:${h.id}`} className="hit" href={h.href}>
            {h.title}
            <small>
              {h.sub}
              {h.fuzzy ? ' · close match' : ''}
            </small>
          </a>
        ))}
        {q.length >= 2 && hits.length === 0 && (
          <div className="hit">
            <small>No results yet.</small>
          </div>
        )}
      </div>
    </div>
  );
}
