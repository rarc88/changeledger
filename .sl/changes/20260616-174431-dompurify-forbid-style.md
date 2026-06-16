---
id: "20260616-174431"
title: Forbid style tags in viewer DOMPurify config
type: bug
status: done
created: 2026-06-16T17:44:31Z
depends_on: []
owner: Roberto Ruiz
---

## Request
The web viewer permits `<style>` tags directly through the `DOMPurify` sanitizer, creating a potential cross-team Denial of Service vector.

## Investigation
By default, `DOMPurify.sanitize()` strips scripts but retains CSS. If an attacker places a CSS block hiding the application body (`body { display: none }`), developers viewing the change log get a blank screen.

## Specification
### CR1 - Style tags are strictly removed
- **Given** an untrusted Markdown string containing `<style>body{display:none}</style>`
- **When** passing the value through `safeHtml`
- **Then** the style node must not appear in the rendering.

## Plan
- [x] Pass `{ FORBID_TAGS: ['style'] }` to `DOMPurify.sanitize` in `src/viewer/public/security.js` and add testing payload stripping to `test/viewer-sanitize.test.mjs`. (CR1) — 2026-06-16T20:48:29Z

## Log
- **2026-06-16T20:47:02Z** — status: draft → approved
- **2026-06-16T20:48:11Z** — status: approved → in-progress
- **2026-06-16T20:48:11Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T20:48:32Z** — status: in-progress → in-review
- **2026-06-16T20:58:51Z** — review → done (delegated subagent, clean context)
