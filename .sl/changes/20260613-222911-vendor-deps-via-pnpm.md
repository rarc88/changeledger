---
id: "20260613-222911"
title: Servir marked y mermaid desde pnpm en vez de vendor
type: refactor
status: draft
created: 2026-06-13T22:29:11Z
depends_on: []
---

## Request

marked (36K) y mermaid (3.2M) están vendorizados en git → inflan el repo. Mejor declararlas como `dependencies` y que pnpm/npm las instale; el server las sirve desde `node_modules`. Alinea con publicar en npm.

## Proposal

## Plan

## Log
