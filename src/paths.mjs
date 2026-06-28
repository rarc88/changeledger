import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const templatesDir = path.join(packageRoot, 'templates');
export const contractTemplatesDir = path.join(templatesDir, 'contract');
export const publicDir = path.join(packageRoot, 'src', 'viewer', 'public');

// ISO 8601 UTC at second precision, matching the change `created`/task convention.
export function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
