const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

// Bare hostname from a Host/Origin authority, dropping the port and IPv6
// brackets. '' when absent.
export function hostnameOf(authority) {
  if (!authority) return '';
  const m = String(authority).match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  const host = m ? m[1] : authority;
  return host.replace(/^\[|\]$/g, '');
}

// The request must be addressed to the loopback host. This (with the loopback
// bind) defends against DNS-rebinding: a rebinding attack reaches the socket but
// carries the attacker's domain in Host.
export function isLocalHost(req) {
  return LOOPBACK.has(hostnameOf(req.headers.host));
}

// A write must come from the viewer's own page: a same-origin Origin (when the
// browser sends one) and the per-process token the page was given. A
// cross-origin attacker cannot read the token, so it cannot forge the header.
export function isAuthorizedWrite(req, token) {
  if (req.headers['x-changeledger-token'] !== token) return false;
  const origin = req.headers.origin;
  if (origin && !LOOPBACK.has(hostnameOf(new URL(origin).host))) return false;
  return true;
}
