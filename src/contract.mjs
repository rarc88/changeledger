import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { writeFileAtomic } from './atomic-write.mjs';

const CONTRACT_FILES = ['AGENTS.md', 'CLAUDE.md'];
const CLAUDE_AGENTS_IMPORT = /(^|[\s(])@AGENTS\.md(?=$|[\s),;:!?]|\.(?:$|\s))/m;
const LEGACY_MARKER = '<!-- changeledger -->';
const LEGACY_ENTRY = '.changeledger/AGENTS.md';
// Exact SHA-256 digests of every historical templates/AGENTS.md payload. A
// regular file is removed only when it is byte-identical to a contract version
// ChangeLedger actually shipped; headings or other heuristics are not enough.
const LEGACY_CONTRACT_HASHES = new Set([
  '92a6d22c9985dce2d15724d20e2d5c0f1178d82dc56d28e339b72c7a27574c6f',
  '4701b260d0cc39098f3b942ed2b1969f00a84e7b77a4e107070fedef0fda7d0d',
  '30b3ce1768655ebee2be2b88328ba860293d8bbbe55e12a5aacc8177d7d02c9b',
  'd36d17f99505f2b47a7ceea8f078618f652807463d5d60a83ca95f940d5a9c35',
  '1175cc4bcc884d792cdde2338b3c72b336bcb66b47555d6e5938d756acdea635',
  'f605adad9192286bc2cda45aebb5a12dab5b3c199924789398684b79b55811',
  '05e06c8e9dc45ac41ff38b47075b22492c30f3f1a7019371293be10351aada77',
  '9816e4d14f70dad268f9b89ad49094665997bf62f0b773a05fe8eed17eebc9de',
  '1b5439055e52a1bb72f72b99cbd2842b2118776fb80e262175d584a335e07e5f',
  '6fe7a03f699ffa875c1ef4bc2d59b451058d6ab4c3c8824cc220ae031d068480',
  'd56ec9ef5c1bd71464d9d9bc2a772c42cce103f336ebba61106855c8011bca6f',
  '071ed83e79589ec0362e4e99ee80cb4f7a839f2a810cf59dbf056c46e342a09c',
  '1148a1b69ce035a695c64f0df1aaaedcbeeed669b5b774c52f7b136e9f5fe4f9',
  '25d4508b0b60aa939e81d1e83383f90e7a41feacb6cb2f12fab6548cebb77ca1',
  '37e1ffe059c0d26b07566597607c41d42df3e9548830d42413dd8d2afd62aa86',
  '60519091c785977299725e4f2f3207b83828bfc56d94a989adf13bd0fc9bb174',
  '6e201bb60337c9b0869c6c769272c82abc466330f82c662bb023a74ad0b8fa92',
  '80e2560e01cfae87455177b54f77845b657764338d3bf3507119e3e1ff289bcd',
  '7a126595a0b5de0b58eec9db38ee6d1654caf0b42df29d181692c382abe213c6',
  '2e839be3ad9458feebcfd8ca979f9173b1f63b514939903ea8f9f03517528f88',
  'f10407e809fc679d11e442d57c92a4b82d0647f06946bb42c7daccedf76873ec',
  '99a42380f3835e1f706b986b86e58e33f12d68de4a69d94eb50845e790e05f71',
]);

// Bootstrap block format version. Independent of the package version: bump
// only when the delimited block's shape or required content changes in a way
// that must be detected and re-registered in consuming repos.
export const BOOTSTRAP_VERSION = 3;

const BEGIN_ALL_RE = /<!-- CHANGELEDGER BOOTSTRAP BEGIN v(\d+) -->/g;
const END_MARKER = '<!-- CHANGELEDGER BOOTSTRAP END -->';
const beginMarker = (version) => `<!-- CHANGELEDGER BOOTSTRAP BEGIN v${version} -->`;

