import { parseDocument, stringify } from 'yaml';

// YAML is a broad format; Spec Ledger keeps this wrapper narrow so callers get
// stable domain behavior while syntax handling is delegated to a mature parser.

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseYaml(text) {
  const doc = parseDocument(text, {
    merge: false,
    uniqueKeys: true,
  });
  if (doc.errors.length) throw yamlError(doc.errors[0]);
  const value = doc.toJS() ?? {};
  if (Array.isArray(value) || !value || typeof value !== 'object') {
    throw new Error('YAML document must be a mapping');
  }
  assertSafeKeys(value);
  return value;
}

export function stringifyYaml(value) {
  return stringify(value, { lineWidth: 0 });
}

function yamlError(error) {
  if (/keys must be unique/i.test(error.message)) {
    return new Error(`Duplicate key "${duplicateKey(error.message) ?? 'unknown'}" in YAML`);
  }
  return error;
}

function duplicateKey(message) {
  const seen = new Set();
  for (const line of message.split('\n')) {
    const match = line.match(/^(\S[^:]*):/);
    if (!match) continue;
    if (seen.has(match[1])) return match[1];
    seen.add(match[1]);
  }
  return null;
}

function assertSafeKeys(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertSafeKeys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`Unsafe key "${key}" in YAML`);
    assertSafeKeys(child);
  }
}

export function serializeScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const s = String(value ?? '');
  return needsQuoting(s) ? quoteDouble(s) : s;
}

function needsQuoting(s) {
  if (s === '') return true;
  if (s !== s.trim()) return true;
  try {
    if (parseYaml(`k: ${s}`).k !== s) return true;
  } catch {
    return true;
  }
  return stringify({ k: s }).trimEnd() !== `k: ${s}`;
}

function quoteDouble(s) {
  return stringify(s, { defaultStringType: 'QUOTE_DOUBLE', lineWidth: 0 }).trimEnd();
}
