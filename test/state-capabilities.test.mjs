import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selfManagedCapabilities,
  stateCapabilities,
  trustedAdapterEvidence,
} from '../src/state-capabilities.mjs';

const evidence = {
  trusted_boundary: true,
  provider: 'github',
  ref: 'refs/heads/dev',
  oid: 'a'.repeat(40),
  mechanism: 'ruleset-api',
  evidence: 'authenticated ruleset response',
};

test('193104 CR5: hosted history evidence does not imply content validation', () => {
  const capabilities = stateCapabilities([
    trustedAdapterEvidence({ ...evidence, capability: 'history_protection', value: 'enforced' }),
  ]);
  assert.equal(capabilities.history_protection.value, 'enforced');
  assert.equal(capabilities.content_validation.value, 'unavailable');
  assert.equal('strong' in capabilities, false);
});

test('193104 CR4/CR5: user-controlled evidence cannot produce verified capability', () => {
  for (const source of ['cli', 'config', 'stderr']) {
    const capabilities = stateCapabilities([
      {
        ...evidence,
        trusted_boundary: true,
        mechanism: source,
        capability: 'content_validation',
        value: 'verified',
      },
    ]);
    assert.equal(capabilities.content_validation.value, 'configured');
  }
  assert.equal(
    selfManagedCapabilities({ ref: 'refs/heads/dev', oid: 'b'.repeat(40) }).actor_authentication
      .value,
    'unavailable',
  );
});

test('193104 CR5/CR6: self-managed receipts report only capabilities actually evaluated', () => {
  const state = selfManagedCapabilities({
    ref: 'refs/heads/changeledger/state',
    oid: 'c'.repeat(40),
    contentValidated: true,
  });
  assert.equal(state.history_protection.value, 'enforced');
  assert.equal(state.content_validation.value, 'verified');
  assert.equal(state.legacy_path_protection.value, 'unavailable');

  const integration = selfManagedCapabilities({
    ref: 'refs/heads/dev',
    oid: 'd'.repeat(40),
    legacyPathsValidated: true,
  });
  assert.equal(integration.content_validation.value, 'unavailable');
  assert.equal(integration.legacy_path_protection.value, 'verified');
  assert.equal(integration.actor_authentication.value, 'unavailable');
});

test('202058 CR3: verified content_validation evidence does not claim actor authentication', () => {
  const state = selfManagedCapabilities({
    ref: 'refs/heads/changeledger/state',
    oid: 'c'.repeat(40),
    contentValidated: true,
  });
  assert.equal(state.content_validation.value, 'verified');
  assert.match(state.content_validation.evidence, /not an actor authentication/);
});

test('193104 correction CR5: trusted evidence requires valid and observed ref/OID binding', () => {
  for (const invalid of [{ ref: 'not-a-full-ref' }, { oid: 'not-an-oid' }]) {
    const capabilities = stateCapabilities([
      trustedAdapterEvidence({
        ...evidence,
        ...invalid,
        capability: 'history_protection',
        value: 'enforced',
      }),
    ]);
    assert.equal(capabilities.history_protection.value, 'unknown');
  }
  const mismatched = stateCapabilities(
    [trustedAdapterEvidence({ ...evidence, capability: 'history_protection', value: 'enforced' })],
    { ref: 'refs/heads/main', oid: 'b'.repeat(40) },
  );
  assert.equal(mismatched.history_protection.value, 'unknown');
});