export const REFERENCE = `> [!IMPORTANT]
> Attempt to run **ChangeLedger** with \`changeledger context\` immediately after
> reading this file — before planning, investigating, or acting. If it succeeds,
> retain complete stdout through the \`CHANGELEDGER CONTEXT END\` line and follow that
> complete context: no pipes, filters, summaries, previews or voluntary output limits.
> If the tool exposes an output budget, reserve enough for the whole response. A
> missing END means the output was truncated: stop and re-run with a larger capture.
>
> If the command is unavailable, continue normally without ChangeLedger. If it
> starts but fails, report the error to the human and wait for them to decide how
> to continue; do not treat a failing command as absent.
>
> After a compaction, verify a retained capture with \`changeledger context
> [mode] --have <rev>\` (the BEGIN line's \`rev:\`). If the context or its revision was lost,
> load it completely again; a mismatch still returns the complete output.
`;

function bootstrapBlock(version = BOOTSTRAP_VERSION) {
  return `${beginMarker(version)}\n${REFERENCE}${END_MARKER}\n`;
}

export const contractLink = (changeledgerDir) => path.join(changeledgerDir, 'AGENTS.md');
export const rootContract = (repoRoot) => path.join(repoRoot, 'AGENTS.md');

function isPlainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function insertBlock(text) {
  const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  const gap = text.length === 0 ? '' : '\n';
  return `${text}${sep}${gap}${bootstrapBlock()}`;
}

// Migrate the legacy `<!-- changeledger -->` marker and its contiguous
// blockquote to the delimited format.
function migrateLegacy(text, start) {
  const tail = text.slice(start).split('\n');
  let consumed = 1;
  while (consumed < tail.length && tail[consumed].startsWith('>')) consumed += 1;
  const before = text.slice(0, start);
  const after = tail.slice(consumed).join('\n').replace(/^\n+/, '');
  return `${before}${bootstrapBlock()}${after ? `\n${after}` : ''}`;
}

const REFERENCE_TOKEN_TYPES = new Set([
  'blockquote',
  'paragraph',
  'space',
  'text',
  'strong',
  'codespan',
]);

function projectToken(token) {
  if (!REFERENCE_TOKEN_TYPES.has(token.type)) return null;
  const projected = { type: token.type };
  if (Array.isArray(token.tokens)) {
    projected.tokens = projectTokens(token.tokens);
    if (projected.tokens === null) return null;
  } else if (typeof token.text === 'string') {
    projected.text = token.type === 'text' ? token.text.replace(/\r?\n/g, ' ') : token.text;
  }
  return projected;
}

function projectTokens(tokens) {
  const projected = tokens.map(projectToken);
  return projected.includes(null) ? null : projected;
}

function projectReference(reference) {
  const tokens = marked.lexer(reference).filter((token) => token.type !== 'space');
  if (tokens.length !== 1 || tokens[0].type !== 'blockquote') return null;
  return projectToken(tokens[0]);
}

function hasEquivalentReference(text, beginIndex, endIndex, version) {
  if (version !== BOOTSTRAP_VERSION) return false;
  const contentStart = beginIndex + beginMarker(version).length;
  if (text[contentStart] !== '\n') return false;
  if (text[endIndex + END_MARKER.length] !== '\n') return false;
  const actual = projectReference(text.slice(contentStart + 1, endIndex));
  const expected = projectReference(REFERENCE);
  return actual !== null && JSON.stringify(actual) === JSON.stringify(expected);
}

function malformedBootstrap(message) {
  throw new Error(`Malformed ChangeLedger bootstrap: ${message}`);
}

// Replace only the interior of an existing BEGIN/END block, preserving
// everything outside the delimiters byte-for-byte.
function replaceDelimited(text, beginIndex, version) {
  const endIndex = text.indexOf(END_MARKER, beginIndex);
  if (endIndex === -1) {
    malformedBootstrap('found a BEGIN marker without a matching END marker');
  }
  const beginEnd = beginIndex + beginMarker(version).length;
  if (beginIndex > 0 && text[beginIndex - 1] !== '\n')
    malformedBootstrap('BEGIN marker must occupy its own line');
  if (text[beginEnd] !== '\n') malformedBootstrap('BEGIN marker must occupy its own line');
  if (text[endIndex - 1] !== '\n') malformedBootstrap('END marker must occupy its own line');
  if (text[endIndex + END_MARKER.length] !== '\n')
    malformedBootstrap('END marker must occupy its own line');
  const before = text.slice(0, beginIndex);
  const after = text.slice(endIndex + END_MARKER.length).replace(/^\n/, '');
  const newText = `${before}${bootstrapBlock()}${after}`;
  const status =
    version < BOOTSTRAP_VERSION
      ? 'updated'
      : newText === text
        ? 'unchanged'
        : hasEquivalentReference(text, beginIndex, endIndex, version)
          ? 'equivalent'
          : 'replaced';
  return { text: newText, status, fromVersion: version };
}

