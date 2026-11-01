import { getFixtures } from '../src/fixtures';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutFunnel, type FunnelDerived, type FunnelMarks } from '../src/core/charts/funnel/layout';
import { rectContains } from '../src/core/geometry';
import { getChart } from '../src/core/registry';
import { measure } from '../src/index';
import type { ChartData } from '../src/core/types/data';
import type { Geometry, PlacedLabel } from '../src/core/types/scene';

const definition = getChart('funnel')!;
type FunnelGeometry = Geometry<FunnelMarks, FunnelDerived>;

function layout(data: ChartData, options: Record<string, unknown> = {}): FunnelGeometry {
  return definition.layout(data, { ...definition.defaults, ...options }) as FunnelGeometry;
}

function fixture(id: string): { data: ChartData; geometry: FunnelGeometry; options: Record<string, unknown> } {
  const item = getFixtures(definition.type).find((candidate) => candidate.id === id)!;
  const options = { ...definition.defaults, ...(item.options ?? {}) } as Record<string, unknown>;
  return { data: item.data as ChartData, geometry: layout(item.data as ChartData, options), options };
}

function primitiveValue(cell: ChartData['series'][number]['values'][number]): number {
  if (typeof cell === 'number') return Math.max(0, cell);
  if (cell === null || 'date' in cell) return 0;
  if ('number' in cell) return Math.max(0, cell.number);
  return Math.max(0, cell.pct);
}

function expectedTotals(data: ChartData): number[] {
  return data.categories.map((_category, ci) =>
    data.series
      .filter((series) => series.role !== 'reference')
      .reduce((sum, series) => sum + primitiveValue(series.values[ci]!), 0),
  );
}

function expectedRates(data: ChartData): number[] {
  const totals = expectedTotals(data);
  return totals.slice(0, -1).flatMap((from, ci) => (from > 0 ? [totals[ci + 1]! / from] : []));
}

function leaderLengthBound(label: PlacedLabel): number {
  const numbers = label.leader!.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  let length = 0;
  for (let i = 2; i < numbers.length; i += 2) {
    length += Math.hypot(numbers[i]! - numbers[i - 2]!, numbers[i + 1]! - numbers[i - 1]!);
  }
  return length;
}

