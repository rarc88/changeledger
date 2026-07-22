export function pathsOverlap(left = [], right = []) {
  if (!left.length || !right.length) return false;
  const rightPaths = new Set(right);
  return left.some((file) => rightPaths.has(file));
}

export function planReplicaSync(
  { confirmed, observed, pending, observedPaths = [] } = {},
  { isAncestor } = {},
) {
  if (typeof isAncestor !== 'function') {
    throw new Error('replica planning requires an ancestry resolver');
  }

  if (pending) {
    if (
      !confirmed ||
      typeof pending.head !== 'string' ||
      typeof pending.base !== 'string' ||
      pending.head === pending.base ||
      pending.base !== confirmed
    ) {
      return { action: 'invalid-local-state' };
    }
    if (!observed) return { action: 'observe-remote' };
    if (isAncestor(pending.head, observed)) return { action: 'confirm-observed' };
    if (!isAncestor(confirmed, observed)) return { action: 'reject-remote-rewrite' };
    if (observed === pending.base) return { action: 'publish-pending' };
    if (pathsOverlap(pending.paths, observedPaths)) return { action: 'conflict' };
    return { action: 'replay-pending' };
  }

  if (!confirmed) return { action: observed ? 'adopt-observed' : 'unavailable' };
  if (!observed) return { action: 'observe-remote' };
  if (confirmed === observed) return { action: 'current' };
  if (isAncestor(confirmed, observed)) return { action: 'advance-confirmed' };
  return { action: 'reject-remote-rewrite' };
}
