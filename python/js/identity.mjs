/**
 * The build identity of the Python package's assets: the npm distribution
 * identity (API version, engine revision, commit, source hash of src/ and
 * scripts/), the frontend protocol of the widget and Streamlit messages, and
 * a hash of the sources under python/js/. engine.js, the browser bundles and
 * _assets/build.json carry the same object; Python and the browser loader
 * refuse a mismatch.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionIdentity } from '../../scripts/build-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/** The widget and Streamlit message contract; raise it when the browser contract changes. */
export const FRONTEND_PROTOCOL = 1;

/** Folders under python/js/ that hold installed or generated files, never sources. */
const SKIPPED = new Set(['node_modules', 'dist', '.cache']);

/** sha256 (first 16 hex) over every source file under python/js/, by sorted relative path. */
export function pythonSourcesHash() {
  const hash = createHash('sha256');
  const add = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) add(path);
      } else if (entry.isFile() && !entry.name.endsWith('.tsbuildinfo')) {
        hash.update(relative(root, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0');
      }
    }
  };
  add(here);
  return hash.digest('hex').slice(0, 16);
}

export function buildIdentity() {
  return { ...distributionIdentity(root), frontendProtocol: FRONTEND_PROTOCOL, pythonSources: pythonSourcesHash() };
}
