import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry, SIZE_TOLERANCE } from '../src/core/sizing';
import { hiddenNoteLine, noteLine, withHiddenLabelNote } from '../src/core/frame';
import { noteTexts } from './helpers/notes';
import { render } from '../src/cli/render';
import { fixtures } from '../src/cli/fixtures';
import { cachedCategoryRowPlans } from '../src/core/label/categoryRow';
import type { ChartReading } from '../src/core/reading';
import type { LintWarning } from '../src/core/types/scene';

// The "Not labelled on the chart" note rules (invented data).
const days = Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, label: `09/${String(i + 1).padStart(2, '0')}` }));
const twoLines = (annotations: unknown[]) => resolveChartRequest({
  type: 'line', target: 'slide',
  data: { categories: days, series: [
    { id: 'a', label: 'Series A', values: [1000, 1080, 1115, 1098, 1075, 1092, 1163, 1249, 1299, 1295, 1267, 1270, 1328, 1415] },
    { id: 'b', label: 'Series B', values: [1020, 1016, 977, 965, 1016, 1110, 1163, 1199, 1164, 1138, 1171, 1258, 1345, 1378] },
  ] },
  options: { title: 'Orders', valueLabels: 'all', seriesLabels: 'key', size: { width: 960 } },
  annotations,
} as never);

