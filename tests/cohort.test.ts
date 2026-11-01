/**
 * Cohort. The rejected shapes live here rather than in fixtures.ts: a
 * throwing fixture would break the invariant sweep, which runs every
 * registered fixture automatically.
 */

import { getFixtures } from '../src/fixtures';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutCohort } from '../src/core/charts/cohort/layout';
import { withEngineNotes } from '../src/core/notes';
import { formatNumber } from '../src/core/format';
import { AVERAGE_ROW_ID } from '../src/core/charts/cohort/retention';
import type { CohortData, CohortDerived, CohortMarks, CohortOptions } from '../src/core/charts/cohort/types';
import { NormalizeError } from '../src/core/normalize/shared';
import { getChartDefinition } from '../src/core/registry';
import { renderSvg } from '../src/core/svg/renderSvg';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { resolveTheme } from '../src/core/theme';
import type { Geometry } from '../src/core/types/scene';

const definition = getChartDefinition('cohort')!;

/** Two cohorts, a clean staircase — the shape every refusal test mutates. */
function clean(): CohortData {
  return {
    periodLabel: 'Month',
    cohorts: [
      { id: 'a', label: 'Jan', active: [1000, 600, 420, 300] },
      { id: 'b', label: 'Feb', active: [800, 520, 380] },
      { id: 'c', label: 'Mar', active: [500, 350] },
    ],
  };
}

function layout(data: CohortData, options: CohortOptions = {}): Geometry<CohortMarks, CohortDerived> {
  return withEngineNotes(() => layoutCohort(data, options));
}

// An authored cohort-total row must not share scene or label IDs with the computed total.
it('keeps authored cohort IDs distinct from the computed total in both exhibits', () => {
  const data = clean();
  data.cohorts[0]!.id = 'cohort-total';
  data.cohorts[1]!.id = '_cohort-total';
  for (const variant of ['pure', 'stepped'] as const) {
    const result = layout(data, { variant, total: 'weighted', size: { width: 960 } });
    for (const list of [result.scene, result.labels]) {
      expect(new Set(list.map(node => node.id)).size).toBe(list.length);
    }
    expect(result.derived.cohorts.map(row => row.id)).toEqual(['cohort-total', '_cohort-total', 'c']);
    expect(result.scene.some(node => node.id.includes('__cohort-total'))).toBe(true);
    const fills = (geometry: typeof result) => geometry.scene.flatMap(node => node.t === 'rect' && (node.part === 'cohortCell' || node.part === 'cohortTotalCell') ? [node.fill] : []);
    expect(fills(result)).toEqual(fills(layout(clean(), { variant, total: 'weighted', size: { width: 960 } })));
  }
});

function throwsWith(fn: () => unknown): NormalizeError {
  try {
    fn();
  } catch (error) {
    if (error instanceof NormalizeError) return error;
    throw error;
  }
  throw new Error('expected a NormalizeError, nothing was thrown');
}

/** renderSvg takes the erased Geometry; the cast is only to drop the generics. */
function svg(geometry: Geometry<CohortMarks, CohortDerived> | Geometry): string {
  return renderSvg(geometry as unknown as Geometry, resolveTheme(undefined));
}

/** What the reader gets: the drawn text and the notes list under the chart. */
function readerText(geometry: Geometry<CohortMarks, CohortDerived>, separator = ' '): string {
  return [...geometry.scene.flatMap((n) => (n.t === 'text' ? [n.lines.join(' ')] : [])),
    ...(geometry.frame.noteList ?? []).map((note) => note.text)].join(separator);
}

function codes(geometry: Geometry<CohortMarks, CohortDerived>): string[] {
  return geometry.warnings.map((warning) => warning.code);
}

// A cohort exclusion must tell the reader which data was removed, even when ordinary footnotes are off.
it('discloses the running cohort and last observations removed by exclusion', () => {
  const data = clean();
  data.cohorts.push({ id: 'd', label: 'Apr', active: [300] });
  const options: CohortOptions = { target: 'report', variant: 'stepped', excludeCurrentPeriod: true, footnotes: false, notes: { show: ['note', 'disclosure'] }, size: { width: 960 } };
  const shown = layout(data, options);
  const note = shown.frame.noteList?.find(n => n.text.startsWith('Excluded: running period.'));
  expect(note).toMatchObject({ kind: 'disclosure', inFrame: true });
  expect(note!.text).toContain('Apr');
  expect(note!.text).toContain('last observation');
  const footer = shown.scene.filter(n => n.t === 'text' && shown.frame.footnoteNodeIds?.includes(n.id)).map(n => n.t === 'text' ? n.lines.join(' ') : '').join(' ');
  expect(footer).toContain(note!.text);
  const kept = layout(data, { ...options, excludeCurrentPeriod: false });
  expect(kept.frame.noteList?.some(n => n.text.startsWith('Excluded: running period.'))).toBe(false);
});

// A non-German exclusion note must stay visible once when its identical authored copy belongs to a list.
it('keeps one English exclusion disclosure for the den language tag', () => {
  const note = 'Excluded: running period. Cohort Mar; last observation of each earlier cohort.';
  const shown = layout(clean(), { target: 'report', variant: 'pure', excludeCurrentPeriod: true,
    locale: { language: 'den' }, footnotes: [note], notes: { placement: 'list', show: ['note', 'disclosure'] }, size: { width: 960 } });
  const exclusions = shown.frame.noteList?.filter(n => /^(Excluded: running period|Ausgeschlossen: laufende Periode)/.test(n.text));
  expect(exclusions).toHaveLength(1);
  expect(exclusions![0]).toMatchObject({ text: note, kind: 'disclosure', inFrame: true });
  const drawn = shown.scene.flatMap(node => node.t === 'text' && shown.frame.footnoteNodeIds?.includes(node.id) ? node.lines : []).join(' ');
  expect(drawn).toContain(note);
});

// A row name too long for the band is cut before its cohort size, never the size (table row labels).
it('draws every cohort size whole when the row names are cut', () => {
  const fixture = getFixtures('cohort').find(f => f.id === 'retention-24x24-resurrection')!;
  for (const width of [320, 400, 472]) {
    const shown = layout(fixture.data as CohortData, { ...fixture.options as CohortOptions, target: 'report', size: { width, height: 1000 } });
    const drawn = shown.labels.flatMap(label => label.hidden ? [] : [label.lines.join(' ')]);
    const sizes = drawn.flatMap(text => text.match(/\(n = [\d,]+\)/g) ?? []);
    expect(sizes, `${width} px`).toEqual(shown.derived.cohorts.map(row => `(n = ${row.base.toLocaleString('en-US')})`));
  }
});

