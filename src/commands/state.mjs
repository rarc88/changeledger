import { loadLedgerStore } from '../ledger-store.mjs';

function replicaStore(cwd) {
  const store = loadLedgerStore(cwd);
  if (!store.replica) {
    throw new Error('state replica commands require authority.yml format_version: 2');
  }
  return store.replica;
}

export function stateStatus(cwd = process.cwd()) {
  return replicaStore(cwd).status();
}

export function stateSync(cwd = process.cwd()) {
  return replicaStore(cwd).sync();
}

export function stateAbort(cwd = process.cwd(), { pending = false, offline = false } = {}) {
  if (!pending) throw new Error('state abort requires --pending');
  return replicaStore(cwd).abort({ offline });
}
