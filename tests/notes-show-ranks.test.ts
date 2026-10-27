import { describe, expect, it } from 'vitest';
import { render } from '../src/cli/render';
import { fixtures } from '../src/cli/fixtures';
import { getFixtures } from '../src/fixtures';
import { getChart } from '../src/core/registry';
import { printsNote } from '../src/core/notes';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { INTERACTIVE_LAYOUT } from '../src/core/footer';
import { labelOmissions } from '../src/core/label/omissions';
import { resolveTheme } from '../src/core/theme';

const spec = (id: string) => (fixtures({ type: 'combo', id, kind: 'all' }, Infinity).body as { fixtures: { spec: object }[] }).fixtures[0]!.spec;
const notes = (s: object) => (render({ spec: s, return: ['svg'] }).body as { notes: { text: string; inFrame: boolean }[] }).notes;

describe("notes.show 'ranks'", () => {
  // Prevents another chart's disclosure text from changing SVG note kinds or removing an earlier chart's React rank key.
  it('keeps note kinds and rank metadata across charts with the same text', () => {
    const tornado = getFixtures('bar').find(f => f.id === 'dcf-npv-sensitivity')!;
    const shared = 'Invented shared note.';
    const methodOptions = { ...tornado.options, methodNote: true, strings: { sensitivityNote: shared },
      notes: { show: ['method'] as const }, size: { width: 800 } };
    const methodSvg = () => renderSvg(requireGeometry(getChart('bar')!.layout(tornado.data, methodOptions)), resolveTheme(methodOptions.theme));
    const before = methodSvg();
    const otherChart = (text: string) => requireGeometry(getChart('bar')!.layout({ categories: ['Sample'], series: [
      { id: 's', values: [{ number: 15, range: { low: 10, mid: 15, high: 20 } }] },
    ] }, { variant: 'football-field', methodNote: true, strings: { rangeMidNote: text }, size: { width: 800 } }));
    otherChart(shared);
    expect(methodSvg()).toBe(before);

    const fixture = getFixtures('combo').find(f => f.id === 'ranked-campaigns-rank-key-only')!;
    const draw = () => requireGeometry(getChart('combo')!.layout(fixture.data, fixture.options));
    const first = draw();
    const key = first.frame.noteList!.find(note => note.text.startsWith('Columns by rank'))!;
    const svg = renderSvg(first, resolveTheme(fixture.options?.theme));
    expect(printsNote(key, ['ranks'])).toBe(true);
    const other = otherChart(key.text);
    expect(other.frame.noteList!.some(note => note.text === key.text)).toBe(true);
    expect(printsNote(key, ['ranks'])).toBe(true);
    expect(renderSvg(first, resolveTheme(fixture.options?.theme))).toBe(svg);
    expect(renderSvg(draw(), resolveTheme(fixture.options?.theme))).toBe(svg);
  });
  // Prevents a tilemap's list-only fallback notes from dropping the tile values they name.
  it('keeps the values a tilemap fallback note names', () => {
    const f = getFixtures('tilemap').find(f => f.id === 'eu27-equal-tiles')!;
    const geo = requireGeometry(getChart('tilemap')!.layout(f.data, { ...f.options, size: { width: 320, height: 400 }, [INTERACTIVE_LAYOUT]: true }));
    expect(labelOmissions(geo)).toHaveLength(26);
  });
  // A host that keeps engine notes out of its cards still needs the rank key, or
  // columns 1 to 16 name nothing; it must not get "Not labelled on the chart" with it.
  it('prints the rank key and no other disclosure', () => {
    const drawn = notes(spec('ranked-campaigns-rank-key-only'));
    expect(drawn.filter((note) => note.inFrame && note.text.startsWith('Columns by rank')).length).toBeGreaterThan(0);
    expect(drawn.find((note) => note.text.startsWith('Not labelled on the chart'))?.inFrame).toBe(false);
  });

  // A static footer rebuilt for authored notes past the line budget dropped the rank
  // key, so the SVG showed ranks 1 to 16 with no key.
  it('keeps the rank key in a static footer rebuilt for long authored notes', () => {
    const base = spec('ranked-campaigns-rank-key-only') as { options: object };
    const footnotes = [1, 2, 3, 4].map((n) => `Authored note ${n}, long enough to take a whole line of the footer at this width and wrap.`);
    const svg = (render({ spec: { ...base, options: { ...base.options, footnotes } }, return: ['svg'] }).body as { svg: string }).svg;
    expect(svg.split('Columns by rank').length - 1).toBe(1);
    expect(svg).toContain('16.\u00a0Affiliate');
    expect(svg).not.toContain('Not labelled on the chart');
  });
});