// A cohort exhibit on a 280 px phone card refused (it needed 528 px); its compact form draws there and names each period it leaves out.
it('draws the exhibit forms on a phone card and names the periods left out', () => {
  const at280 = (id: string, kept: number[], hidden: string[]) => {
    const fixture = getFixtures('cohort').find(f => f.id === id)!;
    const { size: _size, ...options } = fixture.options as CohortOptions;
    const shown = layoutResolvedRequest(resolveChartRequest({ type: 'cohort', data: fixture.data, options: { ...options, size: { width: 280 } } })) as unknown as Geometry<CohortMarks, CohortDerived>;
    expect(shown.refused, id).toBeFalsy();
    expect(shown.derived.visiblePeriods, id).toEqual(kept);
    expect(shown.labels.filter(label => label.id.startsWith('cohort-') && label.hidden), id).toEqual([]);
    expect(shown.frame.noteList?.map(note => note.text).filter(text => /not shown/i.test(text)), id).toEqual(hidden);
  };
  at280('retention-stepped-content', [1, 2, 3], ['M0 not shown: 100% of every cohort by definition.']);
  at280('crowded-average-bases', [1, 2], ['M0 not shown: 100% of every cohort by definition.', 'Not shown for space: M3–M7.']);
});

describe('cohort — shapes that make a triangle misleading are refused', () => {
  it('refuses a zero base: retention would be a division by zero', () => {
    const data = clean();
    data.cohorts[1]!.active = [0, 0, 0];
    const error = throwsWith(() => layout(data));
    expect(error.code).toBe('cohort-zero-base');
    expect(error.message).toContain("'Feb'");
    expect(error.path).toBe('cohorts[1].active[0]');
  });

  it('refuses a declared size that disagrees with the period-0 count, quoting both', () => {
    const data = clean();
    data.cohorts[0]!.size = 1100;
    const error = throwsWith(() => layout(data));
    expect(error.code).toBe('cohort-base-mismatch');
    expect(error.message).toContain('1100');
    expect(error.message).toContain('1000');
  });

  it('accepts a declared size that agrees, and still derives the base from the counts', () => {
    const data = clean();
    data.cohorts[0]!.size = 1000;
    expect(layout(data).derived.cohorts[0]!.base).toBe(1000);
  });

  // A missing count must leave a rate unknown instead of refusing the whole chart.
  it('keeps a hole inside an observed span as a missing rate', () => {
    const data = clean();
    (data.cohorts[0]!.active as (number | null)[])[2] = null;
    expect(layout(data as CohortData).derived.cohorts[0]!.retention).toEqual([1, 0.6, null, 0.3]);
  });

  it('refuses an inverted staircase, naming the offending pair', () => {
    const data = clean();
    data.cohorts[2]!.active = [500, 350, 300, 260, 200];
    const error = throwsWith(() => layout(data));
    expect(error.code).toBe('cohort-shape-invalid');
    expect(error.message).toContain("'Mar'");
    expect(error.message).toContain("'Feb'");
  });

  it('refuses a single cohort and points at the chart that answers it', () => {
    const error = throwsWith(() => layout({ cohorts: [{ id: 'a', active: [10, 5] }] }));
    expect(error.code).toBe('cohort-too-few');
    expect(error.suggest).toContain("'line'");
  });

  it('refuses duplicate cohort ids and the reserved average-row id', () => {
    const duplicate = clean();
    duplicate.cohorts[1]!.id = 'a';
    expect(throwsWith(() => layout(duplicate)).code).toBe('cohort-duplicate-id');
    const reserved = clean();
    reserved.cohorts[0]!.id = AVERAGE_ROW_ID;
    expect(throwsWith(() => layout(reserved)).code).toBe('cohort-duplicate-id');
  });

  it('accepts null but rejects negative and fractional counts at the document schema', () => {
    for (const bad of [null, -3, 4.5]) {
      const data = clean();
      (data.cohorts[0]!.active as unknown[])[1] = bad;
      if (bad === null) {
        expect(() => definition.normalize(data)).not.toThrow();
        continue;
      }
      const error = throwsWith(() => definition.normalize(data));
      expect(error.code, String(bad)).toBe('invalid-data');
      expect(error.path, String(bad)).toBe('cohorts.0.active.1');
    }
    expect(() => definition.normalize(clean())).not.toThrow();
  });
});

