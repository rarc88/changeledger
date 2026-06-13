// Parses a spec file: the persistent-truth layer. Unlike changes, specs have no
// lifecycle — just frontmatter (title, updated, tags) plus a free markdown body.

import { parseYaml } from './yaml.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export function parseSpec(text) {
  const fm = text.match(FRONTMATTER);
  if (!fm) throw new Error('Spec is missing its frontmatter block');
  return { frontmatter: parseYaml(fm[1]), body: text.slice(fm[0].length).trim() };
}