function verticalOverlap(a: PlacedLabel['rect'], b: PlacedLabel['rect']): boolean {
  return !(a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function expectOwnedLabelsInTheirLanes(geometry: FunnelGeometry): void {
  const columnCaptions = geometry.labels.some((label) => label.slot?.startsWith('conversionColumn'));
  const lanes = new Map(geometry.marks.rows.map((row) => [row.categoryId, row.lane]));
  const laneClaims = geometry.debug.occupied.filter((claim) => claim.part === 'funnel-row-lane');
  expect(laneClaims).toHaveLength(geometry.marks.rows.length);

  for (const row of geometry.marks.rows) {
    // The claim is the lane inset at top and bottom: lanes tile without a
    // gap, so claiming the whole rect refused every label that filled its own
    // row. Containment below is still judged against the whole lane.
    const claim = laneClaims.find((item) => item.owner.categoryId === row.categoryId)!;
    expect(rectContains(row.lane, claim.rect)).toBe(true);
    expect(claim.rect.x).toBe(row.lane.x);
    // A right-hand step-rate column is no row's lane: the claim ends left of it.
    if (!columnCaptions) expect(claim.rect.w).toBe(row.lane.w);
    expect(claim.rect.h).toBeGreaterThanOrEqual(row.lane.h - 6);
  }

  const rowIds = geometry.marks.rows.map((row) => row.categoryId);
  for (const label of geometry.labels.filter((item) => !item.hidden && item.owner.categoryId)) {
    const ci = rowIds.indexOf(label.owner.categoryId!);
    // A step rate in the right-hand column stands level with the gap, so it
    // belongs to both rows of its step.
    const step = label.slot?.startsWith('conversionColumn') && ci + 1 < rowIds.length ? rowIds[ci + 1] : undefined;
    const own = lanes.get(label.owner.categoryId!)!;
    const next = step ? lanes.get(step)! : undefined;
    const ownLane = next ? { ...own, h: next.y + next.h - own.y } : own;
    expect(rectContains(ownLane, label.rect), `${label.id} must stay inside ${label.owner.categoryId}`).toBe(true);
    for (const row of geometry.marks.rows) {
      if (row.categoryId === label.owner.categoryId || row.categoryId === step) continue;
      expect(
        verticalOverlap(label.rect, row.lane),
        `${label.id} owned by ${label.owner.categoryId} entered ${row.categoryId}`,
      ).toBe(false);
    }
    expect(
      geometry.debug.occupied.some(
        (claim) =>
          claim.kind === 'label' &&
          claim.owner.categoryId === label.owner.categoryId &&
          claim.rect.x === label.rect.x &&
          claim.rect.y === label.rect.y &&
          claim.rect.w === label.rect.w &&
          claim.rect.h === label.rect.h,
      ),
      `${label.id} final geometry must have a matching occupied claim`,
    ).toBe(true);
  }
}

describe('funnel truth contract', () => {
  // A custom chip on a one-segment row must get space below its bar or be omitted with a warning.
  it('reserves space for nonredundant single-segment row chips', () => {
    const data: ChartData = {
      categories: ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() })),
      series: [
        { id: 's', label: 'Count', values: [100, 60, 30].map(number => ({ number, label: 'Count ${value}' })) },
        { id: 'z', label: 'Zero', values: [0, 0, 0] },
      ],
    };
    const geometry = layout(data, { size: { width: 400, height: 300 } });
    for (const row of geometry.marks.rows) {
      const chip = geometry.labels.find(label => label.id === `segment:${row.categoryId}:s`)!;
      expect(chip.hidden, chip.id).toBeUndefined();
      expect(chip.rect.y, chip.id).toBeGreaterThanOrEqual(row.rect.y + row.rect.h);
    }
    const short = layoutFunnel(data, { ...definition.defaults, size: { width: 400, height: 140 } });
    const omitted = short.labels.filter(label => label.kind === 'segment' && label.hidden === 'collision');
    expect(omitted.length).toBeGreaterThan(0);
    for (const chip of omitted) {
      expect(short.warnings).toContainEqual(expect.objectContaining({
        code: 'funnel-label-hidden', message: expect.stringContaining(chip.id),
      }));
    }
    expect(short.sizing!.minHeight).toBeGreaterThan(140);
  });

  // A cell label must replace or suppress its value in both funnel variants without removing the stage name.
  it('honours single-series cell labels and warns when centered segments cannot carry them', () => {
    const data: ChartData = {
      categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
      series: [{ id: 's', values: [{ number: 100, label: 'Start: ${value}' }, { number: 60, label: false }, 30] }],
    };
    for (const variant of ['rows', 'centered']) {
      const geometry = layout(data, { variant, size: { width: 900, height: 600 } });
      const texts = geometry.labels.filter(label => !label.hidden).map(label => label.text);
      expect(texts.join(' '), variant).toContain('Start: 100');
      expect(texts.join(' '), variant).toContain('Beta');
      expect(geometry.labels.find(label => label.id === 'total:b')).toBeUndefined();
      expect(texts.join(' '), variant).not.toMatch(/\b60\b(?!%)/);
      expect(geometry.derived.stageTotals).toEqual({ a: 100, b: 60, c: 30 });
    }
    const split = { ...data, series: [...data.series, { id: 'r', values: [20, 15, 10] }] };
    const rows = layout(split, { size: { width: 900, height: 600 } });
    const authored = rows.labels.find(label => label.id === 'segment:a:s');
    expect(authored?.text).toBe('Start: 100');
    expect(authored?.hidden).toBeUndefined();
    expect(rows.labels.find(label => label.id === 'segment:b:s')).toBeUndefined();
    const centered = layout(split, { variant: 'centered', size: { width: 900, height: 600 } });
    expect(centered.warnings).toContainEqual(expect.objectContaining({ code: 'funnel-cell-label-ignored', severity: 'warn', suggest: expect.stringContaining('rows') }));
  });

  // A hidden first value must not size the other stages' two-line labels out of the chart.
  it('sizes centered rows from the tallest stage label when the first value is hidden', () => {
    const data = { categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
      series: [{ id: 's', values: [{ number: 100, label: false }, 60, 30] }] } as unknown as ChartData;
    const { minHeight } = measure({ type: 'funnel', data, options: { variant: 'centered', size: { width: 900, height: 160 } } } as never) as { minHeight: number };
    const drawn = layout(data, { variant: 'centered', size: { width: 900, height: minHeight } });
    expect(drawn.refused).toBeFalsy();
    expect(drawn.warnings.map(warning => warning.code)).not.toContain('funnel-label-hidden');
  });

  // Eight centered stages on a full slide refused because each band had to hold two label lines.
  it('sets name and value on one line when centered bands are too short for two', () => {
    const { geometry } = fixture('centered-eight-stages-slide');
    expect(geometry.refused).toBeFalsy();
    const stages = geometry.labels.filter((label) => label.id.startsWith('stage:'));
    expect(stages).toHaveLength(8);
    for (const label of stages) {
      expect(label.hidden).toBeFalsy();
      expect(label.lines).toHaveLength(2);
      expect(label.rect.h).toBeLessThan(label.font!.size * 2);
    }
  });

  it('derives sliver conversions from adjacent stage totals; the column shows the rate, the description names both stages', () => {
    const { data, geometry } = fixture('sliver-segments');
    const expected = expectedRates(data);

    expect(expected.map((rate) => Math.round(rate * 100))).toEqual([50, 49, 48]);
    expect(geometry.derived.conversions.map((item) => item.rate)).toEqual(expected);
    expect(
      geometry.labels
        .filter((label) => label.id.startsWith('conv:'))
        .map((label) => label.text),
    ).toEqual(['50% advance', '49% advance', '48% advance']);
    expect(geometry.a11y.desc).toContain('Enquiries → Screened: 50% conversion');
    expect(geometry.a11y.desc).toContain('Shortlist → Placed: 48% conversion');
  });

  it('does not depend on status-advanced values when stage totals are unchanged', () => {
    const { data, geometry } = fixture('lead-funnel');
    const changed = structuredClone(data);
    const advanced = changed.series.find((series) => series.id === 'advanced')!;
    const open = changed.series.find((series) => series.id === 'open')!;
    for (let ci = 0; ci < changed.categories.length - 1; ci++) {
      const transfer = Math.min(17 + ci, primitiveValue(advanced.values[ci]!) / 4);
      advanced.values[ci] = primitiveValue(advanced.values[ci]!) - transfer;
      open.values[ci] = primitiveValue(open.values[ci]!) + transfer;
    }

    const changedGeometry = layout(changed, fixture('lead-funnel').options);
    expect(changedGeometry.derived.conversions).toEqual(geometry.derived.conversions);
    expect(changedGeometry.a11y).toEqual(geometry.a11y);
  });

  it('warns on growth and fails closed in visible and accessible labels', () => {
    const geometry = layout({
      categories: [
        { id: 'a', label: 'Applications' },
        { id: 'b', label: 'Approved' },
      ],
      series: [{ id: 'count', values: [50, 120] }],
    });

    expect(geometry.derived.conversions).toEqual([{ fromId: 'a', toId: 'b', rate: 2.4 }]);
    expect(geometry.warnings.filter((item) => item.code === 'funnel-stage-increased')).toEqual([
      expect.objectContaining({ severity: 'warn', owner: { categoryId: 'a' } }),
    ]);
    const label = geometry.labels.find((item) => item.id === 'conv:a:b')!;
    expect(label.text).toBe('↑ increased');
    expect(label.text).not.toMatch(/\d+%/);
    expect(geometry.a11y.desc).toContain(
      'Applications → Approved: stage total increased; conversion percentage not shown',
    );
    expect(geometry.a11y.desc).not.toContain('240%');
  });

  it('keeps every visible fixture label in its own lane', () => {
    for (const item of getFixtures(definition.type)) {
      let geometry = layout(item.data as ChartData, (item.options ?? {}) as Record<string, unknown>);
      // A pinned tile too short for report type refuses with a verified size; judge the lanes there.
      const refusal = geometry as unknown as { refused?: boolean; warnings: { fix?: { path: string; value?: unknown }[] }[] };
      const repair = refusal.refused ? refusal.warnings[0]!.fix?.find((op) => op.path === '/options/size')?.value : undefined;
      if (repair) geometry = layout(item.data as ChartData, { ...item.options, size: repair } as Record<string, unknown>);
      expectOwnedLabelsInTheirLanes(geometry);
      for (const hidden of geometry.labels.filter(
        (label) => label.owner.categoryId && label.hidden === 'collision',
      )) {
        expect(
          geometry.warnings.some(
            (warning) => warning.code === 'funnel-label-hidden' && warning.message.includes(hidden.id),
          ),
          `${item.id}/${hidden.id} must degrade with a warning`,
        ).toBe(true);
      }
    }

    const lead = getFixtures(definition.type).find((item) => item.id === 'lead-funnel')!;
    const pinned = layout(lead.data as ChartData, {
      ...(lead.options ?? {}),
      labelPlacements: { 'segment:offer:lost': 'outsideBelowFar' },
    });
    expectOwnedLabelsInTheirLanes(pinned);
    expect(pinned.warnings.some((warning) => warning.code === 'unknown-slot')).toBe(true);

  });

  // A long funnel on a short frame moves its step rates into the right-hand
  // column; the row-lane filter dropped every one of them into a note the page does not show.
  it('keeps the step rates of a twelve-stage funnel in the right-hand column', () => {
    const names = ['Visitors', 'Signups', 'Activated', 'Engaged', 'Trial', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Contract', 'Won', 'Renewed'];
    const data: ChartData = {
      categories: names.map((label, i) => ({ id: `s${i}`, label })),
      series: [
        { id: 'large', label: 'Large accounts', values: names.map((_n, i) => Math.round(7400 * 0.6 ** i)) },
        { id: 'small', label: 'Small accounts', values: names.map((_n, i) => Math.round(7900 * 0.58 ** i)) },
      ],
    };
    const geometry = layout(data, { target: 'slide', size: { width: 1184, height: 528 } });
    const rates = geometry.labels.filter((label) => label.id.startsWith('conv:'));
    expect(rates).toHaveLength(11);
    expect(rates.filter((label) => label.hidden).map((label) => label.id)).toEqual([]);
    expect(rates.every((label) => label.slot === 'conversionColumn')).toBe(true);
    expectOwnedLabelsInTheirLanes(geometry);
  });

  it('keeps authored row callouts near the anchor without changing stage values', () => {
    const { data, options, geometry } = fixture('funnel-near-callout');
    const note = geometry.labels.find((label) => label.id === 'annotation:trial-note')!;
    expect(note.hidden).toBeUndefined();
    const total = geometry.labels.find((label) => label.id === 'total:trial')!;
    // At report type the note's seat beside the bar end is too near
    // for a drawn leader; the note then stands above its stage total.
    if (note.leader === undefined) {
      expect(note.rect.y + note.rect.h).toBeLessThanOrEqual(total.rect.y);
      expect(Math.abs(note.rect.x - total.rect.x)).toBeLessThanOrEqual(1);
    } else {
      expect(leaderLengthBound(note)).toBeLessThanOrEqual(3 * note.rect.w);
      // The leader ends on its own bar, left of the stage total, and never
      // below the bar. On thin bars that end
      // can sit a little below the total's top edge.
      const route = note.leader.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
      // The route starts at its anchor on the bar.
      const [endX, endY] = route.slice(0, 2) as [number, number];
      const bar = geometry.marks.rows.find((row) => row.categoryId === 'trial')!.rect;
      expect(endX).toBeLessThan(total.rect.x);
      expect(endY).toBeGreaterThanOrEqual(bar.y);
      expect(endY).toBeLessThanOrEqual(bar.y + bar.h);
    }

    const baseline = layout(data, { ...options, annotations: [] });
    expect(geometry.derived).toEqual(baseline.derived);
    expect(geometry.labels.filter((label) => label.kind === 'total' && !label.hidden)).toHaveLength(data.categories.length);
    expect(geometry).toEqual(layout(data, options));
  });

  // Without its own column the CAGR label of a rows funnel landed on the middle row's value line, beside its total.
  it('seats the CAGR label of a rows funnel right of every stage total', () => {
    const { data, options } = fixture('annual-cohort-retention');
    const geometry = layout(data, { ...options, variant: 'rows' });
    const cagr = geometry.labels.find((label) => label.id === 'annotation:annual-loss')!;
    expect(cagr.hidden).toBeUndefined();
    for (const total of geometry.labels.filter((label) => label.kind === 'total')) {
      expect(cagr.rect.x).toBeGreaterThanOrEqual(total.rect.x + total.rect.w);
    }
    expect(cagr.rect.x + cagr.rect.w).toBeLessThanOrEqual(geometry.size.width);
  });

  // A frame too narrow for the CAGR column must draw as before, not refuse: the column never raises the minimum width.
  it('draws a rows funnel with a CAGR annotation at the narrowest supported width', () => {
    const { data, options } = fixture('annual-cohort-retention');
    const spec = { ...options, variant: 'rows' as const };
    const geometry = layout(data, { ...spec, size: { width: 280, height: 562 } });
    expect((geometry as unknown as { refused?: boolean }).refused).toBeFalsy();
  });

  it('keeps fixture visibility claims honest and the automatic note source-owned', () => {
    for (const item of getFixtures(definition.type)) {
      expect(item.title.toLowerCase()).not.toContain('overlap-free');
      expect(String(item.options?.title ?? '').toLowerCase()).not.toContain('overlap-free');
    }

    const sliver = fixture('sliver-segments').geometry;
    expect(sliver.labels.filter((label) => label.hidden)).toEqual([]);
    for (const id of ['sliver-segments', 'eight-stages-dense']) {
      const geometry = fixture(id).geometry;
      for (const conversion of geometry.derived.conversions) {
        const label = geometry.labels.find(
          (item) => item.id === `conv:${conversion.fromId}:${conversion.toId}`,
        );
        expect(label?.hidden, `${id}/${label?.id} must remain visible`).toBeUndefined();
      }
    }
    const note = sliver.labels.find((label) => label.id === 'annotation:note-worst-drop')!;
    expect(note.hidden).toBeUndefined();
    expect(note.owner).toEqual({ categoryId: 'q3', annotationId: 'note-worst-drop' });
    expect(sliver.annotations).toContainEqual(
      expect.objectContaining({ id: 'note-worst-drop', labelId: note.id }),
    );
    // The callout owns the reserved right column, clear of the value label
    // slot, and carries no leader through it.
    const total = sliver.labels.find((label) => label.id === 'total:q3')!;
    expect(note.leader).toBeUndefined();
    expect(note.rect.x).toBeGreaterThan(total.rect.x + total.rect.w);
    expect(note.text).not.toContain('…');
  });
  it('draws the Biggest drop callout only on request and keeps derived.worstDrop', () => {
    const { data, options } = fixture('signup-simple');
    const plain = layout(data, options);
    expect(plain.derived.worstDrop).toMatchObject({ fromId: 'visitors', toId: 'trial' });
    expect(plain.labels.map((label) => label.id)).not.toContain('annotation:note-worst-drop');
    expect(plain.annotations.map((annotation) => annotation.id)).not.toContain('note-worst-drop');
    const opted = layout(data, { ...options, worstDropCallout: true });
    expect(opted.labels.find((label) => label.id === 'annotation:note-worst-drop')?.hidden).toBeUndefined();
    const centered = layout(data, { ...options, variant: 'centered', worstDropCallout: true });
    expect(centered.warnings.map((warning) => warning.code)).toContain('funnel-worst-drop-callout-rows-only');
  });
});

