import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRepo } from '../src/check.mjs';
import {
  changeBranchFormat,
  integrationBranch,
  renderChangeBranch,
  stateConfig,
} from '../src/config.mjs';

// 20260711-210115 CR1: optional `git.integration_branch` resolves from config.

test('210115 CR1: integrationBranch returns the configured branch', () => {
  assert.equal(integrationBranch({ git: { integration_branch: 'dev' } }), 'dev');
  assert.equal(integrationBranch({ git: { integration_branch: ' dev ' } }), 'dev');
});

test('210115 CR1: integrationBranch is undefined when the key is absent', () => {
  assert.equal(integrationBranch({}), undefined);
  assert.equal(integrationBranch({ git: {} }), undefined);
  assert.equal(integrationBranch(undefined), undefined);
});

test('210115 CR1: integrationBranch fails fast on a non-string or empty value', () => {
  for (const bad of ['', '   ', 7, true, ['dev'], {}]) {
    assert.throws(
      () => integrationBranch({ git: { integration_branch: bad } }),
      /config "git\.integration_branch" must be a non-empty string/,
    );
  }
});

test('124231 CR14: change branch format defaults and renders immutable fields', () => {
  assert.equal(changeBranchFormat({}), '{type}/{id}');
  assert.equal(
    renderChangeBranch({}, { type: 'feature', id: '20260720-124231' }),
    'feature/20260720-124231',
  );
  assert.equal(
    renderChangeBranch(
      { git: { change_branch_format: 'changes/{type}/{id}' } },
      { type: 'bug', id: '20260720-124231' },
    ),
    'changes/bug/20260720-124231',
  );
});

test('124231 CR14: change branch format rejects ambiguity and invalid refs', () => {
  for (const format of ['{type}', '{id}/{id}', '{owner}/{id}', '/{id}', '{type}/../{id}']) {
    assert.throws(
      () =>
        renderChangeBranch({ git: { change_branch_format: format } }, { type: 'feature', id: 'x' }),
      /git\.change_branch_format|valid Git branch/,
    );
  }
});

test('124231 CR19: state activation fields are atomic', () => {
  assert.equal(stateConfig({}), undefined);
  assert.deepEqual(
    stateConfig({
      git: { state_branch: 'changeledger/state', state_baseline: 'a'.repeat(40) },
    }),
    { branch: 'changeledger/state', baseline: 'a'.repeat(40) },
  );
  assert.throws(
    () => stateConfig({ git: { state_branch: 'changeledger/state' } }),
    /must be configured together/,
  );
  assert.throws(
    () => stateConfig({ git: { state_baseline: 'a'.repeat(40) } }),
    /must be configured together/,
  );
});

test('124231 CR14/CR19: the pure checker validates Git config shape', () => {
  const base = {
    changes_dir: '.changeledger/changes',
    statuses: ['draft', 'in-validation', 'done'],
    stages: ['request'],
    types: { feature: { stages: ['request'] } },
  };
  const messages = (git) =>
    checkRepo({ config: { ...base, git }, changes: [] }).errors.map((error) => error.message);

  assert.ok(messages('dev').some((message) => /git.*mapping/.test(message)));
  assert.ok(
    messages({ state_branch: 'changeledger/state' }).some((message) =>
      /configured together/.test(message),
    ),
  );
  assert.ok(
    messages({ change_branch_format: '{owner}/{id}' }).some((message) =>
      /unknown placeholder/.test(message),
    ),
  );
  assert.ok(messages({ state_branch: '../state', state_baseline: 'x' }).length >= 2);
});
