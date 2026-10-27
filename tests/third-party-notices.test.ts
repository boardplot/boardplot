import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error The build helper is JavaScript without a declaration file.
import { bundledPackageNotices } from '../scripts/third-party-notices.mjs';

// A newly compiled dependency must carry its own licence and notices without a hand-maintained package list.
it('gets the shipped dependencies from the build and refuses missing licence text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'boardplot-notices-'));
  const dependency = join(root, 'node_modules/@example/new-package');
  mkdirSync(dependency, { recursive: true });
  try {
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: '@example/new-package', version: '1.2.3', license: 'MIT', main: 'index.js' }));
    writeFileSync(join(dependency, 'index.js'), 'export const answer = 42;\n');
    writeFileSync(join(root, 'index.js'), "export { answer } from '@example/new-package';\n");
    const result = await build({ absWorkingDir: root, entryPoints: ['index.js'], bundle: true, write: false, metafile: true });
    expect(() => bundledPackageNotices(root, result.metafile)).toThrow('@example/new-package@1.2.3 has no licence text');
    writeFileSync(join(dependency, 'LICENSE'), 'Copyright Example\nPermission to copy.\n');
    writeFileSync(join(dependency, 'NOTICE.txt'), 'Additional attribution.\n');
    const notices = bundledPackageNotices(root, result.metafile);
    expect(notices).toContain('## @example/new-package 1.2.3 (MIT)');
    expect(notices).toContain(readFileSync(join(dependency, 'LICENSE'), 'utf8').trimEnd());
    expect(notices).toContain('Additional attribution.');
    const external = await build({ absWorkingDir: root, entryPoints: ['index.js'], bundle: true, write: false, metafile: true, external: ['@example/new-package'] });
    expect(bundledPackageNotices(root, external.metafile)).toBe('');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
