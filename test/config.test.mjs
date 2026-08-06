import assert from 'node:assert/strict';
import test from 'node:test';
import { changeBranchFormat, integrationBranch, renderChangeBranch } from '../src/config.mjs';

// 20260711-210115 CR1: optional `git.integration_branch` resolves from config.

test('210115 CR1: integrationBranch returns the configured branch', () => {
  assert.equal(integrationBranch({ git: { integration_branch: 'dev' } }), 'dev');
  assert.equal(integrationBranch({ git: { integration_branch: ' dev ' } }), 'dev');
});

test('210115 CR1: integrationBranch is undefined when the key is absent', () => {
  assert.equal(integrationBranch({}), undefined);
  assert.equal(integrationBranch({ git: {} }), undefined);
  assert.equal(integrationBranch({ git: { integration_branch: null } }), undefined);
  assert.equal(integrationBranch(undefined), undefined);
});

test('20260731-161654 CR1: integrationBranch rejects a non-mapping git section', () => {
  for (const git of ['dev', [], true]) {
    assert.throws(() => integrationBranch({ git }), /config "git" must be a mapping/);
  }
});

test('210115 CR1: integrationBranch fails fast on a non-string or empty value', () => {
  for (const bad of ['', '   ', 7, true, ['dev'], {}]) {
    assert.throws(
      () => integrationBranch({ git: { integration_branch: bad } }),
      /config "git\.integration_branch" must be a non-empty string/,
    );
  }
});

test('161655 CR1: change branch rendering is deterministic from immutable fields', () => {
  const config = { git: { change_branch_format: 'changes/{type}/{id}' } };
  const change = { type: 'feature', id: '20260731-161655' };

  assert.equal(changeBranchFormat(config), 'changes/{type}/{id}');
  assert.equal(renderChangeBranch(config, change), 'changes/feature/20260731-161655');
  assert.equal(renderChangeBranch(config, change), 'changes/feature/20260731-161655');
});

test('161655 CR1: placeholder-shaped type text is inserted opaquely', () => {
  const config = { git: { change_branch_format: 'work/{type}/{id}' } };

  assert.equal(
    renderChangeBranch(config, { type: 'bug{id}', id: '20260731-161655' }),
    'work/bug{id}/20260731-161655',
  );
});

test('161655 CR1: replacement-pattern type text is inserted opaquely', () => {
  const config = { git: { change_branch_format: 'work/{type}/{id}' } };

  assert.equal(
    renderChangeBranch(config, { type: 'bug$&', id: '20260731-161655' }),
    'work/bug$&/20260731-161655',
  );
});

test('161655 CR7: absent and null branch formats preserve opt-out behavior', () => {
  const change = { type: 'feature', id: '20260731-161655' };
  for (const config of [{}, { git: {} }, { git: { change_branch_format: null } }]) {
    assert.equal(changeBranchFormat(config), undefined);
    assert.equal(renderChangeBranch(config, change), undefined);
  }
});

test('161655 CR3: ambiguous and malformed branch formats fail closed', () => {
  const change = { type: 'feature', id: '20260731-161655' };
  const cases = [
    ['{type}', /must contain "\{id\}" exactly once/],
    ['{id}/{id}', /must contain "\{id\}" exactly once/],
    ['{owner}/{id}', /unknown placeholder "\{owner\}"/],
    ['{type/{id}', /contains malformed placeholders/],
    ['bad..{id}', /renders an invalid Git branch: bad\.\.20260731-161655/],
  ];

  for (const [format, diagnostic] of cases) {
    assert.throws(
      () => renderChangeBranch({ git: { change_branch_format: format } }, change),
      diagnostic,
      format,
    );
  }
});

test('161655 CR3: configured branch format must be a non-empty string', () => {
  for (const value of ['', '   ', 7, true, [], {}]) {
    assert.throws(
      () => changeBranchFormat({ git: { change_branch_format: value } }),
      /config "git\.change_branch_format" must be a non-empty string/,
    );
  }
});