describe('cohort — retention arithmetic', () => {
  // A missing count must print a dash and must not turn into zero or a partial total.
  it('prints a missing count as a dash and leaves the rates and totals that need it unknown', async () => {
    const { claimsForChart } = await import('../src/core/claims');
    const data: CohortData = { cohorts: [
      { id: 'a', active: [100, null, 50, 40] },
      { id: 'b', active: [100, 60, 30] },
      { id: 'c', active: [100, 0, null] },
    ] };
    for (const basis of ['cohort', 'previous'] as const) {
      const geometry = layout(definition.normalize(data), { basis, variant: 'pure', size: { width: 900 } });
      expect(geometry.derived.cohorts[0]!.retention).toEqual(basis === 'cohort' ? [1, null, 0.5, 0.4] : [1, null, null, 0.8]);
      expect(geometry.derived.total!.retention).toEqual(basis === 'cohort' ? [1, null, null, 0.4] : [1, null, null, 0.8]);
      expect(geometry.labels.find(label => label.id === 'cohort-cell:a:t1')!.lines).toEqual(['—']);
      expect(geometry.labels.some(label => label.id === 'cohort-cell:b:t3')).toBe(false);
      expect(claimsForChart('cohort', geometry as never).find(claim => claim.id === 'cohort:a:t1')!.output).toMatchObject({ raw: null, state: 'missing' });
    }
  });

  it('computes base-relative retention against a hand-computed reference', () => {
    const derived = layout(clean()).derived;
    expect(derived.basis).toBe('cohort');
    expect(derived.cohorts[0]!.retention).toEqual([1, 600 / 1000, 420 / 1000, 300 / 1000]);
    expect(derived.cohorts[1]!.retention).toEqual([1, 520 / 800, 380 / 800]);
    expect(derived.cohorts[2]!.retention).toEqual([1, 350 / 500]);
    expect(derived.maxRetention).toBe(1);
    expect(derived.periodCount).toBe(4);
  });

  it('computes period-over-period survival against a hand-computed reference', () => {
    const derived = layout(clean(), { basis: 'previous' }).derived;
    expect(derived.basis).toBe('previous');
    expect(derived.cohorts[0]!.retention).toEqual([1, 600 / 1000, 420 / 600, 300 / 420]);
    expect(derived.cohorts[1]!.retention).toEqual([1, 520 / 800, 380 / 520]);
  });

  it('carries the unrounded ratio and both counts, whatever the display rounds to', () => {
    const data: CohortData = {
      cohorts: [
        { id: 'a', active: [3, 1] },
        { id: 'b', active: [7] },
      ],
    };
    const geometry = layout(data);
    expect(geometry.derived.cohorts[0]!.retention[1]).toBe(1 / 3);
    expect(geometry.derived.cohorts[0]!.active).toEqual([3, 1]);
    expect(geometry.derived.cohorts[0]!.base).toBe(3);
    const cell = geometry.marks.cells.find((c) => c.rowId === 'a' && c.periodIndex === 1)!;
    const node = geometry.scene.find((n) => n.id === cell.nodeId)!;
    expect(node.display).toEqual({ value: '33%' });
  });

  it('marks 0/0 as not meaningful instead of 0%, for that cell and the rest of the row', () => {
    const data: CohortData = {
      cohorts: [
        { id: 'a', active: [100, 0, 0, 0] },
        { id: 'b', active: [80, 40, 20] },
      ],
    };
    const geometry = layout(data, { basis: 'previous' });
    expect(geometry.derived.cohorts[0]!.retention).toEqual([1, 0, null, null]);
    expect(codes(geometry)).toContain('cohort-nm-cells');
    const nm = geometry.marks.cells.find((c) => c.rowId === 'a' && c.periodIndex === 2)!;
    const node = geometry.scene.find((n) => n.id === nm.nodeId)!;
    expect(node.display).toEqual({ state: 'n.m.' });
  });

  it('distinguishes an unobserved cell from a not-meaningful one in the display truth', () => {
    const geometry = layout(clean());
    const unobserved = geometry.marks.cells.find((c) => c.rowId === 'c' && c.periodIndex === 3)!;
    const node = geometry.scene.find((n) => n.id === unobserved.nodeId)!;
    expect(node.display).toEqual({ state: 'Not yet reached' });
  });

  it('keys its shading on the pinned 0–100% ramp, and names the grey base column ', () => {
    const geometry = layout(clean());
    const keys = geometry.scene.filter((node) => node.t === 'text' && node.part === 'legendLabel').flatMap((node) => (node.t === 'text' ? node.lines : []));
    const full = geometry.scene.find((node) => node.t === 'rect' && node.part === 'swatch' && node.owner.seriesId === 'scale:100');
    expect({ keys, full: full?.t === 'rect' ? full.fill : undefined })
      .toEqual({ keys: ['0%', '25%', '50%', '75%', '100%', 'M0 base'], full: { token: 'series-1', theme: { kind: 'series', index: 0 }, tint: 0 } });
    // legend 'none' drops the key for a host that draws its own.
    const hidden = layout(clean(), { legend: 'none' });
    expect([hidden.legend, hidden.warnings.some((w) => w.code === 'cohort-legend-required')]).toEqual([undefined, false]);
  });
});

describe('cohort — the weighted average is not the mean of the percentages', () => {
  // Big cohorts retain worse than small ones: the two numbers must diverge.
  const data: CohortData = {
    cohorts: [
      { id: 'big', active: [4000, 1600, 800] },
      { id: 'mid', active: [1000, 700] },
      { id: 'small', active: [100] },
    ],
  };

  it('divides total active by total base, never averaging the rates', () => {
    const derived = layout(data, { averages: 'weighted' }).derived;
    const averages = derived.averages!;
    expect(averages[1]!.value).toBe((1600 + 700) / (4000 + 1000));
    const meanOfPercentages = (1600 / 4000 + 700 / 1000) / 2;
    expect(averages[1]!.value).toBeCloseTo(0.46, 10);
    expect(meanOfPercentages).toBeCloseTo(0.55, 10);
    expect(averages[1]!.value).not.toBeCloseTo(meanOfPercentages, 3);
  });

  it('averages only over the cohorts that reach the period, and says the support shrinks', () => {
    const geometry = layout(data, { averages: 'weighted' });
    expect(geometry.derived.averages!.map((a) => a.support)).toEqual([3, 2, 1]);
    expect(geometry.derived.averages![2]!.value).toBe(800 / 4000);
    expect(codes(geometry)).toContain('cohort-average-unequal-support');
    expect(
      geometry.warnings.filter((w) => w.code === 'cohort-average-unequal-support').length,
    ).toBe(1);
  });

  it('puts the contributing cohort count on the average cell as display state', () => {
    const geometry = layout(data, { averages: 'weighted' });
    const cell = geometry.marks.cells.find(
      (c) => c.kind === 'average' && c.periodIndex === 1,
    )!;
    const node = geometry.scene.find((n) => n.id === cell.nodeId)!;
    expect(node.display?.state).toBe('2 cohorts');
    expect(node.display?.value).toBe('46%');
  });

  it('weights period-over-period survival on the previous period, not on the base', () => {
    const derived = layout(data, { averages: 'weighted', basis: 'previous' }).derived;
    expect(derived.averages![1]!.value).toBe((1600 + 700) / (4000 + 1000));
    expect(derived.averages![2]!.value).toBe(800 / 1600);
  });

  it('emits no averages at all by default', () => {
    expect(layout(data).derived.averages).toBeUndefined();
    expect(layout(data).marks.cells.some((c) => c.kind === 'average')).toBe(false);
  });
});