describe('note rules', () => {
  // Counted values must not claim to be printed in a note or expose scene ids as their location.
  it('distinguishes a counted value from a value listed in a printed note', () => {
    const data = { categories: days, series: [{ id: 's', label: 'Sample series', values: days.map((_, i) => 100 + i) }] };
    const request = resolveChartRequest({ type: 'line', data,
      options: { valueLabels: 'all', size: { width: 320, height: 300 }, notes: { maxListed: 0 } } } as never);
    const geo = requireGeometry(layoutResolvedRequest(request));
    expect(geo.labels.some(label => label.noteCounted)).toBe(true);
    expect(geo.labels.filter(label => label.noteCounted).every(label => label.noteLocation === 'Not shown on the chart; counted in the notes list')).toBe(true);
    expect(geo.warnings.find(warning => warning.code === 'values-in-note')?.message).toContain('Notes can list or count these values');
    expect(geo.warnings.find(warning => warning.code === 'values-in-note')?.message).not.toContain('are in the note');
  });

  // A narrow sparkline can cut a value outside the solver; every surface must retain its full text.
  it('keeps cut scene text in omissions and notes, and measures an enabled disclosure', () => {
    const data = { columns: [
      { id: 'label', kind: 'rowLabel', label: 'Item' },
      { id: 'a', kind: 'value', label: 'First', format: '1.1' },
      { id: 'b', kind: 'value', label: 'Last', format: '1.1' },
      { id: 'trend', kind: 'encoding', label: 'Trend', width: 40, encoding: { type: 'sparkline', sourceColumns: ['a', 'b'] } },
    ], rows: [{ id: 'sample', label: 'Sample row', cells: { a: 100, b: 112 } }] };
    const draw = (notes: object = {}, extra: object = {}) => (render({ spec: { type: 'table', data,
      options: { size: { width: 640 }, notes, ...extra } }, return: ['svg', 'reading'] }).body as {
        ok: boolean; svg: string; notes: { text: string; short?: string; inFrame: boolean }[]; reading: ChartReading; warnings: LintWarning[];
      });
    const hidden = draw();
    expect(hidden.ok).toBe(true);
    expect(hidden.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'sparkLast:sample:trend', text: '112.0', reason: 'truncated' }));
    expect(hidden.notes.find(note => note.text.includes('Sample row — Trend: 112.0'))?.inFrame).toBe(false);
    expect(hidden.warnings.filter(warning => warning.code === 'label-truncated')).toHaveLength(1);
    // A repeated number in an unrelated author note does not identify the cut value.
    const repeated = draw({}, { footnotes: ['112.0 observations'] });
    expect(repeated.notes.some(note => note.text.includes('Sample row — Trend: 112.0'))).toBe(true);
    const shown = draw({ show: ['disclosure'], maxListed: 'all' });
    expect(shown.notes.find(note => note.text.includes('Sample row — Trend: 112.0'))?.inFrame).toBe(true);
    expect(shown.svg).toContain('Sample row — Trend: 112.0');
    const counted = draw({ show: ['disclosure'], maxListed: 0 });
    expect(counted.notes.find(note => note.text.includes('112.0'))?.short).not.toContain('112.0');
    expect(counted.notes.find(note => note.text.includes('112.0'))?.text).toContain('112.0');
    const pinned = draw({}, { size: { width: 640, height: 260 }, footnotes: false });
    expect(pinned.reading.size.height).toBe(260);
    expect(pinned.notes.find(note => note.text.includes('112.0'))?.inFrame).toBe(false);
    // A panel's disclosure must not raise the height its slot needs and refuse the pinned grid around it.
    const enabled = { show: ['disclosure'], maxListed: 'all' };
    const grid = render({ spec: { type: 'grid', data: { panels: [{ id: 'panel', type: 'table', data, options: { notes: enabled } }] },
      options: { sharedScale: false, size: { width: 800, height: 121 }, notes: enabled } } }).body as { ok: boolean; errors?: unknown[] };
    expect(grid.errors ?? []).toEqual([]);
    expect(grid.ok).toBe(true);
  });

  // An axis under a month row reads '4', so a note that took the axis label would name a day without its month.
  it('names a day by its date in the rendered note where the axis prints only the day number', () => {
    const spec = (fixtures({ type: 'combo', id: 'daily-columns-rate-reference', kind: 'all' }, Infinity).body as { fixtures: { spec: object }[] }).fixtures[0]!.spec;
    const notes = (render({ spec, return: ['svg'] }).body as { notes: { text: string }[] }).notes.map((note) => note.text).join(' ');
    expect(notes).toContain('Daily count 1,069 (4 Sep)');
    expect(notes).not.toMatch(/\(\d+\)/);
  });

  // No other test checks the note cap.
  it('names the first 8 items, a lone ninth too, then "and N more"; maxListed 0 only counts', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(noteLine('Lead', [...items, 'i'], {})).toEqual(['Lead: a, b, c, d, e, f, g, h, i.']);
    expect(noteLine('Lead', [...items, 'i', 'j'], {}, 20)).toEqual(['Lead: a, b, c, d, e, f, g, h, and 2 more.']);
    expect(noteLine('Lead', [...items, 'i'], { notes: { maxListed: 0 } }, 20)).toEqual(['Lead: 9 of 20 values.']);
    expect(noteLine('Lead', ['a', 'b'], { notes: { maxListed: 0 } })).toEqual(['Lead: 2 items.']);
  });

  // A heatmap callout on a printed cell lost its ${value} and the words before it with no word to the author.
  it('says so when a callout leaves ${value} to the mark that prints it', () => {
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'heatmap', data: { categories: ['a', 'b'], series: [{ id: 's', label: 'S', values: [1.5, -2.8] }] },
      options: { size: { width: 480 } }, annotations: [{ kind: 'callout', id: 'c1', at: { categoryId: 'b', seriesId: 's' }, text: 'Low in B: ${value}' }] } as never)));
    expect(geo.labels.find((label) => label.id === 'annotation:c1')?.text).toBe('b: Low in B');
    expect(geo.warnings.find((warning) => warning.code === 'annotation-value-on-mark')?.message).toContain('−2.8');
  });

  it('a callout that prints ${value} is the label of its point: the note does not name the point', () => {
    const geo = requireGeometry(layoutResolvedRequest(twoLines([{ kind: 'callout', id: 'c1', at: { categoryId: 'd0', seriesId: 'b' }, text: 'Start ${value}' }])));
    expect(geo.labels.find((label) => label.id === 'annotation:c1')?.text).toBe('Start 1,020');
    const point = geo.labels.find((label) => label.id === 'point:b:d0')!;
    // Hidden at its point, printed in the callout, not in the note.
    expect(point.hidden).toBeDefined();
    expect(point.noted).toBeUndefined();
    expect(point.printedIn).toBe('annotation:c1');
    expect(noteTexts(geo).join(' ')).not.toContain('1,020');
    // A callout without ${value} names nothing: the note keeps the point.
    const plain = requireGeometry(layoutResolvedRequest(twoLines([{ kind: 'callout', id: 'c1', at: { categoryId: 'd0', seriesId: 'b' }, text: 'Start' }])));
    if (plain.labels.find((label) => label.id === 'point:b:d0')?.hidden) expect(noteTexts(plain).join(' ')).toContain('Series B 1,020 (09/01)');
  });

  // A callout on a stacked column's total led from the edge of a segment's value: it pointed at the wrong number.
  it('a callout on a stacked column total leads from the total, not from a segment value', () => {
    const series = (id: string, c: number) => ({ id, label: id.toUpperCase(), values: [10, 10, c, 10, 10, 10] });
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({
      type: 'column',
      data: { categories: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: id.toUpperCase() })), series: [series('s1', 900), series('s2', 100)] },
      options: { variant: 'stacked', theme: 'notation', valueLabels: 'all', size: { width: 600, height: 350 }, labelPlacements: { 'annotation:note': 'belowFar' } },
      annotations: [{ kind: 'callout', id: 'note', at: 'c', text: 'Stack total' }],
    } as never)));
    const label = (id: string) => geo.labels.find((entry) => entry.id === id)!;
    const [x, y] = label('annotation:note').leader!.d.split(/[\sA-Z]+/).filter(Boolean).map(Number) as [number, number];
    const gap = (id: string) => {
      const { rect } = label(id);
      return Math.hypot(Math.max(rect.x - x, 0, x - rect.x - rect.w), Math.max(rect.y - y, 0, y - rect.y - rect.h));
    };
    expect(gap('grandTotal:c')).toBeLessThan(gap('segment:s2:c'));
  });

  // A target label emitted before an abs leader that crosses it lay under the line, halo and all.
  it('a label that an annotation leader crosses paints after that leader', () => {
    // The goal label now keeps off the South point, so the pins put the "62" leader across it again.
    const base = (fixtures({ type: 'line', id: 'regions-ramp-target', kind: 'all' }, Infinity).body as { fixtures: { spec: { options: object } }[] }).fixtures[0]!.spec;
    const spec = { ...base, options: { ...base.options, labelPlacements: { 'target-label:target:south:d2:0': 'belowLeft', 'annotation:abs-1': 'leftFar' } } };
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest(spec as never)));
    const goal = geo.labels.find((label) => label.id === 'target-label:target:south:d2:0')!;
    const leader = geo.labels.find((label) => label.id === 'annotation:abs-1')!.leader!.d.match(/-?[\d.]+/g)!.map(Number);
    const crosses = leader.some((_, i) => i % 2 === 0 && i + 3 < leader.length && Array.from({ length: 21 }, (_, k) => [leader[i]! + (leader[i + 2]! - leader[i]!) * k / 20, leader[i + 1]! + (leader[i + 3]! - leader[i + 1]!) * k / 20])
      .some(([x, y]) => x! > goal.rect.x && x! < goal.rect.x + goal.rect.w && y! > goal.rect.y && y! < goal.rect.y + goal.rect.h));
    expect(crosses).toBe(true);
    const svg = String((render({ spec, return: ['svg'] }).body as { svg: string }).svg);
    expect(svg.indexOf('data-id="leader:annotation:abs-1"')).toBeGreaterThan(-1);
    expect(svg.indexOf('data-id="leader:annotation:abs-1"')).toBeLessThan(svg.indexOf('data-id="label:target-label:target:south:d2:0"'));
  });

  // Reason: on a 320 px card the default note names only what fits two footer lines.
  it('a default note takes at most two footer lines at 320 px', () => {
    const fixture = getFixtures('column').find((entry) => entry.id === 'dense-ninety-value-subset')!;
    const geo = requireGeometry(getChart('column')!.layout(fixture.data, { ...fixture.options, target: 'report', notes: { show: ['note', 'disclosure'] }, size: { width: 320 } } as never));
    const ids = new Set(geo.frame.footnoteNodeIds ?? []);
    const note = geo.scene.find((node) => node.t === 'text' && ids.has(node.id) && node.lines.join(' ').startsWith('Not labelled'));
    expect(note && note.t === 'text' ? note.lines.length : 0).toBe(2);
    expect(note && note.t === 'text' ? note.lines.join(' ') : '').toMatch(/, and \d+ more\.$/);
  });

  // Reason: engine notes under the chart (a six-line rank key) squeezed a 34-column combo to a 71 px plot.
  it('prints no engine note by default; a numbered day row thins instead of taking ranks and the plot keeps its floor', () => {
    const fixture = getFixtures('combo').find((entry) => entry.id === 'band-label-headroom-rising-tail')!;
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'combo', data: fixture.data, options: fixture.options, annotations: fixture.annotations } as never)));
    expect(geo.frame.footnoteNodeIds ?? []).toEqual([]);
    expect(geo.frame.noteList?.some((note) => note.kind === 'disclosure' && !note.inFrame)).toBe(true);
    expect(geo.warnings.map((warning) => warning.code)).not.toContain('labels-as-ranks');
    const names = geo.labels.filter((label) => label.kind === 'category' && !label.hidden).map((label) => label.text);
    expect(names).toEqual(expect.arrayContaining(['D0', 'D2', 'D4']));
    expect(names).not.toContain('D1');
    expect(geo.plot.h).toBeGreaterThanOrEqual(160);
  });

  it('a row of plain names keeps one name per column: it turns instead of thinning', () => {
    const cities = ['Amsterdam', 'Barcelona', 'Copenhagen', 'Dusseldorf', 'Edinburgh', 'Frankfurt', 'Gothenburg', 'Hamburg', 'Innsbruck', 'Johannesburg', 'Krakow', 'Ljubljana', 'Marseille', 'Nuremberg', 'Ostrava', 'Prague', 'Quimper'];
    const categories = [...cities, ...cities.map((city) => `${city} North`)].map((label, i) => ({ id: `c${i}`, label }));
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'column', data: { categories, series: [{ id: 's', label: 'Sales', values: categories.map((_, i) => 10 + (i * 13) % 40) }] }, options: { title: 'Sales by city', size: { width: 760, height: 340 } } } as never)));
    expect(geo.warnings.map((warning) => warning.code)).not.toContain('category-stride');
    expect(geo.warnings.map((warning) => warning.code)).not.toContain('labels-as-ranks');
    expect(geo.labels.filter((label) => label.kind === 'category' && !label.hidden)).toHaveLength(34);
  });

  it('keeps no category-row plan after a render returns', () => {
    const categories = Array.from({ length: 34 }, (_, i) => ({ id: `c${i}`, label: `Region number ${i}` }));
    requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'column', data: { categories, series: [{ id: 's', label: 'Sales', values: categories.map((_, i) => 10 + i) }] }, options: { size: { width: 760, height: 340 } } } as never)));
    expect(cachedCategoryRowPlans()).toBe(0);
  });

  it('notes the author opts into refuse with size advice before they take the plot under its floor', () => {
    const fixture = getFixtures('combo').find((entry) => entry.id === 'band-label-headroom-rising-tail')!;
    const at = (height: number) => layoutResolvedRequest(resolveChartRequest({ type: 'combo', data: fixture.data, annotations: fixture.annotations,
      options: { ...fixture.options, size: { width: 760, height }, notes: { show: ['note', 'disclosure'] } } } as never));
    const refused = at(300);
    expect(refused.refused).toBe(true);
    const fix = (refused.warnings[0]!.expected as { minimum: { height: number } }).minimum.height;
    // The named size draws compact (the `belowMinimum: 'compact'` contract), held to the floor as the engine holds it.
    expect(requireGeometry(at(fix)).plot.h + SIZE_TOLERANCE).toBeGreaterThanOrEqual(160);
  });

  it('a metric-stack state marker prints with its engine-worded note where only disclosures are shown', () => {
    const spec = (fixtures({ type: 'grid', id: 'metric-stack-steps', kind: 'all' }, Infinity).body as { fixtures: { spec: { options?: object } }[] }).fixtures[0]!.spec;
    const svg = String((render({ spec: { ...spec, options: { ...spec.options, notes: { show: ['disclosure'] } } }, return: ['svg'] }).body as { svg: string }).svg);
    const footer = [...svg.matchAll(/<text[^>]*data-part="footnote"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
    const marks = [...svg.replace(/<text[^>]*data-part="footnote"[\s\S]*?<\/text>/g, '').matchAll(/[¹²³⁴⁵⁶⁷⁸⁹]/g)].map((m) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(m[0]));
    expect(marks.length).toBeGreaterThan(0);
    for (const n of marks) expect(footer.some((line) => line.startsWith(`${n})`)), `mark ${n}`).toBe(true);
  });

  it('an authored note that repeats an engine disclosure stays a note, also after a render that made that disclosure', () => {
    const spec = (footnotes?: string[]) => ({ type: 'column', data: { categories: [{ id: 'q1', label: 'Q1', partial: true }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 'o', label: 'Orders', values: [10, 12] }, { id: 'r', label: 'Returns', values: [2, 3] }] }, options: { title: 'Orders', legend: 'none', ...(footnotes ? { footnotes } : {}) } });
    const footer = (body: unknown) => [...String((body as { svg: string }).svg).matchAll(/<text[^>]*data-part="footnote"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
    expect(footer(render({ spec: spec(), return: ['svg'] }).body)).toEqual([]);
    const authored = render({ spec: spec(['Q1 to date']), return: ['svg'] }).body as { notes: { kind: string; text: string }[] };
    expect(footer(authored)).toEqual(['Q1 to date']);
    expect(authored.notes.filter((note) => note.text === 'Q1 to date').map((note) => note.kind).sort()).toEqual(['disclosure', 'note']);
  });

  // A wide slice centred on 180° hung its label on the right while the column sizing counted it on the left.
  it('hangs a wide slice centred on 180° on the left, where the column sizing counts it', () => {
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'pie', data: { categories: [{ id: 'a', label: 'First half of the pie' }, { id: 'b', label: 'Second half of the pie' }],
      series: [{ id: 's', values: [50, 50] }] }, options: { title: 'Halves', rotate: 90, size: { width: 720, height: 400 } } } as never)));
    const x = (id: string) => geo.labels.find((label) => label.id === `outsidePie:s:${id}`)!.rect.x;
    expect(x('a')).toBeLessThan(360);
    expect(x('b')).toBeGreaterThan(360);
  });

  // A doughnut that dropped negative slices printed the sum of the rest as the total of the data.
  it('a doughnut with negative slices prints no centre total and names the dropped slices', () => {
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'pie', data: { categories: [{ id: 'a', label: 'Gain' }, { id: 'b', label: 'Loss' }, { id: 'c', label: 'Rest' }],
      series: [{ id: 's', values: [84.9, -12.3, 43.8] }] }, options: { title: 'Split', doughnut: 0.55 } } as never)));
    expect(geo.labels.some((label) => label.kind === 'total')).toBe(false);
    expect(geo.a11y.desc).not.toContain('total');
    expect(noteTexts(geo, ['disclosure'])).toEqual(['Not drawn (negative value, so no total shown): Loss.']);
  });

  it('an open height gives hidden values the room their unprinted note took', () => {
    const fixture = getFixtures('pie').find((entry) => entry.id === 'ten-tiny-slices')!;
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'pie', data: fixture.data, options: fixture.options } as never)));
    expect(geo.warnings.map((warning) => warning.code)).not.toContain('values-in-note');
    expect(geo.size.height).toBe(437);
  });

  // The 11 px card key moved these two values to the notes list at 320 px: the combo total lost its
  // inside seat to a line marker by a fraction of a pixel, and the scatter height search stopped one note short.
  it('a 320 px card draws the combo Q1 total and the scatter name Model G', () => {
    const noted = (type: string, id: string) => {
      const fixture = getFixtures(type).find((entry) => entry.id === id)!;
      const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type, data: fixture.data, options: { ...fixture.options, size: { width: 320 } }, annotations: fixture.annotations } as never)));
      return geo.labels.filter((label) => label.noted).map((label) => label.id);
    };
    expect(noted('combo', 'option-reference-line')).not.toContain('grandTotal:q1');
    expect(noted('scatter', 'score-vs-cost-frontier')).not.toContain('point:g');
  });

  // Two right value line labels with no seat on their lines share one gutter: wrapped to two
  // lines each, their boxes stacked into each other and the second label went to the note.
  it('two value line labels that share the side gutter both draw', () => {
    const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({
      type: 'column',
      data: { categories: ['a', 'b', 'c', 'd'].map((id) => ({ id })), series: [{ id: 's', values: [10, 10, 10, 10] }] },
      options: { size: { width: 320, height: 180 } },
      annotations: [{ kind: 'valueLine', value: 4, label: 'Long target 0' }, { kind: 'valueLine', value: 5, label: 'Long target 1' }],
    } as never)));
    expect(geo.labels.filter((label) => label.kind === 'valueLine' && label.hidden !== undefined)).toEqual([]);
    // One label hidden at first, the other moving into the gutter on the retry.
    const line = requireGeometry(layoutResolvedRequest(resolveChartRequest({
      type: 'line',
      data: { categories: ['a', 'b', 'c', 'd'].map((id) => ({ id })), series: [{ id: 's', values: [2, 8, 3, 9] }] },
      options: { size: { width: 360, height: 240 } },
      annotations: [{ kind: 'valueLine', value: 4, label: 'Long target 0' }, { kind: 'valueLine', value: 5, label: 'An exceptionally long target label' }],
    } as never)));
    expect(line.labels.filter((label) => label.kind === 'valueLine' && label.hidden !== undefined)).toEqual([]);
  });

  // A hidden left mean label on combo took the right-label gutter retry: the plot lost 60 px and the label stayed hidden.
  it('a combo left mean label without a seat takes no right gutter', () => {
    const fixture = getFixtures('combo').find((entry) => entry.id === 'daily-columns-rate-reference')!;
    const plotW = (annotations: unknown[]) => requireGeometry(layoutResolvedRequest(resolveChartRequest({
      type: 'combo', data: fixture.data, options: { ...fixture.options, annotations, size: { width: 320, height: 240 } },
    } as never))).plot.w;
    expect(plotW([{ kind: 'valueLine', value: 'mean', side: 'left' }])).toBe(plotW([]));
  });

  it('a note never ends in two periods', () => {
    const fixture = getFixtures('line').find((entry) => entry.id === 'two-series-level-diff')!;
    for (const width of [320, 400]) {
      const geo = requireGeometry(getChart('line')!.layout(fixture.data, { ...fixture.options, annotations: fixture.annotations, target: 'report', size: { width } } as never));
      for (const text of noteTexts(geo)) expect(text, `${width}`).not.toMatch(/\.\.$/);
    }
  });

  it.each([
    // Three sources of the warning: noted labels (combo), a heatmap value note, a pie value note
    // (at 480 px every pie label now finds a seat, so its case runs at 320 px).
    ['combo', 'dense-12-months', 480], ['heatmap', 'dense-20x12', 480], ['pie', 'ten-tiny-slices', 320],
  ] as const)('%s %s at %i px names its noted values in one values-in-note warning', (type, id, width) => {
    const fixture = getFixtures(type).find((entry) => entry.id === id)!;
    const geo = requireGeometry(getChart(type)!.layout(fixture.data, { ...fixture.options, annotations: fixture.annotations, target: 'report', size: { width } } as never));
    const warnings = geo.warnings.filter((warning) => warning.code === 'values-in-note');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe('info');
    const values = (warnings[0]!.detail as { values: string[] }).values;
    expect(values.length).toBeGreaterThan(0);
    for (const label of geo.labels.filter((entry) => entry.noted && entry.hidden !== undefined && entry.noteLocation === undefined)) {
      expect(values, label.id).toContain(label.noteText ?? `${label.id} (${label.text})`);
    }
  });
});

