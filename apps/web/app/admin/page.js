import Shell from '../components/shell';
import AdminClient from '../components/admin-client';
import { listUsers, getRates } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Admin() {
  let users = [];
  let rates = [];
  try {
    users = listUsers();
    rates = getRates();
  } catch {
    users = [];
  }
  return (
    <Shell active="admin" breadcrumb="Admin">
      <div className="kicker">RUNNING THE SPACE</div>
      <h1 className="h-display" style={{ fontSize: 40, margin: '6px 0' }}>
        Users, usage, money.
      </h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Localhost only for now — login gating arrives with accounts. Costs come from the rate card below.
      </p>
      <AdminClient initialUsers={users} initialRates={rates} />
    </Shell>
  );
}
