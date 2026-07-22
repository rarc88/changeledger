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
  try {
    return validateReceiveBatch(input, { ...options, env: options.env ?? receiveGitEnv() }).map(
      (receipt) => withServerCapabilities(receipt, options.stateRef),
    );
  } catch (error) {
    const receipt = error.receipt ?? {};
    error.receipt = {
      ...receipt,
      provider: 'self-managed-git',
      capabilities: stateCapabilities(),
    };
    throw error;
  }
}

export function validateUpdate(options = {}) {
  try {
    return {
      ...validateStateUpdate(options),
      provider: 'local-validator',
      capabilities: stateCapabilities(),
    };
  } catch (error) {
    error.receipt = {
      ...(error.receipt ?? {}),
      provider: 'local-validator',
      capabilities: stateCapabilities(),
    };
    throw error;
  }
}
