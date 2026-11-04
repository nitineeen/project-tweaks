import Shell from '../components/shell';
import ThinkClient from '../components/think-client';
import { getThread, listConversations } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Think({ searchParams }) {
  const sp = await searchParams;
  const c = sp?.c || '';
  let thread = null;
  let convos = [];
  try {
    convos = listConversations('local-dev', 8);
    if (c) thread = getThread(c);
  } catch {
    thread = null;
  }
  return (
    <Shell
      active="think"
      breadcrumb={thread ? `Think space / ${thread.title || 'Conversation'}` : 'Think space'}
      breadcrumbRoot={thread ? { label: 'Think space', href: '/think' } : null}
    >
      {/* key remounts the client per thread: without it, clicking another
          thread keeps showing the old conversation (stale useState). */}
      <ThinkClient key={c || 'new'} initial={thread} convos={convos} />
    </Shell>
  );
}
