import { describe, expect, it, vi } from 'vitest';
import * as labelSolver from '../src/core/label/solver';
import { layoutColumn } from '../src/core/charts/column/layout';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { canDraw, layoutResolvedRequest, renderSvg, resolveChartRequest } from '../src/index';
import { contrastRatio } from '../src/core/color';
import { resolveTheme } from '../src/core/theme';
import { measureText } from '../src/core/text';

/** Lay out a catalog fixture through the request path the CLI and React use. */
function layoutFixture(type: string, id: string) {
  const fixture = getFixtures(type).find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture ${type}/${id}`);
  const request = { type, data: structuredClone(fixture.data), options: structuredClone(fixture.options ?? {}), ...(fixture.annotations ? { annotations: structuredClone(fixture.annotations) } : {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
}

describe('chart layout edge cases', () => {
  // A dot scatter lost two names with free room: a seat across the 2x2 divider was dropped
  // before its copy slid to the point's side, and a name ranked first kept the seat a later name needed.
  it('scatter keeps every point name where room is free (log-both-stores-revenue)', () => {
    const geometry = layoutFixture('scatter', 'log-both-stores-revenue');
    const hidden = geometry.labels.filter((l: { id: string; hidden?: unknown }) => String(l.id).startsWith('point:') && l.hidden).map((l: { id: string }) => l.id);
    expect(hidden).toEqual([]);
  });

  // Dense stacked columns with a negative part lost their 'Net' total: the only seats stood beside
  // the net tick, inside the next column, and the tick stayed without its label.
  it('a mixed-sign stack keeps its net total where the tick has no free side', () => {
    const cats = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `C${i + 1}` }));
    const request = {
      type: 'column',
      data: { categories: cats, series: [
        { id: 'a', label: 'A', values: cats.map((_, i) => 6 + (i % 3)) },
        { id: 'b', label: 'B', values: cats.map((_, i) => (i % 4 === 1 ? -2 : 1)) },
      ] },
      options: { variant: 'stacked', title: 'T', size: { width: 480, height: 320 } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const nets = geometry.labels.filter((l: { id: string; text: string }) => String(l.id).startsWith('grandTotal:') && l.text.startsWith('Net'));
    expect(nets).toHaveLength(3);
    expect(nets.filter((l: { hidden?: unknown }) => l.hidden)).toEqual([]);
  });

  // A 100% stack printed 33% + 33% + 33% = 99%: each share was rounded on its own.
  for (const [type, variant] of [['column', 'stacked100'], ['bar', 'stacked100'], ['combo', undefined]] as const) {
    it(`${type} stack shares add up to 100% by default`, () => {
      const series = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), values: [1], ...(type === 'combo' ? { kind: 'column' } : {}) }));
      const request = {
        type,
        data: { categories: [{ id: 'q1', label: 'Q1' }], series },
        options: { ...(variant ? { variant } : { labels: { segment: ['percent'] } }), title: 'T', size: { width: 480, height: 300 } },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
      const shares = geometry.labels.filter((l: { id: string; hidden?: unknown }) => String(l.id).startsWith('segment:') && !l.hidden)
        .map((l: { text: string }) => Number.parseFloat(l.text));
      expect(shares).toHaveLength(3);
      expect(shares.reduce((sum: number, share: number) => sum + share, 0)).toBe(100);
      // reading.rounding names the one share moved off its nearest rounding.
      expect(geometry.derived.roundingAdjustments).toHaveLength(1);
    });
  }

  // methodNote: true printed no note: engine notes are hidden unless notes.show names them,
  // and a composing chart (cohort, pvm) dropped the option before its host's frame saw it.
  for (const [type, id, kind] of [['cohort', 'logo-retention-method-note', 'method'], ['pvm', 'revenue-bridge-method-note', 'disclosure']] as const) {
    it(`${type} prints the note methodNote asks for (${id})`, () => {
      const notes = layoutFixture(type, id).frame.noteList as { kind: string; inFrame: boolean }[];
      expect(notes.some((note) => note.kind === kind && note.inFrame)).toBe(true);
    });
  }

  // With the asked notes printed, a pinned 400 x 300 map refused (size-below-floor) where it drew before.
  it('a pinned canvas too small for the notes methodNote asks for draws without them (world-footprint)', () => {
    const fixture = getFixtures('choropleth').find((f) => f.id === 'world-footprint')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'choropleth', data: structuredClone(fixture.data), options: { ...structuredClone(fixture.options), size: { width: 400, height: 300 } } } as any) as any) as any;
    expect(geometry.refused).toBeFalsy();
    expect(geometry.warnings.some((w: { code: string; message: string }) => w.code === 'footnotes-off' && w.message.includes('methodNote'))).toBe(true);
  });

  // A format coarser than the class width ('$0M' over 1.2M to 1.48M) rounded the class edges into one
  // value: the key printed '$1M to under $1M' and every region took the darkest class.
  for (const type of ['choropleth', 'tilemap'] as const) {
    it(`${type} classes keep apart when the format is coarser than the class width`, () => {
      const pack = 'eu27';
      const ids = ['DE', 'FR', 'IT', 'ES', 'PL', 'NL', 'SE', 'AT'];
      const request = { type, data: { pack, regions: ids.map((id, i) => ({ id, value: 1_200_000 + i * 40_000 })) }, options: { classes: 5, format: '$0M' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
      const ticks = [...geometry.scene, ...geometry.labels]
        .filter((node: { id?: string }) => /^(legend-edge|legend:tickLabel):/.test(String(node.id)))
        .map((node: { text?: string; lines?: string[] }) => node.text ?? node.lines?.[0]);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(new Set(ticks).size).toBe(ticks.length);
    });
  }

  // A fractional data max printed its end tick with the coarse format ('$1.43M' then '$1M'), and a region
  // exactly on a printed edge ('$8.3M') fell below it because the edge came out as 8300000.000000001.
  it('tilemap end ticks keep the lifted decimals and a value on a printed edge takes the class above', () => {
    const layout = (regions: Record<string, number>) => layoutResolvedRequest(resolveChartRequest({
      type: 'tilemap', data: { pack: 'eu27', regions: Object.entries(regions).map(([id, value]) => ({ id, value })) }, options: { classes: 5, format: '$0M' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as any) as any;
    const ticksOf = (geometry: { scene: { id?: string; text?: string }[]; labels: { id?: string; text?: string; lines?: string[] }[] }) =>
      [...geometry.scene, ...geometry.labels].filter((node) => /^(legend-edge|legend:tickLabel):/.test(String(node.id)))
        .map((node) => (node as { text?: string; lines?: string[] }).text ?? (node as { lines?: string[] }).lines?.[0]);
    expect(ticksOf(layout({ DE: 1234567, FR: 1300000, IT: 1400000, ES: 1481234.5 })).at(-1)).toBe('$1.48M');
    const geometry = layout({ DE: 8100000, FR: 8200000, IT: 8300000, ES: 8400000, PL: 8500000, NL: 8600000 });
    const fill = (id: string) => JSON.stringify(geometry.scene.find((node: { id?: string }) => node.id === `tile:${id}`)?.fill);
    expect(fill('IT')).not.toBe(fill('FR'));
    expect(fill('IT')).not.toBe('undefined');
  });

  // The key said 'rise over 10%' while +7.1% drew the strong arrow: the cut was a share of the column's largest change.
  it('table arrows on a percent column cut the change itself, as the key says (fatigue-cell-encodings)', () => {
    const geometry = layoutFixture('table', 'fatigue-cell-encodings');
    const arrows = new Map(geometry.scene.filter((node: { part?: string }) => node.part === 'tableArrow')
      .map((node: { owner: { rowId?: string; colId?: string }; lines: string[] }) => [`${node.owner.rowId}:${node.owner.colId}`, node.lines[0]]));
    expect(arrows.get('lawn:dCtr')).toBe('↗');
    expect(arrows.get('advice:dCtr')).toBe('→');
    expect(arrows.get('advice:dCvr')).toBe('↘');
  });

  // A unit change keeps the relative cut, so its key must say the cut is a share of the largest change.
  it('table arrows on a unit column keep the relative cut and say so in the key', () => {
    const request = {
      type: 'table',
      data: {
        columns: [
          { id: 'label', kind: 'rowLabel', label: 'Store' },
          { id: 'a', kind: 'value', label: 'Before', format: '1' },
          { id: 'b', kind: 'value', label: 'After', format: '1' },
          { id: 'd', kind: 'computed', label: 'Change', calc: { op: 'delta', a: 'b', b: 'a' }, polarity: 'higherIsBetter', format: '+1' },
        ],
        rows: [
          { id: 'x', label: 'X', cells: { a: 100, b: 200 } },
          { id: 'y', label: 'Y', cells: { a: 100, b: 105 } },
        ],
      },
      options: { title: 'T', encodings: { d: 'arrow' } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const texts = geometry.scene.flatMap((node: { t: string; lines?: string[] }) => node.t === 'text' ? node.lines ?? [] : []);
    // +100 is the largest change (↑); +5 is 5% of it (↗).
    expect(texts).toContain('rise over 2%, up to 10% of the largest change');
  });

  // The elapsed-era key swatch took the plot wash's 0.95 tint and read as an empty box on the card.
  it('the gantt elapsed key swatch reads as filled (status-gantt)', () => {
    const svg = renderSvg(layoutFixture('gantt', 'status-gantt'), resolveTheme());
    const swatches = [...svg.matchAll(/<rect data-id="frame:swatch:\d+" data-part="swatch"[^>]*fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]!);
    expect(swatches.length).toBeGreaterThan(0);
    for (const fill of swatches) expect(contrastRatio(fill, '#ffffff')).toBeGreaterThan(1.25);
  });

  // A plan corridor drew as a four-sided outlined box across the plot and read as a frame.
  it('a plan corridor draws as a wash between two edges, not an outlined box (column/plan-corridor)', () => {
    const own = layoutFixture('column', 'plan-corridor').scene.filter((node: { owner?: { annotationId?: string } }) => node.owner?.annotationId === 'plan');
    expect(own.filter((node: { pattern?: string }) => node.pattern === 'outline')).toEqual([]);
    expect(own.filter((node: { id: string }) => node.id.includes(':edge:'))).toHaveLength(2);
  });

  // An abs callout on the tallest column printed its 900 a second time on a leader beside the value label.
  it('an abs callout without text is not drawn over a value the column already prints (shared-absolute-outlier)', () => {
    const geometry = layoutFixture('column', 'shared-absolute-outlier');
    expect(geometry.labels.some((label: { id: string; hidden?: unknown }) => label.id === 'label:point:revenue:global' || (String(label.id).includes('point') && String(label.id).includes('global') && !label.hidden))).toBe(true);
    expect(geometry.scene.filter((node: { id: string }) => node.id.includes('global-absolute'))).toEqual([]);
    // A point label that prints another text (an authored word) keeps the callout's number.
    const fixture = getFixtures('column').find((f) => f.id === 'shared-absolute-outlier')!;
    const data = structuredClone(fixture.data) as { series: { values: unknown[] }[] };
    data.series[0]!.values[4] = { number: 900, label: 'Record' };
    const worded = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: structuredClone(fixture.options ?? {}), annotations: structuredClone(fixture.annotations) } as never) as never) as { scene: { id: string }[] };
    expect(worded.scene.some((node) => node.id.includes('global-absolute'))).toBe(true);
  });

  // Quartile labels sat inside two boxes and under the other two, so the rows read differently.
  it('box quartile labels take the same seat on every row (cycle-time-by-team)', () => {
    const slots = layoutFixture('box', 'cycle-time-by-team').labels
      .filter((label: { id: string }) => /^stat:.*:q[13]$/.test(label.id)).map((label: { slot: string }) => label.slot);
    expect(slots.length).toBeGreaterThan(2);
    expect(new Set(slots).size).toBe(1);
  });

  // At rank 1 the line's value stood over the column on a leader that ran through the column
  // total's seat, so '40' moved off its column and the two numbers read as one pair.
  it('a line value inside its first column leaves the column total on its column (ranked-campaigns)', () => {
    const geometry = layoutFixture('combo', 'ranked-campaigns-rank-key-only');
    const total = geometry.labels.find((label: { id: string }) => label.id === 'grandTotal:c0');
    const column = geometry.scene.find((node: { id: string }) => node.id === 'mark:spend:c0').rect;
    expect(total.hidden).toBeFalsy();
    const mid = total.rect.x + total.rect.w / 2;
    expect(mid).toBeGreaterThan(column.x);
    expect(mid).toBeLessThan(column.x + column.w);
    expect(geometry.labels.find((label: { id: string }) => label.id === 'point:roas:c0').leader).toBeUndefined();
  });

  // The rank key broke "3." from its name at a line end, and each six ranks repeated "Columns by rank".
  it('the rank key keeps each rank with its name and names the list once', () => {
    const notes = layoutFixture('combo', 'ranked-campaigns-rank-key-only').frame.noteList.map((note: { text: string }) => note.text).join(' ');
    expect(notes.split('Columns by rank').length - 1).toBe(1);
    expect(notes).toContain('3.\u00a0Display\u00a0campaign\u00a0North');
  });

  // "South target 70%" printed its 70 a second time under the name, and the two lines sat on the South line over its +2 point.
  it('a goal label prints its value once and keeps off its series\' points (regions-ramp-target)', () => {
    const geometry = layoutFixture('line', 'regions-ramp-target');
    const goal = geometry.labels.find((label: { id: string }) => label.id.startsWith('target-label:'));
    expect(goal.hidden).toBeFalsy();
    expect(goal.lines).toEqual(['South target 70%']);
    const points = geometry.scene.filter((node: { t: string; id: string; owner?: { seriesId?: string } }) => node.t === 'circle' && node.owner?.seriesId === 'south' && !node.id.startsWith('target'));
    expect(points.length).toBeGreaterThan(0);
    for (const point of points as { cx: number; cy: number; r: number }[]) {
      const clear = point.cx + point.r < goal.rect.x || point.cx - point.r > goal.rect.x + goal.rect.w || point.cy + point.r < goal.rect.y || point.cy - point.r > goal.rect.y + goal.rect.h;
      expect(clear).toBe(true);
    }
    // Only the value itself as a whole number drops the value line; an area's fill does not take the seats.
    const goalOf = (label: string, variant?: string, value = variant ? 40 : 20) => (layoutResolvedRequest(resolveChartRequest({ type: 'line',
      data: { categories: ['a', 'b', 'c'], series: [{ id: 's', label: 'S', values: variant ? [100, 100, 100] : [5, 10, 15] }] },
      options: { ...(variant ? { variant } : {}), size: { width: 640, height: 400 }, targets: [{ seriesId: 's', at: 'b', value, label }] } } as never) as never) as { labels: { id: string; lines: string[]; hidden?: unknown }[] })
      .labels.find((label) => label.id.startsWith('target-label:'))!;
    expect(goalOf('Improve from -20').lines).toHaveLength(2);
    expect(goalOf('Reach 20k').lines).toHaveLength(2);
    expect(goalOf('Improve from .20').lines).toHaveLength(2);
    expect(goalOf('Goal 20.').lines).toHaveLength(1);
    expect(goalOf('Goal by 20/11/2026').lines).toHaveLength(2);
    expect(goalOf('Q2 target', undefined, 2).lines).toHaveLength(2);
    expect(goalOf('Reduce from 1e2', undefined, 2).lines).toHaveLength(2);
    expect(goalOf('EU target 70%', undefined, 70).lines).toHaveLength(1);
    expect(goalOf('Reduce from 1 500', undefined, 500).lines).toHaveLength(2);
    expect(goalOf('Reduce from 1 500', undefined, 1500).lines).toHaveLength(2);
    expect(goalOf('Goal', 'area').hidden).toBeFalsy();
  });

  // Right-aligned names printed text-anchor start at edge - measured width: a viewer that swaps the
  // font (GitHub shows README SVGs in the reader's fonts) left their right ends ragged by 4 to 8 px.
  it('a right-aligned column of names prints anchored at its shared right edge (brand-share-bump)', () => {
    const geometry = layoutFixture('line', 'brand-share-bump');
    const starts = geometry.scene.filter((node: { t: string; id: string }) => node.t === 'text' && node.id.startsWith('label:series-start:'));
    // Seven brands start in the first period; Tarn starts later, alone beside its own line.
    const column = starts.filter((node: { align: string }) => node.align === 'end');
    expect(column).toHaveLength(7);
    expect(new Set(column.map((node: { x: number }) => node.x)).size).toBe(1);
  });

  // dimswitch/sheet wrapped its heads to "WEEK / 1" and cut them at the authored width while about 150 px of the card stayed bare.
  it('an authored column width that cuts its head takes free frame width first (dimswitch sheet)', () => {
    const geometry = layoutFixture('dimswitch', 'sheet');
    expect(geometry.warnings.map((warning: { code: string }) => warning.code)).not.toContain('table-column-clipped');
  });

  // On a broken value axis a phase area stopped at the axis floor and read as the value's size.
  it('phases on a broken axis draw as plot-height bands, not areas to the floor (option-phase-tones)', () => {
    const geometry = layoutFixture('line', 'option-phase-tones');
    const fills = geometry.scene.filter((node: { part?: string }) => node.part === 'phaseFill');
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      const ys = [...fill.d.matchAll(/[ML][\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
      expect(new Set(ys.map((y) => y.toFixed(1))).size).toBe(2);
    }
  });

  // Area fill On shrank the chart: the area's floor counted the CAGR band, header and category row as plot,
  // so its data plot was 37% shorter than the same chart drawn as lines.
  it('an area keeps the data plot height of its line (multiline-arr-endpoint-cagr)', () => {
    const fixture = getFixtures('line').find((f) => f.id === 'multiline-arr-endpoint-cagr')!;
    const dataPlot = (variant: string) => {
      const request = { type: 'line', data: structuredClone(fixture.data), options: { ...structuredClone(fixture.options ?? {}), variant, size: { width: 720 } } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
      return geometry.plot.h as number;
    };
    expect(Math.abs(dataPlot('area') / dataPlot('line') - 1)).toBeLessThanOrEqual(0.02);
  });

  // A callout seat was measured in the regular face while variance, slope and waterfall drew it bold,
  // so the text ran past its seat and covered the neighbouring label (a minus sign lost under it).
  it('a callout seat holds the text as it is drawn', () => {
    const categories = ['North', 'South', 'East', 'West'].map((label) => ({ id: label.toLowerCase(), label }));
    const text = 'Largest step since the restatement';
    const specs = [
      { type: 'variance', data: { categories, series: [{ id: 'act', label: 'Actual', values: [120, 95, 140, 88] }, { id: 'ref', label: 'Reference', values: [100, 100, 100, 100] }] },
        options: { variant: 'integrated', variance: { of: 'act', vs: 'ref' }, size: { width: 480 } }, annotations: [{ kind: 'callout', at: { categoryId: 'north', seriesId: 'act' }, text }] },
      { type: 'slope', data: { categories: categories.slice(0, 2), series: [{ id: 'a', label: 'Alpha', values: [10, 14] }, { id: 'b', label: 'Beta', values: [12, 9] }] },
        options: { size: { width: 720 } }, annotations: [{ kind: 'callout', at: { categoryId: 'south', seriesId: 'a' }, text }] },
      { type: 'waterfall', data: { items: [{ id: 'a', label: 'Start', type: 'total', value: 100 }, { id: 'b', label: 'Gain', value: 30 }, { id: 'c', label: 'Loss', value: -20 }, { id: 'd', label: 'End', type: 'total', value: 110 }] },
        options: { size: { width: 480 } }, annotations: [{ kind: 'callout', at: 'b', text }] },
    ];
    const tooNarrow = specs.filter((spec) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geometry = layoutResolvedRequest(resolveChartRequest(spec as any) as any) as any;
      const label = geometry.labels.find((l: { id: string }) => l.id.startsWith('annotation:'));
      const node = geometry.scene.find((n: { id: string }) => n.id === `label:${label.id}`);
      const drawn = Math.max(...node.lines.map((line: string) => measureText(line, node.font).width));
      return label.rect.w + 0.5 < drawn;
    }).map((spec) => spec.type);
    expect(tooNarrow).toEqual([]);
  });

  // The bold seat measure also widened an arrow callout and the body under a headline, which print plain, so a callout that fits was moved to the notes.
  it('an arrow callout and a headline body keep the plain face and their seat', () => {
    const text = 'Restated after the audit of the Q3 numbers';
    const categories = ['North', 'South', 'East', 'West'].map((label) => ({ id: label.toLowerCase(), label }));
    const specs = [
      { type: 'variance', data: { categories, series: [{ id: 'act', label: 'Actual', values: [120, 95, 140, 88] }, { id: 'ref', label: 'Reference', values: [100, 100, 100, 100] }] },
        options: { variant: 'integrated', variance: { of: 'act', vs: 'ref' }, size: { width: 440 } }, annotations: [{ kind: 'callout', at: { categoryId: 'north', seriesId: 'act' }, text, arrow: true }] },
      { type: 'waterfall', data: { items: [{ id: 'a', label: 'Start', type: 'total', value: 100 }, { id: 'b', label: 'Gain', value: 30 }, { id: 'c', label: 'Loss', value: -20 }, { id: 'd', label: 'End', type: 'total', value: 110 }] },
        options: { title: 'Bridge', size: { width: 480 } }, annotations: [{ kind: 'callout', at: 'b', text, headline: 'Largest step ${value}' }] },
    ];
    const seen = specs.map((spec) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geometry = layoutResolvedRequest(resolveChartRequest(spec as any) as any) as any;
      const label = geometry.labels.find((l: { id: string }) => l.id.startsWith('annotation:'));
      const node = geometry.scene.find((n: { id: string }) => n.id === `label:${label.id}:body`) ?? geometry.scene.find((n: { id: string }) => n.id === `label:${label.id}`);
      return { type: spec.type, hidden: label.hidden, weight: node.font.weight };
    });
    expect(seen).toEqual([{ type: 'variance', hidden: undefined, weight: 400 }, { type: 'waterfall', hidden: undefined, weight: 400 }]);
  });

  // A callout seated in the strip under the axis, on top of the 45° names: a name claimed only a square at its anchor.
  it('a callout does not seat on a rotated category name', () => {
    const categories = ['Umsatzerlöse', 'Niedersachsen', 'Licence income', 'Abschreibungen'].map((label, i) => ({ id: `c${i}`, label }));
    const values = [[4.7, 4.4, null, 5.4], [2.7, -2.7, -2.7, 2.5], [3.1, 3.2, null, 2.8], [3.6, 3.5, 3.4, -3.3], [4.5, -4.7, -4.3, -4.7], [-3.2, 3.6, 3.4, 3.3], [6.3, -5.7, 5.6, 5.5], [2.5, 2.7, 3, 3.1]];
    const series = values.map((row, s) => ({ id: `s${s}`, label: `Series ${s}`, values: row }));
    const request = { type: 'column', data: { categories, series }, options: { title: 'Revenue by unit', subtitle: { measure: 'Revenue by unit', period: 'FY26' }, unit: 'pp', source: 'Invented data', locale: { language: 'de', decimal: ',', thousands: '.' }, variant: 'stacked', labelDensity: 'full', size: { width: 320 } },
      annotations: [{ kind: 'callout', at: { categoryId: 'c0', seriesId: 's0' }, text: 'Largest step since the restatement', preferSide: 'right' }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const callout = geometry.labels.find((l: { id: string }) => l.id === 'annotation:callout-1');
    const onName = geometry.labels.filter((l: { kind: string; rotate?: number }) => l.kind === 'category' && l.rotate === -45).some((name: { id: string; rect: { x: number; y: number; w: number; h: number } }) => {
      const node = geometry.scene.find((n: { id: string }) => n.id === `label:${name.id}`);
      const length = Math.max(...node.lines.map((line: string) => measureText(line, node.font).width));
      const end = { x: name.rect.x + name.rect.w, y: name.rect.y + (node.font.size * 1.2 * Math.SQRT1_2) / 2 };
      return Array.from({ length: Math.ceil(length) }, (_, d) => ({ x: end.x - d * Math.SQRT1_2, y: end.y + d * Math.SQRT1_2 }))
        .some((p) => p.x > callout.rect.x && p.x < callout.rect.x + callout.rect.w && p.y > callout.rect.y && p.y < callout.rect.y + callout.rect.h);
    });
    expect(callout.hidden === undefined && onName).toBe(false);
  });

  // A callout on the first row of a narrow stacked bar was seated three rows down, with a long leader; it now sits within a row of its bar or goes to the notes.
  it('a bar callout seats within one row of its bar or goes to the notes', () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];
    const categories = names.map((label) => ({ id: label, label }));
    const request = { type: 'bar', data: { categories, series: [
      { id: 'a', label: 'Filled', values: [310, 240, 190, 74, 38, 62, 45, 30, 12] },
      { id: 'b', label: 'Open', values: [32, 14, 9, 6, 5, 6, 7, 4, 3] }] },
      options: { variant: 'stacked', grandTotalLabels: true, size: { width: 480 } },
      annotations: [{ kind: 'callout', at: 'Alpha', text: '8 of the 12 positions open for over 90 days' }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const byId = (id: string) => geometry.labels.find((l: { id: string }) => l.id === id);
    const callout = byId('annotation:callout-1');
    const [first, second] = [byId('category:Alpha'), byId('category:Bravo')];
    const pitch = second.rect.y - first.rect.y;
    const reach = callout.hidden === undefined ? Math.abs(callout.rect.y + callout.rect.h / 2 - (first.rect.y + first.rect.h / 2)) : 0;
    expect(reach).toBeLessThanOrEqual(pitch);
    // Beside a short bar with room to its right, the text wraps there and is drawn.
    const short = structuredClone(request);
    short.data.series[0]!.values = [20, 10, 20, 15, 38, 62, 45, 30, 100];
    short.options.size.width = 400;
    short.annotations[0]!.at = 'Bravo';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = (layoutResolvedRequest(resolveChartRequest(short as any) as any) as any).labels.find((l: { id: string }) => l.id === 'annotation:callout-1');
    expect(wrapped.hidden).toBeUndefined();
  });

  // A tall canvas widened the rotated names until the row had no pitch left for a 45° line, so all but one name were dropped.
  it('a tall variance chart keeps its rotated category names at 400 px wide', () => {
    const names = ['Nordrhein-Westfalen (Rheinland)', 'Net revenue retention, enterprise', 'Sonstige betriebliche Aufwendungen', 'Zinsen und ähnliche Aufwendungen', 'Aufwendungen für bezogene Waren', 'Schleswig-Holstein und Hamburg', 'Pensionsrückstellungen, Inland', 'Research and development expenses', 'Sonstige betriebliche Erträge', 'Fremdleistungen Logistik Ausland', 'Instandhaltung und Reparaturen', 'Mecklenburg-Vorpommern'];
    const categories = names.map((label, i) => ({ id: `c${i}`, label }));
    const request = { type: 'variance', data: { categories, series: [
      { id: 'act', label: 'Actual', values: [178, 173.7, 182.1, 193.8, 204.9, 223.9, 243.9, 224.9, 200, 195.7, 190, 172.6] },
      { id: 'ref', label: 'Prior year', role: 'reference', values: [145.6, 190.1, 165.5, 215.2, 245.5, 201.3, 221, 242.1, 190, 168.3, 180, 164.5] }] },
      options: { variant: 'integrated', variance: { of: 'act', vs: 'ref' }, size: { width: 400, height: 560 } },
      annotations: [{ kind: 'callout', at: { categoryId: 'c0', seriesId: 'act' }, text: 'Largest step since the restatement', preferSide: 'right' }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const drawn = geometry.labels.filter((l: { kind: string; hidden?: string }) => l.kind === 'category' && l.hidden === undefined).length;
    expect(drawn).toBe(names.length);
  });

  // A dot scatter reserved its y column for five round ticks but drew half-steps (5.5), so on a 280 pt slide the tick text started left of the canvas.
  it('scatter y ticks stay inside the canvas on a narrow slide', () => {
    const points = [[4, 3], [2, 5], [3, 5], [5, 2], [3, 4], [1, 5], [4, 4], [5, 1], [1, 3], [2, 2], [2, 4], [4, 1]]
      .map(([x, y], i) => ({ id: `p${i}`, label: `Risk ${i}`, x, y }));
    const request = {
      type: 'scatter',
      data: { points },
      options: { size: { width: 280, height: 396, unit: 'pt' }, title: 'T', unit: 'rating', axisTitles: { x: 'Likelihood', y: 'Impact' }, target: 'slide', quadrants: { x: { stat: 'median' }, y: { stat: 'median' } } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const ticks = geometry.scene.filter((node: { id?: string }) => String(node.id).startsWith('axis:y:tick:'));
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) expect(tick.x).toBeGreaterThanOrEqual(0);
  });

  // One long first name set the rotated-name cap for the whole row, so a name that fits its own seat was cut with it.
  it('a rotated name that fits its seat is not cut for a long name elsewhere', () => {
    const names = ['Rhein0', 'Pensionsrückstellungen, Inland1', 'Nordrhein-Westfalen (Rheinland)2', 'Zinsen und ähnliche Aufwendungen3', 'Instandhaltung und Reparaturen4', 'Mecklenburg-Vorpommern5', 'Research and development expenses6', 'Fremdleistungen Logistik Ausland7', 'Zinsen und ähnliche Aufwendungen8', 'Aufwendungen für bezogene Waren9'];
    const request = { type: 'variance', data: { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 'act', label: 'Actual', values: names.map((_, i) => 50 + i) }, { id: 'ref', label: 'Reference', role: 'reference', values: names.map(() => 52) }] },
      options: { variant: 'integrated', variance: { of: 'act', vs: 'ref' }, size: { width: 320, height: 480 } } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const node = geometry.scene.find((n: { id: string }) => n.id === 'label:category:c5');
    expect(node.lines).toEqual(['Mecklenburg-Vorpommern5']);
  });

  // A qualitative scatter wrapped its y title to four lines in a plot too short for it, so the title printed over the Higher and Lower end labels.
  it('a qualitative scatter plot too short for its y title drops the title and warns', () => {
    const points = [[4, 3], [2, 5], [3, 5], [5, 2]].map(([x, y], i) => ({ id: `p${i}`, label: `Case ${i}`, x, y }));
    const request = {
      type: 'scatter',
      data: { points },
      options: { size: { width: 300, height: 240, unit: 'pt' }, title: 'Cases that combine high value and low effort are the ones to start with now', subtitle: 'Matrix of use cases', qualitativeAxes: true, axisTitles: { x: 'Ease', y: 'Value impact of use case' }, footnotes: Array.from({ length: 4 }, (_, i) => `Note ${i + 1} is long enough to wrap onto several lines of the footer in a narrow chart.`), source: 'Illustrative data' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const ids = geometry.scene.map((node: { id?: string }) => String(node.id));
    expect(geometry.plot.h).toBeLessThan(80);
    expect(ids).toContain('axis:y:high');
    expect(ids).not.toContain('axis:y:title');
    expect(geometry.warnings.map((w: { code: string }) => w.code)).toContain('axis-title-dropped');
  });

  // The y arrows are drawn from the plot centre toward Higher and Lower also when no y axis title is set.
  it('a tall qualitative scatter without a y title keeps both y arrows', () => {
    const points = [[4, 3], [2, 5], [3, 5], [5, 2]].map(([x, y], i) => ({ id: `p${i}`, label: `Case ${i}`, x, y }));
    const request = {
      type: 'scatter',
      data: { points },
      options: { size: { width: 400, height: 300, unit: 'pt' }, title: 'T', qualitativeAxes: true, axisTitles: { x: 'Ease' } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const ids = geometry.scene.map((node: { id?: string }) => String(node.id));
    expect(ids).not.toContain('axis:y:title');
    expect(ids).toContain('axis:y:arrow-high');
    expect(ids).toContain('axis:y:arrow-low');
  });
  // A card that drops most value labels showed bare columns with no number and no scale to read them off.
  it('a column whose value labels drop draws the value axis unless valueAxis.show is false', () => {
    const cats = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, label: `Unit ${i + 1}` }));
    const request = (valueAxis?: { show: boolean }) => ({
      type: 'column',
      data: { categories: cats, series: [
        { id: 'a', label: 'North', values: cats.map((_, i) => (i % 4 === 1 ? 1000 : 750)) },
        { id: 'b', label: 'South', values: cats.map((_, i) => (i % 3 === 0 ? 1250 : 1500)) },
      ] },
      options: { target: 'dashboard', title: 'Revenue by unit', unit: 'EUR', format: '1.2bn', size: { width: 480 }, ...(valueAxis ? { valueAxis } : {}) },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticks = (r: unknown) => (layoutResolvedRequest(resolveChartRequest(r as any) as any) as any).scene.filter((n: { id?: string }) => String(n.id).startsWith('axis:y:tick:')).length;
    expect(ticks(request())).toBeGreaterThan(1);
    expect(ticks(request({ show: false }))).toBe(0);
  });

  // A grouped chart with thinned values needs no discarded label solve before it draws its axis.
  it('solves thinned grouped values only with the fallback axis', () => {
    const data = {
      categories: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `Category ${i + 1}` })),
      series: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, values: Array.from({ length: 12 }, (_, j) => 20 + i + j) })),
    };
    const solve = vi.spyOn(labelSolver, 'solveLabels');
    try {
      const options = { title: 'Values by category', size: { width: 480, height: 320 } };
      layoutColumn(data, { ...options, valueAxis: { show: true } });
      const withAxis = solve.mock.calls.length;
      solve.mockClear();
      const automatic = layoutColumn(data, options);
      expect(automatic.scene.some(node => node.id?.startsWith('axis:y:tick:'))).toBe(true);
      expect(solve.mock.calls.length).toBe(withAxis);
    } finally {
      solve.mockRestore();
    }
  });

  // Eight diverging panels on a wide slide sent five net scores to a note: "Netto +20,9 (+7,9)" was wider than a panel.
  it('a diverging slope prints every net score and defines the net once in the key', () => {
    const names = ['Subscription revenue, annual plans', 'Professional services, fixed price', 'Training and certification', 'Other revenue abroad',
      'Consulting and implementation', 'Maintenance and repair', 'Managed services and support', 'Enterprise software licences'];
    const series = names.map((label, i) => ({ id: `g${i}`, label, values: [53.85 - i * 4.3, 58.54 - i * 4.9], negative: [6.697 + i * 2.1, 16.82 + i * 1.7] }));
    const request = {
      type: 'slope',
      data: { categories: [{ id: 'fy24', label: 'FY24' }, { id: 'fy26', label: 'FY26' }], series },
      options: { title: 'T', target: 'slide', size: { width: 888, height: 396, unit: 'pt' }, locale: { language: 'de' }, variant: 'diverging', diverging: { labels: { positive: 'Besser', negative: 'Schlechter' } } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const nets = geometry.labels.filter((l: { id: string }) => /^total:g\d:net$/.test(l.id));
    expect(nets.filter((l: { hidden?: unknown }) => !l.hidden)).toHaveLength(8);
    const key = geometry.labels.find((l: { id: string }) => l.id === 'legend:net:0');
    expect(key && !key.hidden).toBe(true);
  });

  // An unsized sparkline with a title kept its 176 px card on slide, so the title wrapped one word a line and was cut.
  it('an unsized sparkline on slide is as wide as its title and keeps 320 px for a short one', () => {
    const request = (title: string) => ({
      type: 'sparkline',
      data: { values: [11.2, 11.6, 11.1, 12, 12.4, 12.1, 12.9, 13.4, 13.1] },
      options: { title, target: 'slide' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lay = (title: string) => layoutResolvedRequest(resolveChartRequest(request(title) as any) as any) as any;
    const long = lay('Orders climb into August and ease to 13.1k in September');
    expect(long.size.width).toBeGreaterThan(176);
    expect(long.frame.titleLines).toBe(1);
    expect(long.warnings.some((w: { code: string }) => w.code === 'frame-title-truncated')).toBe(false);
    expect(lay('Orders').size.width).toBe(320);
  });

  // At 176 px a framed sparkline wrapped its title and source word by word and its two end names touched; on a
  // 480 px dashboard card the line stayed in the 36 px tile band and read flat.
  it('a framed sparkline defaults to 320 px and a framed card from 320 px draws the scaled line band', () => {
    const request = (options: object) => ({
      type: 'sparkline',
      data: { values: [15.9, 14.5, 13.9, 13.4, 13.9, 14.2, 15.4, 16.1, 15.7, 15.4, 14.8, 15], labels: ['Jan 24', 'Feb 24', 'Mar 24', 'Apr 24', 'May 24', 'Jun 24', 'Jul 24', 'Aug 24', 'Sep 24', 'Oct 24', 'Nov 24', 'Dec 24'] },
      options: { endLabels: 'ends', valueLabel: 'last', ...options },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lay = (options: object) => layoutResolvedRequest(resolveChartRequest(request(options) as any) as any) as any;
    expect(lay({ source: 'Invented data' }).size.width).toBe(320);
    expect(lay({}).size.width).toBe(176);
    const card = lay({ title: 'Trend', target: 'dashboard', size: { width: 480 } });
    const old = lay({ title: 'Trend', target: 'dashboard', size: { width: 480, height: 158 } });
    expect(card.size.height).toBeGreaterThan(old.size.height + 40);
    expect(old.size.height).toBe(158);
  });

  // A framed sparkline has no axis, so it printed only its last value and its high: a line that fell below zero
  // never said so. valueLabel 'last' also prints the low, the first value and the reference; 'last-and-high' keeps the old pair.
  it('a framed sparkline names its low, first value and reference, and last-and-high keeps the old pair', () => {
    const request = (valueLabel: string) => ({
      type: 'sparkline',
      data: { values: [-2.7, 2.6, -2.5, 2.55, 2.7, 2.9, 2.7, 2.6, -2.7, 3.0, -2.9, 2.88] },
      options: { title: 'Trend', size: { width: 520 }, valueLabel, reference: 1 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = (valueLabel: string) => (layoutResolvedRequest(resolveChartRequest(request(valueLabel) as any) as any) as any).labels
      .filter((l: { hidden?: unknown }) => !l.hidden).map((l: { id: string }) => l.id);
    expect(ids('last')).toEqual(expect.arrayContaining(['spark:last', 'spark:high', 'spark:low', 'spark:first', 'spark:referenceValue']));
    expect(ids('last-and-high')).toEqual(expect.arrayContaining(['spark:last', 'spark:high']));
    expect(ids('last-and-high').some((id: string) => /low|first|referenceValue/.test(id))).toBe(false);
  });

  // A bar row name stopped at three lines and was cut with an ellipsis although its row held a fourth line.
  it('a bar name that would be cut at three lines takes a fourth when the row holds it', () => {
    const request = {
      type: 'bar',
      data: { categories: [
        { id: 'a', label: 'Customers who cancelled within the first ninety days after a price change and who named the new billing cycle as the main reason' },
        { id: 'b', label: 'Renewals' },
        { id: 'c', label: 'New sign-ups' },
      ], series: [{ id: 's', label: 'Share', values: [32, 51, 44] }] },
      options: { title: 'Cancellation reasons', size: { width: 360, height: 300, unit: 'pt' } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    const name = geometry.labels.find((l: { id: string }) => l.id === 'category:a');
    expect(name.title).toBeUndefined();
    expect(name.lines).toHaveLength(4);
  });

  // The fourth line counted a row as the canvas over the row count, but a gap after a row takes steps of its own,
  // so the chart minimum passed the pinned height and the size was refused where the chart drew before.
  it('a fourth name line does not push a chart with gapAfter rows over its pinned height', () => {
    const long = 'Customers who cancelled within the first ninety days after a price change and who named the new billing cycle as the main reason';
    const request = {
      type: 'bar',
      data: { categories: [
        { id: 'a', label: long, gapAfter: true },
        { id: 'b', label: 'Renewals', gapAfter: true },
        { id: 'c', label: 'New sign-ups', gapAfter: true },
        { id: 'd', label: 'Upgrades' },
      ], series: [{ id: 's', label: 'Share', values: [32, 51, 44, 27] }] },
      options: { title: 'Cancellation reasons', size: { width: 360, height: 260, unit: 'pt' } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(canDraw(request as any)).toMatchObject({ ok: true });
  });

  // A fixed 28 px row floor refused a 12-row board on a full slide, where a row name needs about 24 px.
  it('a 12-row status board draws on a full slide', () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const request = {
      type: 'status',
      data: {
        rows: ids.map((id) => ({ id: `r${id}`, label: `Workstream ${id}` })),
        columns: ids.map((id) => ({ id: `c${id}`, label: `Week ${id}` })),
        cells: ids.flatMap((r) => ids.map((c) => ({ row: `r${r}`, col: `c${c}`, state: (Number(r) + Number(c)) % 3 ? 'g' : 'r' }))),
      },
      options: { title: 'Delivery status', states: [{ id: 'g', label: 'On track', tone: 'good' }, { id: 'r', label: 'Off track', tone: 'bad' }], target: 'slide', size: { width: 888, height: 396, unit: 'pt' } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(canDraw(request as any)).toMatchObject({ ok: true });
  });

  // The pyramid charged every row a full line box for names and values, so a 21-band pyramid
  // was refused on a full slide. A pinned row now charges the ink of its text and steps its type once.
  it('a 21-band pyramid draws every label on a full slide', () => {
    const bands = Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, from: i * 5, to: i * 5 + 5, label: `${i * 5}-${i * 5 + 4}` }));
    const request = {
      type: 'pyramid',
      data: {
        bands,
        groups: [
          { id: 'a', label: 'Men', values: bands.map((_, i) => 1000 + i * 20) },
          { id: 'b', label: 'Women', values: bands.map((_, i) => 1500 + i * 30) },
        ],
      },
      options: { title: 'Structure by band', target: 'slide', size: { width: 888, height: 396, unit: 'pt' } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(canDraw(request as any)).toMatchObject({ ok: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geometry = layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    expect(geometry.labels.filter((l: { hidden?: unknown }) => l.hidden !== undefined)).toEqual([]);
  });
  // labelDensity 'full' on a status board dropped every cell name without a word at phone width, so the
  // reader got a board that ignored the request. The names now step down the type scale first, and
  // names that still do not fit warn and appear in the omissions.
  it('a status board with labelDensity full steps its names down, then names the ones it cannot draw', () => {
    const board = (width: number) => {
      const fixture = getFixtures('status').find((f) => f.id === 'programme-rollout-rag')!;
      const request = { type: 'status', data: structuredClone(fixture.data), options: { ...structuredClone(fixture.options ?? {}), labelDensity: 'full', target: 'dashboard', size: { width } } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return layoutResolvedRequest(resolveChartRequest(request as any) as any) as any;
    };
    const names = (g: { labels: { id: string; hidden?: unknown }[] }) => g.labels.filter((l) => l.id.startsWith('stateName:') && l.hidden);
    const narrow = board(358);
    expect(names(narrow).length).toBeGreaterThan(0);
    expect(narrow.warnings.some((w: { code: string; severity: string }) => w.code === 'label-hidden' && w.severity === 'warn')).toBe(true);
    // A width where the full-size names do not fit but the one smaller type step does.
    const stepped = board(500);
    expect(names(stepped)).toEqual([]);
    expect(stepped.labels.filter((l: { id: string; hidden?: unknown }) => l.id.startsWith('state:') && !l.hidden).length).toBeGreaterThan(0);
  });
});