// Prevents the note index from dropping another series' value or an annotation with the same digits.
it('note coverage keeps its original owner and kind rules', () => {
  const point = requireGeometry(layoutResolvedRequest(twoLines([]))).labels.find(label => label.kind === 'point')!;
  for (const entry of [
    { owner: { seriesId: 'a', categoryId: 'x' }, kind: 'series' as const, copies: 1 },
    { owner: { seriesId: 'b', categoryId: 'x' }, kind: 'series' as const, copies: 2 },
    { owner: { seriesId: 'a', categoryId: 'x', annotationId: 'note' }, kind: 'series' as const, copies: 2 },
    { owner: { seriesId: 'a', categoryId: 'x' }, kind: 'point' as const, copies: 2 },
    { owner: {}, kind: 'series' as const, copies: 2 },
  ]) {
    const labels = [
      { ...point, id: 'plain', kind: 'point' as const, priority: 0, owner: { seriesId: 'a', categoryId: 'x' } },
      { ...point, id: 'named', kind: entry.kind, priority: 0, owner: entry.owner },
    ];
    const options = withHiddenLabelNote({}, new Map([['plain', '780'], ['named', 'Series A 780']]), { data: {}, labels });
    expect(hiddenNoteLine(options)?.match(/780/g) ?? []).toHaveLength(entry.copies);
  }
});