describe('a zero stage and a clamped value are said on the chart', () => {
  it('prints "not defined" in the gap after a zero stage and counts the clamped value in a note', () => {
    const texts = (geometry: FunnelGeometry) => geometry.scene.flatMap((node) => (node.t === 'text' ? [node.lines.join(' ')] : []));
    const { data, options } = fixture('zero-stage');
    const shown = { notes: { show: ['note', 'disclosure'] } };
    const rows = texts(layout(data, { ...options, ...shown } as never));
    expect(rows).toContain('not defined: previous stage is zero');
    expect(rows).toContain('1 value below zero shown as 0.');
    const centered = texts(layout(data, { ...options, ...shown, variant: 'centered' } as never));
    expect(centered).toContain('1 value below zero shown as 0.');
    expect(centered).toContain('n/a: not defined, the previous stage is zero.');
  });

  // A positive segment thinner than a pixel was dropped with no mark, label or warning.
  it('keeps a mark for every positive segment, however thin', () => {
    const geometry = layout({ categories: [{ id: 'won', label: 'Won' }], series: [{ id: 'open', label: 'Open', values: [0.01] }, { id: 'lost', label: 'Lost', values: [1e-9] }] } as ChartData);
    expect(geometry.marks.rows[0]!.segments.map((segment) => segment.id)).toEqual(['open', 'lost']);
  });
});
