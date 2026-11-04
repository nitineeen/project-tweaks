'use strict';

// Single local space, dev-token auth.

export function spaceFromRequest(req) {
  if ((process.env.AUTH_MODE || 'dev-token') !== 'dev-token') {
    return { ok: false, error: 'only dev-token auth is wired (set AUTH_MODE=dev-token)' };
  }
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token !== process.env.DEV_EXTENSION_TOKEN) {
    return { ok: false, error: 'bad or missing token' };
  }
  return { ok: true, spaceId: 'local-dev', userId: 'local-user' };
}
