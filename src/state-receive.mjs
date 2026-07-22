import { receiveGitEnv } from './git.mjs';
import { selfManagedCapabilities, stateCapabilities } from './state-capabilities.mjs';
import { validateReceiveBatch, validateStateUpdate } from './state-validation.mjs';

function withServerCapabilities(receipt, stateRef) {
  return {
    ...receipt,
    provider: 'self-managed-git',
    capabilities: selfManagedCapabilities({
      ref: receipt.ref,
      oid: receipt.newOid,
      contentValidated: receipt.ref === stateRef,
      legacyPathsValidated: receipt.ref !== stateRef,
    }),
  };
}

export function validateReceive(input, options = {}) {
  return validateReceiveBatch(input, { ...options, env: options.env ?? receiveGitEnv() }).map(
    (receipt) => withServerCapabilities(receipt, options.stateRef),
  );
}

export function validateUpdate(options = {}) {
  return {
    ...validateStateUpdate(options),
    provider: 'local-validator',
    capabilities: stateCapabilities(),
  };
}
