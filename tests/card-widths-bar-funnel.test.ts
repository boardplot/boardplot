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

// A German column head is one long word. Without a break point it raised the funnel's minimum width
// (312 px against 282 px) and the funnel refused a width where English draws.
describe('funnel in German draws wherever English draws', () => {
  for (const item of getFixtures('funnel').filter((fixture: any) => rows(fixture) <= 6)) {
    it(`funnel/${item.id}`, () => {
      for (const width of [300, 290]) {
        const drawn = (language: string) => !!(measure({ ...request('funnel', item), options: { ...item.options, locale: { language }, size: { width } } } as never) as any).geometry;
        expect(drawn('de'), `${width} px`).toBe(drawn('en'));
      }
    });
  }
});
