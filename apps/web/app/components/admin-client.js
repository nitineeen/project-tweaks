'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function money(c) {
  if (c === null || c === undefined) return '—';
  return `$${Number(c).toFixed(4)}`;
}

export default function AdminClient({ initialUsers, initialRates }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers || []);
  const [rates, setRates] = useState(initialRates || []);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [limits, setLimits] = useState({});
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [u, r] = await Promise.all([
      fetch('/api/dash/admin/users').then((x) => x.json()),
      fetch('/api/dash/admin/rates').then((x) => x.json()),
    ]);
    setUsers(u.users || []);
    setRates(r.rates || []);
    router.refresh();
  }

  async function create() {
    if (!email.includes('@') || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/dash/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      });
      if (res.ok) {
        setEmail('');
        setName('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id, status) {
    setBusy(true);
    try {
      await fetch(`/api/dash/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setLimit(id) {
    const v = limits[id];
    setBusy(true);
    try {
      await fetch(`/api/dash/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_limit: v === '' || v === undefined ? null : Number(v) }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveRate(model, patch) {
    setBusy(true);
    try {
      await fetch('/api/dash/admin/rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...patch }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="sec-title">Users ({users.length})</div>
      <table className="list">
        <thead>
          <tr>
            <th>USER</th>
            <th>STATUS</th>
            <th>CALLS</th>
            <th>TOKENS</th>
            <th>COST</th>
            <th>LIMIT</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <b>{u.name || '(no name)'}</b>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.email}</div>
              </td>
              <td>{u.status === 'banned' ? '🚫 banned' : 'active'}</td>
              <td>{u.calls}</td>
              <td>{u.tokens_used.toLocaleString()}</td>
              <td>{money(u.cost_usd)}</td>
              <td>
                <input
                  className="txt"
                  style={{ width: 110 }}
                  placeholder="∞"
                  defaultValue={u.token_limit ?? ''}
                  onChange={(e) => setLimits({ ...limits, [u.id]: e.target.value })}
                />
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-light" style={{ padding: '4px 10px', marginRight: 6 }} disabled={busy} onClick={() => setLimit(u.id)}>
                  Set
                </button>
                {u.status === 'banned' ? (
                  <button className="btn-light" style={{ padding: '4px 10px' }} disabled={busy} onClick={() => setStatus(u.id, 'active')}>
                    Unblock
                  </button>
                ) : (
                  <button className="btn-light" style={{ padding: '4px 10px' }} disabled={busy} onClick={() => setStatus(u.id, 'banned')}>
                    Block
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <b>Create user</b>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input className="txt" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="txt" placeholder="name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-rust" onClick={create} disabled={busy}>
            Create
          </button>
        </div>
      </div>
      <div className="sec-title">Rate card ($/1M tokens, or per unit)</div>
      <table className="list">
        <thead>
          <tr>
            <th>MODEL</th>
            <th>IN $/1M</th>
            <th>OUT $/1M</th>
            <th>PER UNIT</th>
            <th>SOURCE</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <RateRow key={r.model} rate={r} busy={busy} onSave={saveRate} />
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        Token rows are hard counts from usage events. $ costs need a rate — blank = rate unknown.
      </p>
    </div>
  );
}

function RateRow({ rate, busy, onSave }) {
  const [pin, setPin] = useState(rate.per_1m_in ?? '');
  const [pout, setPout] = useState(rate.per_1m_out ?? '');
  const [pu, setPu] = useState(rate.per_unit ?? '');
  return (
    <tr>
      <td>
        <code style={{ fontSize: 12 }}>{rate.model}</code>
      </td>
      <td>
        <input className="txt" style={{ width: 90 }} value={pin} onChange={(e) => setPin(e.target.value)} />
      </td>
      <td>
        <input className="txt" style={{ width: 90 }} value={pout} onChange={(e) => setPout(e.target.value)} />
      </td>
      <td>
        <input className="txt" style={{ width: 90 }} value={pu} onChange={(e) => setPu(e.target.value)} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}> /{rate.unit || '—'}</span>
      </td>
      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{rate.source}</td>
      <td>
        <button
          className="btn-light"
          style={{ padding: '4px 10px' }}
          disabled={busy}
          onClick={() => onSave(rate.model, { per_1m_in: pin, per_1m_out: pout, per_unit: pu, unit: rate.unit })}
        >
          Save
        </button>
      </td>
    </tr>
  );
}
