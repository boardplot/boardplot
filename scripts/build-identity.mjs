import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Hash build inputs, including local edits, so two rendering builds cannot share a version. */
export function distributionIdentity(root = ROOT) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const apiVersion = pkg.version;
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  if (lock.version !== apiVersion || lock.packages[''].version !== apiVersion) {
    throw new Error('package.json and package-lock.json versions differ.');
  }
  const engineRev = Number(readFileSync(resolve(root, 'src/core/engine.ts'), 'utf8').match(/ENGINE_REV = (\d+)/)[1]);
  let git;
  try {
    git = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    console.error('boardplot build: the build records the git commit, so run it inside a git checkout.');
    process.exit(1);
  }
  const hash = createHash('sha256');
  function add(path) {
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) add(child);
      else if (entry.isFile()) hash.update(relative(root, child)).update('\0').update(readFileSync(child)).update('\0');
      else throw new Error(`Build input must be a regular file or directory: ${child}`);
    }
  }
  for (const directory of ['src', 'scripts']) add(resolve(root, directory));
  for (const file of ['package.json', 'package-lock.json', 'tsup.config.ts', 'tsconfig.json', 'tsconfig.build.json']) {
    const content = readFileSync(resolve(root, file));
    hash.update(file).update('\0').update(content).update('\0');
  }
  const source = hash.digest('hex').slice(0, 16);
  return { version: `${apiVersion}-engine.${engineRev}.git.g${git}.src.h${source}`, engineRev, git, source };
}