describe('cohort — a cell the reader cannot see never votes in the average under it', () => {
  // Jan loses every survivor at period 2 and picks members up again after; on
  // basis 'previous' its whole tail is n.m., because a rate measured against a
  // period with no survivors is not a rate. Those blanks are the trap: the mean
  // of percentages is gone, but a denominator that still holds invisible cells
  // publishes a percentage for a period the exhibit shows nothing for.
  const recovering: CohortData = {
    periodLabel: 'Month',
    cohorts: [
      { id: 'jan', label: 'Jan', active: [100, 50, 0, 5, 3] },
      { id: 'feb', label: 'Feb', active: [200, 120, 60] },
      { id: 'mar', label: 'Mar', active: [300, 180] },
    ],
  };

  it('drops a blank cell from the support set instead of counting it', () => {
    const geometry = layout(recovering, { basis: 'previous', averages: 'weighted' });
    const averages = geometry.derived.averages!;
    // t4: 'jan' is the only cohort that reaches it, and its own cell is BLANK.
    // Counting it published 3/5 = 60% for a period with nothing on the page.
    expect(geometry.derived.cohorts[0]!.retention[4]).toBeNull();
    expect(averages[4]!.support).toBe(0);
    expect(averages[4]!.contributors).toEqual([]);
    expect(averages[4]!.value).toBeNull();
  });

  it('leaves an unsupported period blank rather than printing 0%', () => {
    const geometry = layout(recovering, { basis: 'previous', averages: 'weighted' });
    expect(geometry.derived.averages![3]!.value).toBeNull();
    const cell = geometry.marks.cells.find((c) => c.kind === 'average' && c.periodIndex === 3)!;
    expect(cell.retention).toBeNull();
    const node = geometry.scene.find((n) => n.id === cell.nodeId)!;
    expect(node.display?.value).toBeUndefined();
    expect(node.display?.state).toBe('No contributing cohort');
    expect(codes(geometry)).toContain('cohort-average-unsupported');
  });

  it('states the empty periods to the reader, not only in the warning stream', () => {
    const notes = readerText(layout(recovering, { basis: 'previous', averages: 'weighted' }));
    // The word has to name the mark: the unsupported average is painted with
    // the same hatch as an unmeasurable cell, so 'blank' described ink that is
    // not there.
    expect(notes).toContain('hatched there, not 0%');
    expect(notes).toContain('M3');
    expect(notes).not.toContain('blank there');
  });

  it('keeps every contributing cohort on the support set it does have', () => {
    const averages = layout(recovering, { basis: 'previous', averages: 'weighted' }).derived
      .averages!;
    expect(averages[2]!.contributors).toEqual(['jan', 'feb']);
    expect(averages[2]!.value).toBe((0 + 60) / (50 + 120));
  });
});

describe('cohort — the computed row is not a cohort, and says how thin it is', () => {
  const thinning: CohortData = {
    periodLabel: 'Month',
    cohorts: [
      { id: 'big', active: [4000, 1600, 800] },
      { id: 'mid', active: [1000, 700] },
      { id: 'small', active: [100] },
    ],
  };

  it('carries the shrinking support range in its own row label', () => {
    const geometry = layout(thinning, { averages: 'weighted' });
    const label = geometry.labels.find((l) => l.id === `series:${AVERAGE_ROW_ID}`)!;
    expect(label.hidden).toBeFalsy();
    expect(label.lines.join(' ')).toContain('3 to 1 cohorts');
    expect(codes(geometry)).not.toContain('cohort-average-support-truncated');
  });

  it('rides a different ramp from the cohort rows so a summary never reads as data', () => {
    const geometry = layout(thinning, { averages: 'weighted' });
    const paintOf = (rowId: string, t: number): unknown =>
      (geometry.scene.find((n) => n.id === `cell:${rowId}:t${t}`) as { fill?: unknown }).fill;
    expect(paintOf(AVERAGE_ROW_ID, 1)).toEqual({ token: 'neutralMark', tint: expect.any(Number) });
    expect(paintOf('big', 1)).toEqual({ token: 'series-1', theme: { kind: 'series', index: 0 }, tint: expect.any(Number) }); // the ramp is tints of series 1
  });

  it('names the per-period support to the reader', () => {
    const notes = readerText(layout(thinning, { averages: 'weighted' }));
    expect(notes).toContain('Cohorts behind each average: 3 at M0, 1 at M2.');
  });
});

