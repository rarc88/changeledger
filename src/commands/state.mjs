import { loadLedgerStore } from '../ledger-store.mjs';
import { stateCapabilities } from '../state-capabilities.mjs';
import {
  createStateBaseline,
  doctorStateMigration,
  exportStateRecovery,
  prepareStateActivation,
  previewStateMigration,
} from '../state-migration.mjs';
import { validateReceive, validateUpdate } from '../state-receive.mjs';

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

export function stateMigrate(
  cwd = process.cwd(),
  { preview = false, create = false, sources = [], output, plan } = {},
  activity = {},
) {
  if (preview === create) {
    throw new Error('state migrate requires exactly one mode: --preview or --create');
  }
  if (preview) {
    if (plan) throw new Error('state migrate --preview does not accept --plan');
    return previewStateMigration({ sources, output }, cwd, activity);
  }
  if (sources.length || output) {
    throw new Error('state migrate --create accepts --plan only');
  }
  return createStateBaseline({ planFile: plan }, cwd, activity);
}

export function stateActivate(
  cwd = process.cwd(),
  { prepare = false, baseline } = {},
  activity = {},
) {
  if (!prepare) throw new Error('state activate requires --prepare');
  return prepareStateActivation({ baseline }, cwd, activity);
}

export function stateDoctor(cwd = process.cwd(), options = {}, activity = {}) {
  if (!options.activationRef) throw new Error('state doctor requires --activation-ref');
  const result = doctorStateMigration(options, cwd, activity);
  return {
    ...result,
    capabilities: stateCapabilities(options.adapterEvidence, {
      ref: result.ref,
      oid: result.activation,
    }),
  };
}

export function stateValidateUpdate(cwd = process.cwd(), options = {}) {
  return validateUpdate({ repoRoot: cwd, ...options });
}

export function stateValidateReceive(input, cwd = process.cwd(), options = {}) {
  return validateReceive(input, { repoRoot: cwd, ...options });
}

export function stateExport(cwd = process.cwd(), { recoveryBranch = false } = {}, activity = {}) {
  if (!recoveryBranch) throw new Error('state export requires --recovery-branch');
  return exportStateRecovery(cwd, {}, activity);
}
