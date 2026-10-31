import { describe, expect, it } from 'vitest';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, renderSvg, resolveChartRequest } from '../src/index';
import { contrastRatio } from '../src/core/color';
import { resolveTheme } from '../src/core/theme';

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
});