describe('cohort — the ink says which blank is which, and where the ramp is anchored', () => {
  const paintOf = (geometry: Geometry<CohortMarks, CohortDerived>, id: string): unknown =>
    (geometry.scene.find((n) => n.id === id) as { fill?: unknown }).fill;

  it('separates "not meaningful" from "not yet reached"', () => {
    const geometry = layout(
      {
        periodLabel: 'Month',
        cohorts: [
          { id: 'a', label: 'A', active: [100, 0, 40] },
          { id: 'b', label: 'B', active: [80, 50] },
        ],
      },
      { basis: 'previous' },
    );
    // a@t2 is n.m. (the previous period had no survivors); b@t2 is the future.
    expect(geometry.derived.cohorts[0]!.retention[2]).toBeNull();
    const notMeaningful = paintOf(geometry, 'cell:a:t2');
    const notReached = paintOf(geometry, 'cell:b:t2');
    expect(notMeaningful).not.toEqual(notReached);
    expect(notReached).toEqual({ token: 'background' });
    expect(notMeaningful).toEqual({ token: 'neutral', tint: 0.55 });
    expect((geometry.scene.find((n) => n.id === 'cell:a:t2') as { pattern?: string }).pattern).toBe(
      'hatch45',
    );
    expect((geometry.scene.find((n) => n.id === 'cell:b:t2') as { pattern?: string }).pattern).toBeUndefined();
  });

  it('pins the ramp at 100% so one cell above its base cannot repaint the exhibit', () => {
    const calm = layout({
      cohorts: [
        { id: 'a', active: [100, 60, 30] },
        { id: 'b', active: [80, 50] },
      ],
    });
    const spike = layout({
      cohorts: [
        { id: 'a', active: [100, 60, 30] },
        { id: 'b', active: [80, 130] },
      ],
    });
    expect(spike.warnings.map((w) => w.code)).toContain('cohort-above-base');
    // Same rate, same ink: the anomaly moves nothing but its own cell.
    expect(paintOf(spike, 'cell:a:t1')).toEqual(paintOf(calm, 'cell:a:t1'));
    expect(spike.derived.maxRetention).toBe(1.625);
    // A cell above its own base clamps to full ink rather than becoming the
    // new anchor everything else is measured paler against.
    expect(paintOf(spike, 'cell:b:t1')).toEqual({ token: 'series-1', theme: { kind: 'series', index: 0 }, tint: 0 });
  });

  it('paints period 0 as furniture, not as the darkest thing on the page', () => {
    const geometry = layout(clean());
    const anchor = paintOf(geometry, 'cell:a:t0') as { token: string; tint: number };
    expect(anchor.token).toBe('neutral');
    // A 60% cell must out-ink the 100%-by-definition column.
    const cell = paintOf(geometry, 'cell:a:t1') as { token: string; tint: number };
    expect(cell.token).toBe('series-1');
    expect(anchor.tint).toBeGreaterThan(cell.tint);
    // the anchor column is explained on request.
    const notes = layout(clean(), { methodNote: true, notes: { show: ['note', 'disclosure', 'method'] } }).scene
      .filter((n) => n.t === 'text')
      .flatMap((n) => (n.t === 'text' ? n.lines : []))
      .join(' ');
    expect(notes).toContain('M0 is 100% by definition');
    expect(notes).toContain('grey anchor column');
  });

  it('tells the reader on the exhibit when a number was too small to print', () => {
    const wide: CohortData = {
      periodLabel: 'Week',
      cohorts: Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        label: `Cohort ${i}`,
        active: Array.from({ length: 20 - i }, (_, t) => 5000 - i * 100 - t * 200),
      })),
    };
    const cramped = layout(wide, { notes: { show: ['note', 'disclosure', 'method'] }, size: { width: 420, height: 300 } });
    const notes = cramped.scene
      .filter((n) => n.t === 'text')
      .flatMap((n) => (n.t === 'text' ? n.lines : []))
      .join(' ');
    expect(codes(cramped)).toContain('cohort-values-suppressed');
    expect(notes).toContain('read from colour alone');
    const roomy = layout(wide, { notes: { show: ['note', 'disclosure', 'method'] }, size: { width: 1400, height: 800 } });
    expect(codes(roomy)).not.toContain('cohort-values-suppressed');
    expect(
      roomy.scene
        .filter((n) => n.t === 'text')
        .flatMap((n) => (n.t === 'text' ? n.lines : []))
        .join(' '),
    ).not.toContain('read from colour alone');
  });

  it('counts the loss in the ink instead of calling every rate "some"', () => {
    // A 720x405 canvas pinned by the author (an unsized cohort now grows to
    // its rows), 16 cohorts and the computed row: every rate
    // on the exhibit is lost, and the note must count them, not say "some cells".
    const many: CohortData = {
      periodLabel: 'Month',
      cohorts: Array.from({ length: 16 }, (_, i) => ({
        id: `c${i}`,
        label: `Cohort ${i + 1} 2025`,
        active: Array.from({ length: 16 - i }, (_, t) => Math.round((1200 + i * 20) * 0.93 ** t)),
      })),
    };
    const geometry = layout(many, { averages: 'weighted', title: 'Retention holds', notes: { show: ['note', 'disclosure', 'method'] }, size: { width: 720, height: 405 } });
    expect(geometry.size).toEqual({ width: 720, height: 405 });
    const notes = geometry.scene
      .filter((n) => n.t === 'text')
      .flatMap((n) => (n.t === 'text' ? n.lines : []))
      .join(' ');
    const warning = geometry.warnings.find((w) => w.code === 'cohort-values-suppressed')!;
    const measured = /^(\d+) of (\d+) cells/.exec(warning.message)!;
    // Every rate is gone, the note says so, and the count it prints is the
    // count the layout that printed it measured — not a stale pass-1 number.
    expect(measured[1]).toBe(measured[2]);
    expect(notes).toContain(`all ${measured[2]} rates read from colour alone`);
    expect(notes).not.toContain('Some cells are too narrow');

    // The partial case names both halves, and the printed numerator is the
    // measured one, so the reader can tell how much of the grid is colour only.
    const partial = layout(many, { notes: { show: ['note', 'disclosure', 'method'] }, size: { width: 900, height: 470 } });
    const partialWarning = partial.warnings.find((w) => w.code === 'cohort-values-suppressed');
    if (partialWarning) {
      const pair = /^(\d+) of (\d+) cells/.exec(partialWarning.message)!;
      const partialNotes = partial.scene
        .filter((n) => n.t === 'text')
        .flatMap((n) => (n.t === 'text' ? n.lines : []))
        .join(' ');
      expect(partialNotes).toContain(
        `${pair[1]} of ${pair[2]} rates are too narrow to print`,
      );
    }
  });
});

describe('cohort — a value that is not a count is refused for the reason it is not', () => {
  it('names a fractional count instead of calling it a missing observation', () => {
    const error = throwsWith(() =>
      layout({
        cohorts: [
          { id: 'a', label: 'Jan', active: [1250000.5, 900000.25] },
          { id: 'b', label: 'Feb', active: [1100000] },
        ],
      }),
    );
    // A revenue triangle is not told its period-0 observation is absent —
    // a statement about an input the author never supplied.
    expect(error.code).toBe('cohort-fractional-count');
    expect(error.message).toContain('1250000.5');
    expect(error.message).not.toContain('no observation at period 0');
    expect(error.suggest).toContain('whole units');
  });

  it('names a negative count instead of calling it a skipped period', () => {
    const error = throwsWith(() =>
      layout({
        cohorts: [
          { id: 'a', label: 'Jan', active: [1000, -5] },
          { id: 'b', label: 'Feb', active: [900] },
        ],
      }),
    );
    expect(error.code).toBe('cohort-negative-count');
    expect(error.message).toContain('-5');
    expect(error.message).not.toContain('skips period');
  });
});

describe('cohort — the host engine never speaks for itself', () => {
  it('never surfaces the host column mean, or any other host derived field', () => {
    for (const fixture of getFixtures(definition.type)) {
      const geometry = definition.layout(fixture.data, {
        ...definition.defaults,
        ...(fixture.options as object),
      }) as Geometry<CohortMarks, CohortDerived>;
      const expected = ['basis', 'cohorts', 'maxRetention', 'periodCount'];
      if (geometry.derived.averages !== undefined) expected.push('averages');
      if (fixture.options?.variant !== undefined) {
        expected.push('visiblePeriods');
        if (fixture.options.total !== false) expected.push('total');
        if (fixture.options.excludeCurrentPeriod) expected.push('excludedCurrentPeriod');
      }
      expect(Object.keys(geometry.derived).sort(), fixture.id).toEqual(expected.sort());
      for (const forbidden of ['colMeans', 'rowMeans', 'max', 'min']) {
        expect(geometry.derived, `${fixture.id}: ${forbidden}`).not.toHaveProperty(forbidden);
      }
    }
  });

  it('ignores a sort that would scramble the staircase, and says so', () => {
    const sorted = layout(clean(), { sort: { categories: 'desc', segments: 'asc' } });
    expect(codes(sorted).filter((c) => c === 'cohort-sort-ignored').length).toBe(2);
    expect(svg(sorted)).toBe(svg(layout(clean())));
  });

  it("keeps sort.segments 'reverse' — newest first is a reading choice, not a reordering by value", () => {
    const reversed = layout(clean(), { sort: { segments: 'reverse' } });
    expect(codes(reversed)).not.toContain('cohort-sort-ignored');
    expect(reversed.axes.find((a) => a.axis === 'y')!.ticks.map((t) => t.at)).toEqual(['c', 'b', 'a']);
  });

  it('applies the selected palette to the cohort ramp', () => {
    const geometry = layout(clean(), { palette: 'atlantic' });
    expect(geometry.warnings.map((w) => w.code)).not.toContain('palette-inapplicable');
    expect(svg(geometry)).not.toBe(svg(layout(clean())));
  });

  it('drops every annotation kind with a message naming cohort', () => {
    const geometry = definition.layout(clean(), {
      ...definition.defaults,
      annotations: [{ kind: 'callout', at: 't1', text: 'look here' }],
    }) as Geometry<CohortMarks, CohortDerived>;
    const warning = geometry.warnings.find((w) => w.code === 'unsupported-annotation')!;
    expect(warning.message).toContain("'cohort'");
    expect(warning.message).not.toContain('heatmap');
    expect(geometry.annotations).toEqual([]);
  });
});

