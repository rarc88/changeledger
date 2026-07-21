import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRepo } from '../src/check.mjs';
import { integrationBranch } from '../src/config.mjs';

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

test('195659 CR3: integrationBranch and check reject the same branch forms', () => {
  const base = {
    changes_dir: '.changeledger/changes',
    statuses: ['draft', 'approved', 'in-progress', 'in-validation', 'blocked', 'done'],
    stages: ['request', 'investigation', 'proposal', 'specification', 'plan', 'log'],
    types: { feature: { stages: ['request', 'plan', 'log'] } },
  };
  for (const value of [undefined, null, 'dev', ' dev ', '', ' ', 7, true, [], {}]) {
    const accessorAccepts = (() => {
      try {
        integrationBranch({ git: { integration_branch: value } });
        return true;
      } catch {
        return false;
      }
    })();
    const { errors } = checkRepo({
      config: { ...base, git: { integration_branch: value } },
      changes: [],
    });
    const checkerAccepts = !errors.some(
      (error) => error.message === 'config "git.integration_branch" must be a non-empty string',
    );
    assert.equal(checkerAccepts, accessorAccepts, String(value));
  }
  assert.equal(integrationBranch({ git: { integration_branch: ' dev ' } }), 'dev');
});
