# Security Policy

## Supported versions

Spec Ledger is pre-1.0. Security fixes land on the latest published `0.x`
release; older versions are not patched. Upgrade to the newest version before
reporting.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please report privately — do **not** open a public issue for a vulnerability.

- Preferred: open a [private security advisory](https://github.com/rarc88/spec-ledger/security/advisories/new).
- Include: affected version, reproduction steps, and impact.

You'll get an acknowledgement within a few days. Once a fix ships, the advisory
is published with credit (unless you prefer to stay anonymous).

## Threat model

`sl` is a local developer tool: a CLI plus an optional local viewer (`sl view`).
The relevant trust boundary is that **a repository's documents and config are
untrusted input** — you may clone someone else's repo and run `sl` or open the
viewer over it. The design holds these invariants:

- **The viewer binds to loopback only** and rejects non-local `Host` headers
  (DNS-rebinding defense). The only state-changing endpoint requires a
  per-process token injected into the page, so cross-origin pages can't forge
  writes, and the viewer only ever performs the `draft → approved` move.
- **Untrusted content never executes.** Markdown/diagram bodies pass through
  DOMPurify (and Mermaid runs with `securityLevel: 'strict'`); structured
  metadata (ids, types, statuses, headings, timestamps, config values) is
  HTML/attribute-escaped, and CSS custom-property names are whitelisted.
- **Path containment.** Configured `changes_dir`/`specs_dir` cannot escape the
  repository root — absolute paths, `..` traversal, and symlinks (including an
  intermediate symlink to a not-yet-created target) are rejected.
- **Parser hardening.** The YAML subset parser rejects prototype-mutating keys
  (`__proto__`, `constructor`, `prototype`) and duplicate keys.

Out of scope: the viewer is intended for `localhost` use by the person running
it; do not expose it to untrusted networks.