// under notation at 480 px a taller pass seated every small label and dropped the largest slice's.
it('a pie keeps the largest slice label and notes the smallest when the ring is short of room', () => {
  const spec = (fixtures({ type: 'pie', id: 'ten-tiny-slices', kind: 'all' }, Infinity).body as { fixtures: { spec: { options?: object } }[] }).fixtures[0]!.spec;
  const body = render({ spec: { ...spec, options: { ...spec.options, theme: 'notation', size: { width: 480 } } }, return: ['svg'] }).body as { warnings: { code: string; message: string }[] };
  const noted = body.warnings.find(w => w.code === 'values-in-note')?.message ?? '';
  expect(noted).not.toContain('Market leader');
  expect(noted).toContain('Challenger 10');
});

// freeing a seat for the largest label changed the note and the settled height, and the
// open-height pie then lost one more label than main (standard, 480 px: 9 instead of 10).
it('a pie whose ring frees a seat for a higher label keeps as many labels as the plain order', () => {
  const fixture = getFixtures('pie').find((f) => f.id === 'ten-tiny-slices')!;
  const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'pie', data: fixture.data, options: { ...fixture.options, theme: 'standard', size: { width: 480 } } } as never)));
  expect(geo.labels.filter((label) => !label.hidden && label.kind === 'outsidePie')).toHaveLength(10);
});

