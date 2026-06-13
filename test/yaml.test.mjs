import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/yaml.mjs';

test('parses flat scalars with type coercion', () => {
  const r = parseYaml('language: es\nid_digits: 4\nactive: true');
  assert.deepEqual(r, { language: 'es', id_digits: 4, active: true });
});

test('keeps quoted strings as strings', () => {
  const r = parseYaml('id: "0001"');
  assert.equal(r.id, '0001');
});

test('parses inline arrays with coercion', () => {
  const r = parseYaml('statuses: [draft, approved, done]');
  assert.deepEqual(r.statuses, ['draft', 'approved', 'done']);
});

test('parses empty inline array', () => {
  const r = parseYaml('depends_on: []');
  assert.deepEqual(r.depends_on, []);
});

test('quoted items inside inline arrays stay strings', () => {
  const r = parseYaml('depends_on: ["0001", "0002"]');
  assert.deepEqual(r.depends_on, ['0001', '0002']);
});

test('ignores comments and blank lines', () => {
  const r = parseYaml('# a comment\n\nlanguage: en\n  # indented comment\n');
  assert.deepEqual(r, { language: 'en' });
});

test('parses nested maps by indentation', () => {
  const text = [
    'types:',
    '  feature:',
    '    stages: [request, plan]',
    '  bug:',
    '    stages: [request]',
  ].join('\n');
  const r = parseYaml(text);
  assert.deepEqual(r, {
    types: {
      feature: { stages: ['request', 'plan'] },
      bug: { stages: ['request'] },
    },
  });
});

test('parses a full config sample', () => {
  const text = [
    'language: es',
    'changes_dir: .sl/changes',
    'id_digits: 4',
    'statuses: [draft, approved, in-progress, blocked, done]',
    'types:',
    '  feature:',
    '    stages: [request, investigation, plan]',
  ].join('\n');
  const r = parseYaml(text);
  assert.equal(r.language, 'es');
  assert.equal(r.changes_dir, '.sl/changes');
  assert.equal(r.id_digits, 4);
  assert.deepEqual(r.statuses, ['draft', 'approved', 'in-progress', 'blocked', 'done']);
  assert.deepEqual(r.types.feature.stages, ['request', 'investigation', 'plan']);
});