describe('cohort — exhibit contract', () => {
  it('puts the cohort base in every row label', () => {
    const geometry = layout(clean());
    for (const row of geometry.derived.cohorts) {
      const label = geometry.labels.find((l) => l.id === `series:${row.id}`)!;
      expect(label.hidden).toBeFalsy();
      expect(label.lines.join(' ')).toContain(`(n = ${formatNumber(row.base, { decimals: 0 })})`);
    }
  });

  it('labels periods from periodLabel, and falls back to a spelled-out period', () => {
    expect(
      layout(clean()).axes.find((a) => a.axis === 'x')!.ticks.map((t) => t.at),
    ).toEqual(['t0', 't1', 't2', 't3']);
    const named = layout(clean());
    expect(named.labels.find((l) => l.id === 'category:t2')!.text).toBe('M2');
    const unnamed = layout({ ...clean(), periodLabel: undefined });
    expect(unnamed.labels.find((l) => l.id === 'category:t2')!.text).toBe('Period 2');
  });

  it('states the method, and reworks the note for the other basis', () => {
    const note = (options: CohortOptions) => readerText(layout(clean(), options), ' | ');
    // the 'cohort' formula is what a reader assumes, so it is a method
    // note; the 'previous' formula changes every rate and always prints.
    expect(note({})).not.toContain('Retention = active');
    expect(note({ methodNote: true })).toContain('Retention = active / cohort base (period 0)');
    expect(note({ basis: 'previous' })).toContain("previous period's active");
    expect(note({ averages: 'weighted' })).toContain('never the mean of the percentages');
  });

  // A previous-period total used active counts but its pure-exhibit note claimed cohort-size weights.
  it('prints the weighted-average formula the basis actually computed', () => {
    const note = (options: CohortOptions) => readerText(layout(clean(), options), ' | ');
    const onBase = note({ averages: 'weighted' });
    expect(onBase).toContain('Weighted average = total active / total base');
    // Under basis 'previous' the denominator is the previous period's active,
    // and the exhibit stated the BASE formula: a printed formula that is not the
    // arithmetic performed misstates the number above it.
    const onPrevious = note({ basis: 'previous', averages: 'weighted' });
    expect(onPrevious).toContain(
      'Weighted average = total active / total previous-period active',
    );
    expect(onPrevious).not.toContain('total active / total base');
    expect(note({ basis: 'previous', variant: 'pure' })).toContain('Total is weighted by previous active count');
    // And the printed formula reproduces the printed number.
    const geometry = layout(clean(), { basis: 'previous', averages: 'weighted' });
    const rows = geometry.derived.cohorts.filter((r) => r.observedPeriods > 2);
    const numerator = rows.reduce((sum, r) => sum + r.active[2]!, 0);
    const denominator = rows.reduce((sum, r) => sum + r.active[1]!, 0);
    expect(geometry.derived.averages![2]!.value).toBeCloseTo(numerator / denominator, 12);
  });

});

describe('cohort — small rate precision', () => {
  // Small positive cohort rates must not look like zero; a period of small rates takes its own precision, other periods keep theirs.
  it('keeps small rates and their weighted total visible without changing other periods', () => {
    const data: CohortData = { cohorts: [{ id: 'a', active: [100000, 1] }, { id: 'b', active: [100000, 39] }] };
    for (const variant of ['pure', 'stepped'] as const) {
      const g = layout(data, { variant, title: 'Observed rates (%)', size: { width: 960 } });
      const text = (row: string, period: number) => {
        const n = g.scene.find(n => n.t === 'text' && n.id === `label:cohort-cell:${row}:t${period}`);
        return n?.t === 'text' ? n.lines.join(' ') : undefined;
      };
      expect(text('a', 1)).toBe('0.001');
      expect(text('b', 1)).toBe('0.039');
      expect(text('cohort-total', 1)).toBe('0.020');
      expect(text('a', 0)).toBe('100.0');
    }
  });
});

// Long rates must stay visible at natural width and in a report that already fits them.
it('measures the rate strings before reporting a pure exhibit natural width', async () => {
  const data: CohortData = { periodLabel: 'Month', cohorts: [
    { id: 'a', active: [1e12, 1, 1, 1, 1, 1] },
    { id: 'b', active: [1e12, 1, 1, 1, 1] },
  ] };
  const options: CohortOptions = { variant: 'pure', total: false };
  const { resolveChartRequest, layoutResolvedRequest } = await import('../src/core/request');
  const laid = (size?: { width: number }) => layoutResolvedRequest(resolveChartRequest({ type: 'cohort', data, options: { ...options, ...(size ? { size } : {}) } }));
  const natural = laid();
  if (natural.refused) throw new Error('refused');
  const g = laid({ width: natural.sizing!.naturalWidth });
  if (g.refused) throw new Error('refused');
  const rates = g.scene.filter(n => n.t === 'text' && n.id.startsWith('label:cohort-cell:'));
  expect(rates).toHaveLength(11);
  expect(rates.filter(n => n.t === 'text' && n.lines.join(' ') === '1.0\u00a0×\u00a010⁻¹⁰')).toHaveLength(9);
  const report = layoutResolvedRequest(resolveChartRequest({ type: 'cohort', data, options: {
    ...options, theme: 'standard', title: 'Observed rates (%)', size: { width: 720 },
  } }));
  expect(report.refused).not.toBe(true);
  if (report.refused) return;
  expect(report.scene.filter(n => n.t === 'text' && n.id.startsWith('label:cohort-cell:'))).toHaveLength(11);
});