// A computed value row on a steep line lost every value to the note with info only.
describe('requested line values', () => {
  // Fully labelled series obey an authored mode, while a sparse cell label still selects its point.
  it('selects fully labelled values by mode, keeps sparse labels and preserves the authored series key', () => {
    const categories = Array.from({ length: 26 }, (_, i) => ({ id: `m${i}` }));
    for (const valueLabels of ['last', 'none']) {
      const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line',
        data: { categories, series: [
          { id: 'a', label: 'Alpha', values: categories.map((_, i) => ({ number: 100 + i * 3, label: `Text${i}` })) },
          { id: 'b', label: 'Beta', values: categories.map((_, i) => ({ number: 130 + i * 2, label: `Other${i}` })) },
        ] }, options: { valueLabels, seriesLabels: 'key', size: { width: 680 } },
      } as never)));
      const points = geo.labels.filter(label => label.kind === 'point');
      expect(points.map(label => label.text).sort()).toEqual(valueLabels === 'none' ? [] : ['Other25', 'Text25']);
      expect(geo.warnings.map(w => w.code)).not.toContain('line-end-label-key');
      expect(geo.warnings.map(w => w.code)).not.toContain('legend-beside-plot');
    }
    for (const { values, options, expected } of [
      { values: [10, { number: 12, label: 'Mid 12' }, 15], options: { valueLabels: 'last' }, expected: ['15', 'Mid 12'] },
      { values: [10, { number: 12, label: 'Mid 12' }, 15], options: {}, expected: ['15', 'Mid 12'] },
      { values: [{ number: 10, label: 'Start 10' }, { number: 12, label: 'Mid 12' }, { number: 15, label: 'End 15' }],
        options: {}, expected: ['End 15', 'Mid 12', 'Start 10'] },
      { values: [null, { number: 12, label: 'Mid 12' }, { number: 15, label: false }],
        options: { valueLabels: 'none' }, expected: [] },
    ]) {
      const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line',
        data: { categories: ['a', 'b', 'c'].map(id => ({ id })), series: [
          { id: 's', values },
        ] }, options: { ...options,
          valueAxis: { min: 0, max: 30, show: true }, size: { width: 640, height: 360 } },
      } as never)));
      expect(geo.labels.filter(label => label.kind === 'point' && !label.hidden).map(label => label.text).sort())
        .toEqual(expected);
    }
    // A default single-series name mode must keep an end value, at its point or through the key when its point has no seat.
    // (On this broken axis the phases are bands that claim no label room, so the value keeps its point seat.)
    const phase = getFixtures('line').find(fixture => fixture.id === 'option-phase-tones')!;
    const fallback = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line', data: phase.data,
      options: { ...phase.options, size: { width: 320 } }, annotations: phase.annotations,
    } as never)));
    expect(fallback.scene.some(node => node.t === 'text' && ['Cycle time 7 days', '7 days'].includes(node.lines.join(' ')))).toBe(true);
  });

  // A context value must not take the first point while the focus value loses every seat.
  it('keeps the highlighted first value beside a steep line with close context', () => {
    for (const highlightMode of [undefined, 'fade'] as const) {
      const geo = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line',
        data: { categories: ['start', 'middle', 'end'].map(id => ({ id })), series: [
          { id: 'context', label: 'Context', values: [1020, 1100, 1200] },
          { id: 'focus', label: 'Focus', values: [1000, 2000, 1000] },
        ] }, options: { highlight: 'focus', ...(highlightMode ? { highlightMode } : {}), labelDensity: 'minimal', valueLabels: 'ends', seriesLabels: 'key', size: { width: 560 } },
      } as never)));
      const first = geo.labels.find(label => label.id === 'point:focus:start');
      expect(first).toBeDefined();
      expect(first?.hidden).toBeUndefined();
    }
  });

  const spec = (values: number[], width: number, categories = values.map((_, i) => ({ id: `m${i}`, label: `M${i + 1}` }))) => ({
    type: 'line', data: { categories, series: [{ id: 'rate', label: 'Rate', values }] },
    options: { valueLabels: 'all', size: { width } },
  });
  const drawn = (body: { svg: string }) => body.svg.match(/data-part="point"/g)?.length ?? 0;
  // A requested row that loses every seat must name all its values and their destinations.
  it('draws every value of a steep line, and warns when a row truly has no room', () => {
    const fits = render({ spec: spec([12.4, 13.1, 12.8, 14.2, 15.0, 14.6], 640), return: ['svg'] }).body as { svg: string; warnings: { code: string }[] };
    expect(drawn(fits)).toBe(6);
    expect(fits.warnings.map((w) => w.code)).not.toContain('label-hidden');
    const crowded = render({ spec: spec(Array.from({ length: 24 }, (_, i) => (i * 7) % 11 + 100.5), 320), return: ['svg', 'reading'] }).body as { svg: string; warnings: LintWarning[]; reading: ChartReading };
    expect(drawn(crowded)).toBe(0);
    expect(crowded.warnings.filter((w) => w.code === 'label-hidden')).toHaveLength(1);
    expect(crowded.warnings.find((w) => w.code === 'label-hidden')).toMatchObject({ severity: 'warn' });
    expect(crowded.reading.omissions.filter(o => o.labelId.startsWith('point:'))).toHaveLength(24);
    expect(crowded.reading.omissions.every(o => o.destination !== undefined)).toBe(true);
  });

  // one value with no seat gave the requested-row warn and the solver's per-label info as well.
  it('report one lost value once', () => {
    const fixture = getFixtures('line').find((f) => f.id === 'line-compact-380')!;
    const body = render({ spec: { type: 'line', data: fixture.data, options: { ...fixture.options, size: { width: 320 } } }, return: ['svg'] }).body as { warnings: { code: string }[] };
    expect(body.warnings.filter((w) => w.code === 'label-hidden')).toHaveLength(1);
    // the match read the id from the message text, so an id with an apostrophe kept the second entry.
    const data = fixture.data as { series: { id: string }[] };
    const quoted = { ...data, series: data.series.map((s) => ({ ...s, id: `${s.id}'s` })) };
    const again = render({ spec: { type: 'line', data: quoted, options: { ...fixture.options, size: { width: 320 } } }, return: ['svg'] }).body as { warnings: { code: string }[] };
    expect(again.warnings.filter((w) => w.code === 'label-hidden')).toHaveLength(1);
  });

  // a bump value folded into a name that it wrapped raised the size floor, so 400×300 refused where 0.48.0 drew.
  it('fold a bump value into its name only where the size floor stays', () => {
    const fixture = getFixtures('line').find((f) => f.id === 'bump-two-point-close-ranks')!;
    const body = render({ spec: { type: 'line', data: fixture.data, options: { ...fixture.options, target: 'dashboard', size: { width: 400, height: 300 } } }, return: ['svg'] }).body as { ok: boolean; svg: string };
    expect(body.ok).toBe(true);
    expect(body.svg).toContain('Alder · 19.5%');
  });
});

