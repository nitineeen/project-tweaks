import Shell from '../components/shell';
import SettingsClient from '../components/settings-client';
import { getMemoryRows, topStats } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Settings() {
  let rows = [];
  let interests = [];
  try {
    rows = getMemoryRows('local-dev');
    interests = topStats('local-dev', 'knowledge_type', 5);
  } catch {
    rows = [];
  }
  const get = (layer, key) => rows.find((r) => r.layer === layer && r.key === key)?.value || '';
  const memory = {
    name: get('permanent', 'name'),
    email: get('permanent', 'email'),
    role: get('occupational', 'role'),
    project: get('dynamic', 'current_project'),
  };
  return (
    <Shell active="settings" breadcrumb="Settings">
      <h1 className="h-display" style={{ fontSize: 36, margin: '0 0 4px' }}>
        Settings
      </h1>
      <div className="sec-title">Backend</div>
      <div className="card" style={{ padding: 16, fontSize: 13 }}>
        <div>
          AI: <b>{process.env.AI_PROVIDER}</b> · DB: <b>{process.env.DB_PROVIDER}</b> · Auth:{' '}
          <b>{process.env.AUTH_MODE}</b>
        </div>
        <div style={{ marginTop: 6 }}>
          Extension pairing — API URL: <code>http://localhost:3100</code> · Token:{' '}
          <code>{process.env.DEV_EXTENSION_TOKEN || '(not set)'}</code>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
          Local dev only. Paste these into the extension popup Settings.
        </div>
      </div>
      <SettingsClient
        memory={memory}
        interests={interests.map((s) => s.label)}
      />
    </Shell>
  );
}