describe('cohort — governing unit', () => {
  // The unit joins the key caption or the corner cell; the subtitle stays authored.
  const header = (g: Geometry<CohortMarks, CohortDerived>) => g.scene.flatMap(n => n.t === 'text' &&
    (n.id === 'label:cohort-header-label' || n.id === 'label:cohort-legend-caption' || n.id.startsWith('frame:subtitle')) ? n.lines : []).join(' | ');
  const units = (text: string) => (text.match(/%|percent|per cent|prozent|×|\bx\b/gi) ?? []).length;
  const variants = [
    { variant: 'pure' }, { variant: 'stepped' }, { variant: 'stepped', formatScope: 'classic' },
    { variant: 'stepped', formatScope: 'classic', legend: 'none' },
  ] as const;

  // Bare rates read as counts; a unit line must not cost a header row or refuse fixed heights that fit.
  it('states the unit once in an existing header line at the same size', () => {
    for (const variant of variants) for (const size of [{ width: 720 }, { width: 720, height: 316 }]) {
      const g = layout(clean(), { ...variant, size });
      const host = layout(clean(), { ...variant, size, unitShown: true });
      expect(units(header(g))).toBe(1);
      expect(units(header(host))).toBe(0);
      expect(g.size).toEqual(host.size);
      expect(g.plot).toEqual(host.plot);
      expect(g.sizing).toEqual(host.sizing);
      expect(g.derived).toEqual(host.derived);
    }
  });

  // A "%" in a message title or a subtitle period must not hide the unit; unit "x" must not print twice.
  it('reads the unit from structured fields only', () => {
    for (const variant of variants) {
      expect(units(header(layout(clean(), { ...variant, title: 'Newer cohorts keep 5% fewer members by M2' })))).toBe(1);
      expect(units(header(layout(clean(), { ...variant, subtitle: { measure: 'Retention', period: 'Top 20% accounts' } })))).toBe(2);
      // A visible classic key echoes an authored unit as its caption.
      const keyEchoesUnit = 'formatScope' in variant && !('legend' in variant);
      expect(units(header(layout(clean(), { ...variant, unit: 'x', subtitle: { measure: 'Member retention' } })))).toBe(keyEchoesUnit ? 2 : 1);
      expect(units(header(layout(clean(), { ...variant, unit: 'x' })))).toBe(1);
      for (const unit of ['', '   ']) expect(header(layout(clean(), { ...variant, unit }))).toContain('%');
    }
  });

  // Authored percent words in a subtitle or a custom measure must not gain a second unit.
  it('keeps authored unit words once', () => {
    for (const variant of variants) for (const measure of ['Retention percent', 'Retention percentage', 'Retention per cent', 'Retention in Prozent']) {
      for (const [subtitle, unit] of [[measure, undefined], [{ measure }, '%']] as const) {
        const g = layout(clean(), { ...variant, target: 'report', subtitle, unit, size: { width: 720 } });
        expect(g.scene.flatMap(n => n.t === 'text' && n.id.startsWith('frame:subtitle') ? n.lines : []).join(' ')).toBe(measure);
        expect(header(g)).not.toContain(' in %');
      }
      expect(units(header(layout(clean(), { ...variant, strings: { cohortMeasure: measure }, size: { width: 720 } })))).toBe(1);
      expect(header(layout(clean(), { ...variant, strings: { cohortMeasure: measure }, unit: '%', size: { width: 720 } }))).not.toContain('(%)');
    }
  });

  // A unit too long for the corner or key must not hide a header or leave an empty corner.
  it('keeps the corner and key when the unit fits nowhere', () => {
    const unit = '% of original cohort members, all acquisition channels';
    for (const options of [{ variant: 'pure', unit, size: { width: 720 } }, { variant: 'stepped', unit, size: { width: 500 } },
      { variant: 'pure', cohortSizeLabel: 'Members at the start of the acquisition month', size: { width: 720 } }] as const) {
      const g = layout(clean(), options);
      // A long size header collides too, and its corner has room for the default unit; only the unit cases must hide nothing.
      if ('cohortSizeLabel' in options) continue;
      expect(g.labels.filter(label => (label.id.startsWith('cohort-header') || label.id.startsWith('cohort-legend')) && label.hidden)).toEqual([]);
      expect(g.labels.find(label => label.id === 'cohort-header-label')?.lines).toEqual(['COHORT']);
    }
  });

  it('reports no missing unit for authored percent words', async () => {
    const { callTool } = await import('../src/mcp/server');
    const result = callTool('boardplot_render', { spec: { type: 'cohort', data: clean(), options: {
      variant: 'stepped', target: 'report', unit: '%', subtitle: { measure: 'Retention percentage' }, size: { width: 960 },
    } }, return: ['reading'] });
    const body = result.structuredContent as { ok: boolean; warnings: { code: string }[] };
    expect(body.ok).toBe(true);
    expect(body.warnings.some(warning => warning.code === 'unit-not-shown')).toBe(false);
  });
});

