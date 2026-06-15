import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml, serializeScalar } from '../src/yaml.mjs';

// Round-trips a single key through serialize → parse and returns the value.
const roundTrip = (value) => parseYaml(`k: ${serializeScalar(value)}`).k;

test('serializeScalar keeps ambiguous strings as strings', () => {
  for (const v of ['true', 'false', '123', '-7', '[draft]', 'hello # world', '#hash']) {
    assert.equal(roundTrip(v), v, `failed for ${v}`);
  }
});

test('serializeScalar preserves colons, quotes and edge whitespace', () => {
  for (const v of ['a: b', 'foo:', 'he said "hi"', "it's fine", ' leading', 'trailing ', '']) {
    assert.equal(roundTrip(v), v, `failed for ${JSON.stringify(v)}`);
  }
});

test('serializeScalar preserves newlines and tabs', () => {
  assert.equal(roundTrip('line1\nline2'), 'line1\nline2');
  assert.equal(roundTrip('a\tb'), 'a\tb');
});

test('serializeScalar emits bare numbers and booleans', () => {
  assert.equal(serializeScalar(123), '123');
  assert.equal(serializeScalar(true), 'true');
  assert.equal(parseYaml(`k: ${serializeScalar(42)}`).k, 42);
});

test('serializeScalar leaves safe strings unquoted', () => {
  assert.equal(serializeScalar('in-progress'), 'in-progress');
  assert.equal(serializeScalar('My Title'), 'My Title');
});

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