// Intentional omissions must stay named without warning; an explicit value request must still warn when it loses its seat.
it('names intentional label choices without warning and keeps explicit value losses visible', () => {
  type Body = { ok: boolean; reading: ChartReading; warnings: LintWarning[] };
  const fixture = getFixtures('column').find(fixture => fixture.id === 'shared-absolute-outlier')!;
  const minimal = render({ spec: { type: 'column', data: fixture.data,
    options: { ...fixture.options, size: { width: 320 } } }, return: ['reading'] }).body as Body;
  expect(minimal.ok).toBe(true);
  expect(minimal.reading.omissions.filter(item => item.labelId.startsWith('point:'))).toHaveLength(3);
  expect(minimal.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);

  const categories = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase() }));
  const data = { categories, series: [{ id: 's', label: 'Series', values: [10, 20, 30, 40] }] };
  for (const valueLabels of ['none', 'last', 'ends', 'extremes'] as const) {
    const body = render({ spec: { type: 'line', data,
      options: { valueLabels, seriesLabels: 'none', size: { width: 640 } } }, return: ['reading'] }).body as Body;
    expect(body.ok).toBe(true);
    expect(body.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'point:s:b', reason: `valueLabels:${valueLabels}` }));
    expect(body.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'series:s', text: 'Series' }));
    expect(body.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  }
  for (const rest of [true, false]) {
    const body = render({ spec: { type: 'column', data,
      options: { topN: { n: 2, rest }, size: { width: 640 } } }, return: ['reading'] }).body as Body;
    expect(body.ok).toBe(true);
    expect(body.reading.omissions).toContainEqual({ labelId: 'category:a', text: 'A', reason: 'topN', destination: 'reading.omissions' });
    expect(body.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  }
  for (const labels of [false, { point: false, series: false, category: false }] as const) {
    const body = render({ spec: { type: 'line', data, options: { labels, size: { width: 640 } } }, return: ['reading'] }).body as Body;
    expect(body.ok).toBe(true);
    expect(body.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'point:s:a', reason: 'disabled' }));
    expect(body.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  }
  const cell = render({ spec: { type: 'line', data: { ...data, series: [{ ...data.series[0], values: [{ number: 10, label: false }, 20, 30, 40] }] },
    options: { valueLabels: 'all', size: { width: 640 } } }, return: ['reading'] }).body as Body;
  expect(cell.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'point:s:a' }));
  expect(cell.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  const only = render({ spec: { type: 'line', data: { ...data, series: [...data.series, { id: 'other', label: 'Other', values: [11, 21, 31, 41] }] },
    options: { seriesLabels: { only: ['s'] }, size: { width: 640 } } }, return: ['reading'] }).body as Body;
  expect(only.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'series:other', text: 'Other' }));
  expect(only.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'point:other:a', reason: 'seriesLabels.only' }));
  expect(only.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  const rest = render({ spec: { type: 'column', data: { ...data, series: [...data.series, { id: 'rest', label: 'Rest', colorRole: 'others', values: [15, 25, 35, 45] }] },
    options: { variant: 'stacked', labels: { restSeries: false }, size: { width: 640 } } }, return: ['reading'] }).body as Body;
  expect(rest.reading.omissions.some(item => item.labelId.startsWith('segment:rest:'))).toBe(true);
  expect(rest.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  const totals = render({ spec: { type: 'column', data,
    options: { variant: 'stacked', grandTotalLabels: false, size: { width: 640 } } }, return: ['reading'] }).body as Body;
  expect(totals.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'grandTotal:a', reason: 'disabled' }));
  expect(totals.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  const points = render({ spec: { type: 'scatter', data: { points: [{ id: 'a', label: 'A', x: 1, y: 2 }, { id: 'b', label: 'B', x: 3, y: 4 }] },
    options: { maxPointLabels: 1, size: { width: 640 } } }, return: ['reading'] }).body as Body;
  expect(points.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'point:a', text: 'A', reason: 'maxPointLabels' }));
  expect(points.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  const spark = render({ spec: { type: 'sparkline', data: { values: [10, 20, 30], labels: ['First', 'Middle', 'Last'] },
    options: { endLabels: 'none', valueLabel: 'none', size: { width: 640 } } }, return: ['reading'] }).body as Body;
  expect(spark.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'spark:label:first', text: 'First', reason: 'endLabels:none' }));
  expect(spark.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'spark:last', reason: 'valueLabel:none' }));
  expect(spark.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);

  const crowded = render({ spec: { type: 'line', data: {
    categories: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, label: `C${i}` })),
    series: [{ id: 's', label: 'Series', values: Array.from({ length: 24 }, (_, i) => 100 + i * 250) }],
  }, options: { labelDensity: 'minimal', valueLabels: 'all', size: { width: 400 } } }, return: ['reading'] }).body as Body;
  expect(crowded.ok).toBe(true);
  expect(crowded.warnings.filter(warning => warning.code === 'label-hidden')).toHaveLength(1);
  expect(crowded.reading.omissions.some(item => item.labelId.startsWith('point:'))).toBe(true);
});

