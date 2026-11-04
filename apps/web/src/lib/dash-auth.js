'use strict';

// Localhost-only guard for dashboard routes. The dashboard is a trusted local
// UI; production needs real session auth. Extension-facing /api/* keeps tokens.

export function isLocalReq(req) {
  const host = (req.headers.get('host') || '').toLowerCase();
  return (
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    host === 'localhost' ||
    host === '127.0.0.1'
  );
}

export function localOnly(req) {
  if (isLocalReq(req)) return null;
  return Response.json({ error: 'localhost only' }, { status: 403 });
}
