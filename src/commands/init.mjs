import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../atomic-write.mjs';
import { ensureReference, rootContract } from '../contract.mjs';
import { VERSION } from '../framing.mjs';
import { templatesDir } from '../paths.mjs';
import { register } from '../registry.mjs';
import { serializeScalar } from '../yaml.mjs';

const MIN_CLI_VERSION_PLACEHOLDER = /^min_cli_version:$/m;

// Sets up `.changeledger/`, installs the context bootstrap in the project-owned
// AGENTS.md, and registers the repo in the global registry.
// `runningVersion` is the CLI version written to `min_cli_version`: an
// explicit parameter (unit tests can inject one) that defaults to the actual
// installed version, never an environment override.
export function init(cwd = process.cwd(), runningVersion = VERSION) {
  const repoRoot = path.resolve(cwd);
  const changeledgerDir = path.join(repoRoot, '.changeledger');
  if (fs.existsSync(changeledgerDir)) {
    throw new Error(
      '.changeledger/ already exists. Use `changeledger register` to refresh this repo.',
    );
  }
  // The root AGENTS.md is the project's own contract; we reference the tool's
  // contract from it but never create it ourselves. Fail before touching .changeledger/.
  if (!fs.existsSync(rootContract(repoRoot))) {
    throw new Error('Create AGENTS.md at the repo root first, then re-run `changeledger init`.');
  }

  fs.mkdirSync(path.join(changeledgerDir, 'changes'), { recursive: true });
  const configFile = path.join(changeledgerDir, 'config.yml');

  const template = fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8');
  if (!MIN_CLI_VERSION_PLACEHOLDER.test(template)) {
    throw new Error('templates/config.yml must declare a blank "min_cli_version:" placeholder');
  }
  const withVersion = template.replace(
    MIN_CLI_VERSION_PLACEHOLDER,
    `min_cli_version: ${runningVersion}`,
  );

  const id = crypto.randomBytes(5).toString('hex');
  const name = path.basename(repoRoot);
  writeFileAtomic(
    configFile,
    `${withVersion}\n# Project identity (stable; the global registry maps it to a path)\nproject_id: "${id}"\nproject_name: ${serializeScalar(name)}\n`,
  );

  ensureReference(repoRoot);

  register({ id, name, path: repoRoot });
  return changeledgerDir;
}