// A series name printed in the key or legend is readable and must not be reported as lost.
// A pie folds slices into Others by default, and reading.omissions must name the folded categories as it does for an authored topN.
it('names the categories a default pie cut folds into Others', () => {
  const ids = 'abcdefghij'.split('');
  const data = { categories: ids.map(id => ({ id, label: id.toUpperCase() })), series: [{ id: 's', label: 'Series', values: ids.map((_, i) => 100 - i) }] };
  const omitted = (categoryCount: number) => (render({ spec: { type: 'pie', data: { ...data, categories: data.categories.slice(0, categoryCount),
    series: [{ ...data.series[0]!, values: data.series[0]!.values.slice(0, categoryCount) }] } }, return: ['reading'] }).body as { reading: ChartReading })
    .reading.omissions.filter(item => item.reason === 'topN').map(item => item.labelId);
  expect(omitted(10)).toEqual(['category:h', 'category:i', 'category:j']);
  expect(omitted(9)).toEqual([]);
});

it('recognizes series names printed in a key, legend or replacement label', () => {
  for (const legend of [undefined, 'bottom'] as const) {
    const body = render({ spec: { type: 'line', data: {
      categories: ['a', 'b', 'c'], series: [
        { id: 'alpha', label: 'Alpha', values: [10, 20, 30] },
        { id: 'beta', label: 'Beta', values: [30, 25, 15] },
      ],
    }, options: { seriesLabels: 'none', ...(legend ? { legend } : {}), size: { width: 640 } } },
    return: ['svg', 'reading'] }).body as { ok: boolean; svg: string; reading: ChartReading; warnings: LintWarning[] };
    expect(body.ok).toBe(true);
    expect(body.svg).toContain('Alpha');
    expect(body.svg).toContain('Beta');
    expect(body.reading.omissions.filter(item => item.labelId === 'series:alpha' || item.labelId === 'series:beta')).toEqual([]);
    expect(body.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  }
  const source = render({ spec: { type: 'line', data: { categories: ['a', 'b'], series: [{ id: 's', values: [10, 20] }] },
    options: { source: 'Invented source text', size: { width: 640 } } }, return: ['svg', 'reading'] }).body as { svg: string; reading: ChartReading };
  expect(source.svg).toContain('Invented source text');
  expect(source.reading.omissions.some(item => item.labelId === 'frame:source')).toBe(false);
});

// A viewport exclusion is not a label-cap loss, while a cap that actually disables labels still names them.
it('keeps out-of-view scatter points out of label omissions and checks the actual cap', () => {
  const data = { points: [{ id: 'a', label: 'A', x: 1, y: 2 }, { id: 'b', label: 'B', x: 3, y: 4 }] };
  for (const options of [{ viewDomain: { x: [0, 2] } }, { viewDomain: { x: [0, 2] }, maxPointLabels: 1 }, { labels: false, viewDomain: { x: [0, 2] } }]) {
    const body = render({ spec: { type: 'scatter', data, options: { ...options, size: { width: 640 } } },
      return: ['reading'] }).body as { ok: boolean; reading: ChartReading; warnings: LintWarning[] };
    expect(body.ok).toBe(true);
    expect(body.reading.values.total).toBe(2);
    expect(body.reading.omissions.filter(item => item.labelId === 'point:b')).toEqual([]);
    expect(body.reading.omissions.filter(item => item.reason === 'maxPointLabels')).toEqual([]);
    expect(body.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  }
  const capped = render({ spec: { type: 'scatter', data, options: { maxPointLabels: 1, size: { width: 640 } } },
    return: ['reading'] }).body as { reading: ChartReading };
  expect(capped.reading.omissions.filter(item => item.reason === 'maxPointLabels').map(item => item.labelId)).toEqual(['point:a', 'point:b']);
  for (const viewport of [{ viewDomain: { x: ['b', 'c'] } }, { window: { last: 2 } }]) {
    const body = render({ spec: { type: 'line', data: { categories: ['a', 'b', 'c', 'd'], series: [{ id: 's', values: [10, 20, 30, 40] }] },
      options: { ...viewport, labels: false, size: { width: 640 } } }, return: ['reading'] }).body as { ok: boolean; reading: ChartReading; warnings: LintWarning[] };
    expect(body.ok).toBe(true);
    expect(body.reading.omissions.some(item => item.labelId === 'point:s:a')).toBe(false);
    expect(body.warnings.filter(warning => warning.code === 'label-hidden')).toEqual([]);
  }
});

// Off-stride monthly headers had axis requests but no solver labels or reading omissions.
it('names monthly headers omitted before the solver and warns once', () => {
  const columns = Array.from({ length: 60 }, (_, i) => ({
    id: `${2021 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`,
    label: `Forecast month ${i + 1}`,
  }));
  const body = render({ spec: { type: 'status', data: {
    rows: [{ id: 'row', label: 'Row' }], columns,
    cells: columns.map(column => ({ row: 'row', col: column.id, state: 'ok' })),
  }, options: { states: [{ id: 'ok', label: 'Ready', tone: 'good' }], size: { width: 960 } } },
  return: ['svg', 'reading'] }).body as { ok: boolean; svg: string; reading: ChartReading; warnings: LintWarning[] };
  expect(body.ok).toBe(true);
  const omitted = columns.filter(column => !body.svg.includes(`label:category:${column.id}"`));
  expect(omitted.length).toBeGreaterThan(0);
  for (const column of omitted) expect(body.reading.omissions).toContainEqual({
    labelId: `category:${column.id}`, text: column.label, reason: 'density', destination: 'reading.omissions',
  });
  expect(body.warnings.filter(w => w.code === 'label-hidden')).toHaveLength(1);
  expect(body.warnings.find(w => w.code === 'label-hidden')?.severity).toBe('warn');
});

// A value printed in a callout is readable and must not be counted as missing again.
it('excludes a value printed by a visible callout from the loss warning', () => {
  const body = render({ spec: { type: 'line', data: {
    categories: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `C${i}` })),
    series: [{ id: 's', label: 'Series', values: Array.from({ length: 12 }, (_, i) => 100.5 + (i * 7) % 13) }],
  }, options: { valueLabels: 'all', size: { width: 400 } },
  annotations: [{ kind: 'callout', id: 'a', at: { categoryId: 'c0', seriesId: 's' }, text: 'Read ${value}' }],
  }, return: ['svg', 'reading'] }).body as { ok: boolean; svg: string; reading: ChartReading; warnings: LintWarning[] };
  expect(body.ok).toBe(true);
  expect(body.svg).toContain('Read 101');
  expect(body.reading.omissions).toContainEqual(expect.objectContaining({ labelId: 'point:s:c0', destination: 'label:annotation:a' }));
  const lost = body.warnings.find(w => w.code === 'label-hidden')?.detail?.hidden as string[];
  expect(lost.length).toBeGreaterThan(0);
  expect(lost).not.toContain('point:s:c0');
});

