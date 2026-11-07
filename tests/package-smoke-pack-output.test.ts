import { expect, it } from 'vitest';
// @ts-expect-error The smoke script has no declaration file.
import { packOutput } from '../scripts/package-smoke.mjs';

const pack = { filename: 'boardplot-1.0.0.tgz', files: [{ path: 'package.json' }] };
const log = 'CLI Building entry\nESM Build start\n';

// npm 12 prints an object where npm 11 prints an array, and that difference stopped the local install.
it('reads the npm pack result of npm 11 and npm 12 after a build log', () => {
  expect(packOutput(`${log}${JSON.stringify([pack], null, 2)}\n`)).toEqual([pack]);
  expect(packOutput(`${log}${JSON.stringify({ boardplot: pack }, null, 2)}\n`)).toEqual([pack]);
});
