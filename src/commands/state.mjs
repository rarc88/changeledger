import { loadLedgerStore } from '../ledger-store.mjs';
import { stateCapabilities } from '../state-capabilities.mjs';
import {
  createStateBaseline,
  deactivateStateActivation,
  doctorStateMigration,
  exportStateRecovery,
  installStateActivation,
  prepareStateActivation,
  previewStateMigration,
  previewStateMigrationPlan,
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
    if (plan) {
      if (sources.length || output) {
        throw new Error('state migrate --preview with --plan accepts --plan only');
      }
      return previewStateMigrationPlan({ planFile: plan }, cwd, activity);
    }
    return previewStateMigration({ sources, output }, cwd, activity);
  }
  if (sources.length || output) {
    throw new Error('state migrate --create accepts --plan only');
  }
  return createStateBaseline({ planFile: plan }, cwd, activity);
}

export function stateActivate(
  cwd = process.cwd(),
  { prepare = false, install = false, deactivate = false, baseline, integrationRef } = {},
  activity = {},
) {
  const modes = [prepare && 'prepare', install && 'install', deactivate && 'deactivate'].filter(
    Boolean,
  );
  if (modes.length !== 1) {
    throw new Error(
      'state activate requires exactly one mode: --prepare, --install or --deactivate',
    );
  }
  if (prepare) {
    if (integrationRef)
      throw new Error('state activate --prepare does not accept --integration-ref');
    return prepareStateActivation({ baseline }, cwd, activity);
  }
  if (baseline) {
    throw new Error(`state activate --${modes[0]} does not accept --baseline`);
  }
  if (!integrationRef) {
    throw new Error(`state activate --${modes[0]} requires --integration-ref`);
  }
  if (install) return installStateActivation({ integrationRef }, cwd, activity);
  return deactivateStateActivation({ integrationRef }, cwd, activity);
}

export function stateDoctor(cwd = process.cwd(), options = {}, activity = {}) {
  if (!options.activationRef) {
    throw new Error(
      'state doctor validates a migration activation and requires --activation-ref; ' +
        'to diagnose the replica instead, run `changeledger state status`',
    );
  }
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