// Heatmap value notes can bypass the solver, so the reading must name their full list too.
it('names every heatmap value moved directly to a note and warns once', () => {
  const categories = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `Column ${i}` }));
  const series = Array.from({ length: 12 }, (_, j) => ({ id: `s${j}`, label: `Row ${j}`,
    values: categories.map((_, i) => (i % 2 ? 1 : -1) * (100.5 + (i * 7 + j * 11) % 13)),
  }));
  const body = render({ spec: { type: 'heatmap', data: { categories, series },
    options: { margin: { top: 0, right: 0, bottom: 0, left: 0 }, labelDensity: 'full', size: { width: 480 } } },
  return: ['reading'] }).body as { ok: boolean; reading: ChartReading; warnings: LintWarning[] };
  expect(body.ok).toBe(true);
  const values = body.warnings.find(w => w.code === 'values-in-note')?.detail?.values as string[];
  expect(values).toHaveLength(240);
  for (const text of values) expect(body.reading.omissions).toContainEqual(expect.objectContaining({ text, reason: 'note', destination: expect.any(String) }));
  expect(body.warnings.filter(w => w.code === 'label-hidden')).toHaveLength(1);
  expect(body.warnings.find(w => w.code === 'label-hidden')?.severity).toBe('warn');
});

// A fallback key already prints the authored last value; a second point label also put it in a duplicate note.
it('keeps authored endpoint values out of their fallback key', () => {
  const body = render({ spec: { type: 'line', data: {
    categories: ['a', 'b', 'c'].map(id => ({ id })),
    series: [0, 1].map(i => ({ id: `s${i}`, label: `Series ${i}`, values: [20 + i * 10, 50 + i * 10, { number: 100 + i, label: '${value}' }] })),
  }, options: { legend: 'top', size: { width: 680 } } }, return: ['svg', 'reading'] }).body as {
    svg: string; notes: { text: string }[]; reading: ChartReading;
  };
  const keys = [...body.svg.matchAll(/<text[^>]*data-part="legendLabel"[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''));
  expect(keys).not.toContain('Series 0 100');
  expect(keys).not.toContain('Series 1 101');
  for (const value of ['100', '101']) {
    expect(body.svg.includes(`>${value}</tspan>`) || body.reading.omissions.some(item => item.text.includes(value))).toBe(true);
  }
});

// A zero-tail group could drop the second authored endpoint text without a label or an omission record.
it('keeps each authored zero-tail label in omissions when the fallback key carries names only', () => {
  const body = render({ spec: { type: 'line', data: {
    categories: ['a', 'b', 'c'].map(id => ({ id })),
    series: [
      { id: 'alpha', label: 'Alpha', values: [20, 50, { number: 0, label: 'NO SALES' }] },
      { id: 'beta', label: 'Beta', values: [30, 60, { number: 0, label: 'NO SALES' }] },
    ],
  }, options: { size: { width: 960 } } }, return: ['svg', 'reading'] }).body as {
    ok: boolean; svg: string; reading: ChartReading;
  };
  expect(body.ok).toBe(true);
  const keys = [...body.svg.matchAll(/<text[^>]*data-part="legendLabel"[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => match[1]!.replace(/<[^>]+>/g, ''));
  expect(keys).toEqual(['Alpha', 'Beta']);
  for (const [id, name] of [['alpha', 'Alpha'], ['beta', 'Beta']]) {
    expect(body.reading.omissions).toContainEqual(expect.objectContaining({ labelId: `point:${id}:c`, text: `${name} NO SALES (c)` }));
  }
});

// An unnamed Mekko column kept its total on the bar and repeated that total in its category note.
it('names unnamed Mekko columns without repeating their values', () => {
  const body = render({ spec: { type: 'mekko', data: {
    categories: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, label: `Long category name ${i}` })),
    series: [{ id: 's', label: 'Cost', values: [17, 23, 31, 43, 59, 61] },
      { id: 'w', label: 'Volume', role: 'reference', values: [1, 1, 1, 1, 1, 100] }],
  }, options: { variant: 'bar', widthSeriesId: 'w', size: { width: 680 }, notes: { show: ['note', 'disclosure'] } } }, return: ['svg', 'reading'] }).body as {
    svg: string; notes: { text: string }[]; reading: ChartReading;
  };
  const note = body.notes.find(note => note.text.startsWith('Not named in place'))!.text;
  expect(note).toContain('Long category name 2');
  expect(note).not.toMatch(/\(31\)|\(43\)|\(59\)/);
  for (const value of ['17', '23', '31', '43', '59', '61']) {
    expect(body.svg.includes(`>${value}</tspan>`) || body.reading.omissions.some(item => item.text.includes(value))).toBe(true);
  }
});
