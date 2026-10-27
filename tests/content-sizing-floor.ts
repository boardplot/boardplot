import { expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getChart, listCharts } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { measure } from '../src/core/request';

/**
 * Every example fixture renders at its measured floor, in both modes. A
 * golden re-baseline cannot catch a floor that layout refuses, and the
 * failures are fixture-specific, so the census stays per fixture. It runs at the natural
 * width in the default theme only: the 480 and 960 px widths and the
 * notation pass made it 4x longer than the CI test job allows. The cases are dealt
 * round-robin over several files so one worker does not hold them all.
 */
export function floorCases(part: number, parts: number): void {
  const cases = listCharts().flatMap(({ type }) => ['full', 'compact'].flatMap(mode =>
    getFixtures(type).filter(f => f.kind === 'example').map(fixture => ({ type, mode, fixture }))));
  for (const { type, mode, fixture } of cases.filter((_, index) => index % parts === part - 1))
    it(`renders ${type}/${fixture.id} at its measured floor: ${mode}`, async () => {
      // Let worker reports flush between the expensive map/diagram layouts.
      await new Promise<void>(resolve => setImmediate(resolve));
      const options = { ...fixture.options, annotations: fixture.annotations, mode };
      const m = measure({ type, data: fixture.data, options });
      const size = { width: m.minWidth, height: m.minHeight };
      const result = getChart(type)!.layout(fixture.data, { ...options, size });
      // A refusal for any reason means nothing drew at the floor.
      expect(result.refused ? result.warnings.map(w => w.code) : 'drawn', `${type}/${fixture.id} at ${JSON.stringify(size)}`).toBe('drawn');
      expect(result.warnings.filter(w => (w.code === 'size-below-floor' || w.code === 'diagram-size-too-small')),
        `${type}/${fixture.id} at ${JSON.stringify(size)}`).toEqual([]);
    }, 60_000);
}
