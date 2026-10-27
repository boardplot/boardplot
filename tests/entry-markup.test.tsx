// @vitest-environment jsdom
/**
 * the static markup each `boardplot/react/<type>` entry draws.
 *
 * Modules can move out of the per-type entries' initial
 * load and behind a dynamic import. Bytes may move; pixels may not. This
 * mounts the demo fixture of every registered type through the type's OWN
 * entry, waits for every chunk the component asks for, and compares the
 * resulting markup with the recorded hash.
 *
 * Recorded as hashes for the same reason the golden SVG set is: identical
 * input owes identical output, and a hash per entry is the whole net.
 *
 * npx vitest run tests/entry-markup.test.tsx compare
 * MARKUP_UPDATE=1 npx vitest run tests/entry-markup.test.tsx re-record
 * MARKUP_WRITE_DIR=/tmp/after npx vitest run … dump markup
 */
import { act, type ReactElement } from 'react';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { chartLoaders } from '../src/react/chartLoaders';
import { maskEngineStamp, stampFreeSha } from './golden/stamp';
import '../src/core/geo/packs';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MANIFEST = join(__dirname, 'fixtures', 'react-entry-markup.json');
// Above every registered type's size floor, so no entry records a refusal box.
const SIZE = { width: 960, height: 640 };
const TYPES = Object.keys(chartLoaders).sort();

function readManifest(): Record<string, string> {
  if (!existsSync(MANIFEST)) return {};
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
}

/** The component an entry publishes: the one built from a chart type, else its table renderer. */
function componentOf(module: Record<string, unknown>, type: string): (props: Record<string, unknown>) => ReactElement {
  for (const value of Object.values(module)) {
    if (typeof value === 'function' && (value as { chartType?: string }).chartType === type) {
      return value as (props: Record<string, unknown>) => ReactElement;
    }
  }
  const table = module.TableChart;
  if (typeof table === 'function') return table as (props: Record<string, unknown>) => ReactElement;
  throw new Error(`the ${type} entry publishes no component`);
}

/** Mount, let every pending chunk land, and read the markup back. */
async function mount(element: ReactElement): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  await act(async () => { root = createRoot(host); root.render(element); });
  // A deferred core module is a real module load; under vitest that is a
  // transform, not a microtask, so this waits on the clock.
  const deadline = Date.now() + 20_000;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  }
  // React's useId counts mounts within a document, so two mounts of the same
  // chart differ in that one token and nowhere else.
  const markup = host.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_id_');
  await act(async () => { root!.unmount(); });
  host.remove();
  return markup;
}

async function markupOf(type: string): Promise<string> {
  const fixture = getFixtures(type).find(candidate => candidate.tags.includes('demo')) ?? getFixtures(type)[0]!;
  const module = await chartLoaders[type]!() as Record<string, unknown>;
  const Chart = componentOf(module, type);
  return mount(<Chart
    {...structuredClone(fixture.options ?? {}) as Record<string, unknown>}
    data={structuredClone(fixture.data)}
    annotations={fixture.annotations ? structuredClone(fixture.annotations) : undefined}
    size={SIZE}
  />);
}

describe('per-type React entries draw the recorded markup', { timeout: 120_000 }, () => {
  it('every entry matches, and none is left on the busy placeholder', async () => {
    const recorded = readManifest();
    const writeDirectory = process.env.MARKUP_WRITE_DIR;
    if (writeDirectory) mkdirSync(writeDirectory, { recursive: true });
    const fresh: Record<string, string> = {};
    const changed: string[] = [];

    for (const type of TYPES) {
      const markup = await markupOf(type);
      expect(markup, `${type} is still on the busy placeholder`).not.toContain('data-bp-loading');
      expect(markup.length, `${type} drew nothing`).toBeGreaterThan(200);
      if (writeDirectory) writeFileSync(join(writeDirectory, `${type}.html`), markup);
      fresh[type] = `${stampFreeSha(markup)}:${maskEngineStamp(markup).length}`;
      if (recorded[type] !== undefined && recorded[type] !== fresh[type]) changed.push(type);
    }

    if (process.env.MARKUP_UPDATE === '1') {
      writeFileSync(MANIFEST, `${JSON.stringify(fresh, null, 2)}\n`);
      return;
    }
    expect(Object.keys(recorded).length, 'no recorded markup; run with MARKUP_UPDATE=1').toBe(TYPES.length);
    expect(changed, `the markup of these entries changed: ${changed.join(', ')}`).toEqual([]);
    expect(fresh).toEqual(recorded);
  });
});