describe('cohort — claims', () => {
  // The residue cleanup read a true 1-in-100,000,000 ratio as noise beside its base and reported 0.
  it('keeps a tiny real ratio in the claim', async () => {
    const { claimsForChart } = await import('../src/core/claims');
    const geometry = layout({ cohorts: [{ id: 'a', active: [100_000_000, 1] }, { id: 'b', active: [100_000_000, 3] }] }, { averages: 'weighted' });
    const claims = claimsForChart('cohort', geometry as never);
    expect(claims.find((c) => c.id === 'cohort:a:t1')!.output.raw).toBe(1e-8);
    expect(claims.find((c) => c.id === 'cohort:average:t1')!.output.raw).toBe(2e-8);
  });

  // The reading called every printed exhibit cell "Not displayed", because the receipt looked for heatmap cell nodes.
  it('quotes the text an exhibit prints, and only a cell it prints', async () => {
    const { claimsForChart } = await import('../src/core/claims');
    const data = { cohorts: [{ id: 'a', active: [1000, 640, 500] }, { id: 'b', active: [1000, 660] }] };
    for (const variant of ['pure', 'stepped'] as const) {
      const geometry = layout(data, { variant, visiblePeriods: [0, 1], size: { width: 760, height: 420 } });
      const claims = claimsForChart('cohort', geometry as never);
      const claim = (id: string) => claims.find((c) => c.id === id)!;
      const printed = geometry.labels.find((l) => l.id === 'cohort-cell:a:t1')!;
      expect(claim('cohort:a:t1').output.displayed).toBe(printed.text);
      expect(claim('cohort:a:t1').nodeId).toBe(printed.nodeId);
      expect(claim('cohort:a:t2').output.displayed).toBe('');
      expect(claim('cohort:a:t2').nodeId).toBeUndefined();
    }
  });

  it('gives every observed cell a receipt carrying both counts and the ratio', async () => {
    const { claimsForChart } = await import('../src/core/claims');
    const geometry = layout(clean());
    const claims = claimsForChart('cohort', geometry as never);
    const cell = claims.find((c) => c.id === 'cohort:a:t1')!;
    expect(cell.op).toBe('cohort-retention@1');
    expect(cell.inputs).toEqual([
      { ref: 'a:active:t1', value: 600 },
      { ref: 'a:base', value: 1000 },
    ]);
    expect(cell.output.raw).toBe(0.6);
    expect(cell.output.displayed).toBe('60%');
    expect(claims.filter((c) => c.op === 'cohort-retention@1').length).toBe(9);
  });

  it('carries the support count on every average claim', () => {
    const derivedGeometry = layout(clean(), { averages: 'weighted' });
    return import('../src/core/claims').then(({ claimsForChart }) => {
      const claims = claimsForChart('cohort', derivedGeometry as never);
      const averages = claims.filter((c) => c.op === 'cohort-average@1');
      expect(averages.length).toBe(4);
      expect(averages[3]!.output.state).toBe('support:1');
      expect(averages[0]!.output.state).toBe('support:3');
    });
  });

  it('names the previous-period denominator when the basis changes', async () => {
    const { claimsForChart } = await import('../src/core/claims');
    const claims = claimsForChart('cohort', layout(clean(), { basis: 'previous' }) as never);
    const cell = claims.find((c) => c.id === 'cohort:a:t2')!;
    expect(cell.inputs).toEqual([
      { ref: 'a:active:t2', value: 420 },
      { ref: 'a:active:t1', value: 600 },
    ]);
    expect(cell.output.raw).toBe(0.7);
  });
});

// A pinned cohort table a few pixels short draws with tighter row air, not a refusal. Row air gives way first; every label still prints.
it('draws a pinned cohort table a few pixels short with tight row air instead of refusing', () => {
  const fixture = getFixtures('cohort').find((entry) => entry.id === 'retention-previous-period')!;
  // 291 px: with the notes printed (notes.show), the full notes are reserved inside the pinned frame (pinned-fit), so this is the height that fits with tight air.
  const geometry = definition.layout(fixture.data as CohortData, { ...fixture.options, notes: { show: ['note', 'disclosure', 'method'] }, size: { width: 720, height: 291 } } as CohortOptions);
  expect(geometry.refused).toBeFalsy();
  expect((geometry as Geometry<CohortMarks, CohortDerived>).warnings.map((warning) => warning.code)).toContain('table-tight-spacing');
  expect((geometry as Geometry<CohortMarks, CohortDerived>).labels.filter((label) => label.hidden)).toEqual([]);
});

// A size repair must also fit after it crosses into a larger text-size class.
it('clears tight spacing with the size its warning suggests', async () => {
 const {layoutResolvedRequest,measureResolvedRequest,resolveChartRequest}=await import('../src/core/request');
 const {requireGeometry}=await import('../src/core/sizing');
 const fixture=getFixtures('cohort').find(f=>f.id==='fractional-step-key')!;
 const draw=(size: {width:number;height?:number})=>requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'cohort',data:fixture.data,options:{...fixture.options,size}})));
 const warning=draw({width:440}).warnings.find(w=>w.code==='table-tight-spacing')!;
 expect(warning).toBeDefined();
 expect(warning.message).toContain('estimated');
 const fixed=draw((warning.fix![0] as {value:{width:number;height:number}}).value);
 expect(fixed.warnings.some(w=>w.code==='table-tight-spacing')).toBe(false);
 const measured=measureResolvedRequest(resolveChartRequest({type:'cohort',data:fixture.data,options:{...fixture.options,size:{width:440}}}));
 const verified=measured.warnings.find(w=>w.code==='table-tight-spacing')!;
 expect(verified.message).not.toContain('estimated');
 expect(draw((verified.fix![0] as {value:{width:number;height:number}}).value).warnings.some(w=>w.code==='table-tight-spacing')).toBe(false);
});

// A hover card titled a total row "cohort-total / t0" and a size cell by the cohort id: the records must use the printed row and period names.
it('titles cohort records with the printed row and period names', async () => {
  const { interactionRecords } = await import('../src/core/a11y/records');
  const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
  const { requireGeometry } = await import('../src/core/sizing');
  for (const id of ['retention-pure-exhibit', 'retention-previous-period']) {
    const fixture = getFixtures('cohort').find(entry => entry.id === id)!;
    const request = resolveChartRequest({ type: 'cohort', data: fixture.data, options: { ...fixture.options as object, size: { width: 800, height: 450 } } } as never);
    const records = interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] });
    const ids = new Set(records.flatMap(record => [record.target.owner.seriesId, record.target.owner.categoryId].map(String)));
    for (const record of records) for (const part of record.label.split(' / ')) expect(ids.has(part)).toBe(false);
  }
});

// A rate such as "72%" missed a half-slide cell and every rate vanished; the unit line already names the percent.
it('a narrow cohort heatmap prints its rates without the % sign instead of hiding them', () => {
  const cohorts = Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, label: `K${i}`, active: Array.from({ length: 12 - i }, (_, t) => Math.round(1000 * 0.95 ** (t * 1.7))) }));
  const printed = (width: number, unit?: string) => layout({ periodLabel: 'Month', cohorts } as CohortData, { unit, size: { width, height: 300 } } as CohortOptions)
    .labels.filter((label) => label.kind === 'point' && !label.hidden).map((label) => label.text).filter((text) => text !== '–');
  expect(printed(640, '% of cohort base').every((text) => text.endsWith('%'))).toBe(true);
  const narrow = printed(432, '% of cohort base');
  expect(narrow).toHaveLength(57);
  expect(narrow.some((text) => text.includes('%'))).toBe(false);
  // Without a unit line naming the percent, the sign stays.
  expect(printed(432).every((text) => text.endsWith('%'))).toBe(true);
});
