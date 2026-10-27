/**
 * Card widths for bar, bartable and funnel: every fixture with at most six rows
 * keeps the card-floor contract and draws at 400 and 320 px.
 */
import { describe, expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { measure } from '../src/index';
import { cardFloorProblems, type CardRequest } from './helpers/cardFloor';

const request = (type: string, item: any): CardRequest => ({ type, data: item.data, options: item.options, annotations: item.annotations });
const rows = (item: any): number => item.data.categories?.length ?? Infinity;

describe('card-floor contract, bar, bartable and funnel fixtures with at most six rows', () => {
  for (const type of ['bar', 'bartable', 'funnel']) {
    for (const item of getFixtures(type).filter((fixture: any) => rows(fixture) <= 6)) {
      it(`${type}/${item.id}`, () => {
        expect(cardFloorProblems(request(type, item))).toEqual([]);
        for (const width of [400, 320]) {
          const result = measure({ ...request(type, item), options: { ...item.options, size: { width } } } as never) as any;
          expect(result.geometry ? 'drawn' : result.refused?.warnings[0]?.message, `${width} px`).toBe('drawn');
        }
      });
    }
  }
});