// Compute the delimited bootstrap block for `text`, inserting it, replacing
// it, or migrating the legacy marker as needed.
export function applyBootstrap(text) {
  const beginMatches = [...text.matchAll(BEGIN_ALL_RE)];
  const endCount = text.split(END_MARKER).length - 1;
  if (beginMatches.length > 1 || endCount > 1) {
    malformedBootstrap('expected exactly one BEGIN marker and one END marker');
  }
  const beginMatch = beginMatches[0];
  if (beginMatch) {
    if (endCount !== 1) malformedBootstrap('found a BEGIN marker without a matching END marker');
    return replaceDelimited(text, beginMatch.index, Number(beginMatch[1]));
  }
  if (endCount !== 0) malformedBootstrap('found an END marker without a matching BEGIN marker');
  const legacyIndex = text.indexOf(LEGACY_MARKER);
  if (legacyIndex !== -1) {
    return { text: migrateLegacy(text, legacyIndex), status: 'migrated' };
  }
  return { text: insertBlock(text), status: 'inserted' };
}

function delegatesToCanonicalAgents(name, text, bootstrapStatus) {
  return name === 'CLAUDE.md' && bootstrapStatus === 'inserted' && CLAUDE_AGENTS_IMPORT.test(text);
}

// Add, replace, or migrate the managed bootstrap block in project-owned agent
// files. Returns the files touched with the transition applied to each.
export function ensureReference(repoRoot) {
  const touched = [];
  for (const name of CONTRACT_FILES) {
    const file = path.join(repoRoot, name);
    if (!isPlainFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const { text: updated, status, fromVersion } = applyBootstrap(text);
    if (delegatesToCanonicalAgents(name, text, status)) continue;
    if (status === 'unchanged' || status === 'equivalent') continue;
    writeFileAtomic(file, updated);
    touched.push({ name, status, fromVersion });
  }
  return touched;
}

// Remove only artifacts known to be managed by legacy ChangeLedger versions.
// Unknown regular files fail closed instead of being deleted.
export function removeLegacyContract(changeledgerDir, knownHashes = LEGACY_CONTRACT_HASHES) {
  const file = contractLink(changeledgerDir);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(file);
    return true;
  }
  if (stat.isFile()) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (knownHashes.has(digest)) {
      fs.unlinkSync(file);
      return true;
    }
  }
  throw new Error(
    '`.changeledger/AGENTS.md` is not a recognized legacy ChangeLedger contract; move or remove it manually, then run `changeledger register` again',
  );
}

export function removeLegacyGitignore(repoRoot) {
  const file = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const kept = lines.filter((line) => line !== LEGACY_ENTRY);
  if (kept.length === lines.length) return false;
  writeFileAtomic(file, kept.join('\n'));
  return true;
}

export function checkContract(repoRoot) {
  const errors = [];
  const root = rootContract(repoRoot);
  if (!fs.existsSync(root)) {
    errors.push('missing AGENTS.md at the repo root (ChangeLedger contract reference lives here)');
  }
  for (const name of CONTRACT_FILES) {
    const file = path.join(repoRoot, name);
    if (!isPlainFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const { status } = applyBootstrap(text);
    if (delegatesToCanonicalAgents(name, text, status)) continue;
    if (status === 'inserted') {
      errors.push(`${name} has no ChangeLedger reference — run \`changeledger register\``);
    } else if (status !== 'unchanged' && status !== 'equivalent') {
      errors.push(`${name} has an outdated ChangeLedger reference — run \`changeledger register\``);
    }
  }
  return errors;
}
