const DEFINITIONS = Object.freeze({
  history_protection: {
    fallback: 'unknown',
    values: ['unknown', 'advisory', 'enforced'],
    trusted: ['enforced'],
    downgrade: 'advisory',
  },
  content_validation: {
    fallback: 'unavailable',
    values: ['unavailable', 'configured', 'verified'],
    trusted: ['verified'],
    downgrade: 'configured',
  },
  actor_authentication: {
    fallback: 'unavailable',
    values: ['unavailable', 'provider-asserted', 'verified'],
    trusted: ['provider-asserted', 'verified'],
    downgrade: 'unavailable',
  },
  legacy_path_protection: {
    fallback: 'unavailable',
    values: ['unavailable', 'configured', 'verified'],
    trusted: ['verified'],
    downgrade: 'configured',
  },
});
const TRUSTED_ADAPTER = Symbol('trusted ChangeLedger adapter evidence');

export function trustedAdapterEvidence(evidence) {
  return Object.freeze({ ...evidence, [TRUSTED_ADAPTER]: true });
}

function unavailable(name, reason) {
  return {
    capability: name,
    value: DEFINITIONS[name].fallback,
    provider: null,
    ref: null,
    oid: null,
    mechanism: null,
    evidence: null,
    reason,
  };
}

export function stateCapabilities(evidence = [], observation = {}) {
  const result = Object.fromEntries(
    Object.keys(DEFINITIONS).map((name) => [
      name,
      unavailable(name, 'no trusted adapter evidence'),
    ]),
  );
  for (const item of evidence) {
    const definition = DEFINITIONS[item?.capability];
    if (!definition) continue;
    const complete =
      [item.provider, item.ref, item.oid, item.mechanism, item.evidence].every(
        (value) => typeof value === 'string' && value.length > 0,
      ) &&
      /^refs\/[^\s\0]+$/.test(item.ref) &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(item.oid) &&
      (!observation.ref || item.ref === observation.ref) &&
      (!observation.oid || item.oid === observation.oid);
    if (!complete || !definition.values.includes(item.value)) {
      result[item.capability] = unavailable(item.capability, 'evidence is incomplete or invalid');
      continue;
    }
    const value =
      definition.trusted.includes(item.value) && item[TRUSTED_ADAPTER] !== true
        ? definition.downgrade
        : item.value;
    result[item.capability] = {
      capability: item.capability,
      value,
      provider: item.provider,
      ref: item.ref,
      oid: item.oid,
      mechanism: item.mechanism,
      evidence: item.evidence,
      reason:
        value === item.value
          ? (item.reason ?? null)
          : 'evidence is not from a trusted provider adapter',
    };
  }
  return result;
}

export function selfManagedCapabilities({
  ref,
  oid,
  contentValidated = false,
  legacyPathsValidated = false,
  provider = 'self-managed-git',
}) {
  const evidence = [
    trustedAdapterEvidence({
      capability: 'history_protection',
      value: 'enforced',
      provider,
      ref,
      oid,
      mechanism: 'pre-receive',
      evidence: 'fast-forward ancestry checked inside receive quarantine',
    }),
  ];
  if (contentValidated) {
    evidence.push(
      trustedAdapterEvidence({
        capability: 'content_validation',
        value: 'verified',
        provider,
        ref,
        oid,
        mechanism: 'pre-receive',
        evidence: 'ChangeLedger validator completed inside receive quarantine',
      }),
    );
  }
  if (legacyPathsValidated) {
    evidence.push(
      trustedAdapterEvidence({
        capability: 'legacy_path_protection',
        value: 'verified',
        provider,
        ref,
        oid,
        mechanism: 'pre-receive',
        evidence: 'protected integration paths checked for every commit',
      }),
    );
  }
  return stateCapabilities(evidence);
}
