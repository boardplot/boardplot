import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { canDraw, layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { render } from '../src/cli/render';
import { interactionRecords } from '../src/core/a11y/records';
import type { Geometry } from '../src/core/types/scene';

const fixture = (type: string, id: string) => getFixtures(type as never).find((item) => item.id === id)!;
const draw = (type: string, id: string, options: object) => {
  const item = fixture(type, id);
  return layoutResolvedRequest(resolveChartRequest({ type: type as never, data: item.data as never, options: { ...item.options, ...options } as never }));
};
const codes = (type: string, id: string, options: object) => draw(type, id, options).warnings.map((warning) => warning.code);
const wide = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { width: 5000 }]));

describe('authored column widths', () => {
  // On a fixed height a width changes how many lines the names take, so a chart that draws unset refused with the width.
  it('gives way on a fixed height and warns', () => {
    const cases: [string, string, number, number, Record<string, { width: number }>][] = [
      ['funnel', 'lead-funnel-full', 1051, 292, { value: { width: 5000 } }],
      ['bullet', 'ops-dashboard', 320, 500, { label: { width: 100 } }],
      ['box', 'twelve-teams-median-column', 800, 528, { label: { width: 20 } }],
    ];
    for (const [type, id, width, height, columnOverrides] of cases) {
      const drawn = draw(type, id, { size: { width, height }, columnOverrides });
      expect(`${type} ${Boolean(drawn.refused)}`).toBe(`${type} false`);
      expect(drawn.warnings.some((warning) => /^generated-column-width-(capped|floored)$/.test(warning.code))).toBe(true);
    }
  });

  // Widths that fit one by one squeezed the likert bars out together, and the chart asked for a canvas 10,000 px wide.
  it('never refuses a chart for a wide width, alone or together', () => {
    const cases: [string, string, string[], object][] = [
      ['likert', 'column-overrides', ['label', 'net', 'base'], {}],
      ['bullet', 'column-overrides', ['label', 'actual', 'target', 'gap'], {}],
      ['funnel', 'column-overrides', ['label', 'totalCvr'], {}],
      ['funnel', 'column-overrides', ['label', 'value'], { variant: 'rows' }],
    ];
    for (const [type, id, ids, options] of cases) {
      for (const width of [320, 480, 800]) {
        const unset = draw(type, id, { ...options, columnOverrides: undefined, size: { width } });
        const authored = draw(type, id, { ...options, columnOverrides: wide(ids), size: { width } });
        expect(`${type} ${width} ${Boolean(authored.refused)}`).toBe(`${type} ${width} ${Boolean(unset.refused)}`);
      }
    }
  });

  // A panel's width raises the height its grid needs, and the grid refused though it draws with the width unset.
  it('gives way in a grid panel and names the panel', () => {
    const panel = (panelId: string, type: string, id: string, columnOverrides: object) => {
      const { size: _size, ...options } = fixture(type, id).options as { size?: unknown };
      return { id: panelId, type, data: fixture(type, id).data, options: { ...options, columnOverrides } };
    };
    const side = { id: 'side', type: 'bar', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'Sales', values: [3, 5] }] } };
    const grid = (panels: object[], width: number, height: number) => ({ type: 'grid', data: { panels: [...panels, side] }, options: { size: { width, height } } }) as never;
    const funnel = grid([panel('main', 'funnel', 'lead-funnel', { value: { width: 300 } })], 800, 600);
    const drawn = layoutResolvedRequest(resolveChartRequest(funnel));
    expect(Boolean(drawn.refused)).toBe(false);
    const named = drawn.warnings.filter((warning) => /^generated-column-width-/.test(warning.code) && warning.message.startsWith('[main] '));
    expect(named.at(-1)!.field?.slice(0, 3)).toEqual(['data', 'panels', 0]);
    expect(canDraw(funnel).ok).toBe(true);
    // Two panels that fit alone can still refuse together, so they give way against the whole grid.
    const ladder = { label: { width: 20 } };
    const pair = { type: 'grid', data: { panels: [panel('first', 'bullet', 'four-band-neutral-ladder', ladder), panel('second', 'bullet', 'four-band-neutral-ladder', ladder)] }, options: { size: { width: 1200, height: 500 } } } as never;
    expect(canDraw(pair).ok).toBe(true);
  });

  describe('in nested grids and under type aliases', () => {
    const fromFixture = (type: string, id: string) => {
      const { size: _size, ...options } = fixture(type, id).options as { size?: unknown };
      return { data: fixture(type, id).data, options };
    };
    const side = { id: 'side', type: 'bar', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'Sales', values: [3, 5] }] } };
    const narrow = { label: { width: 20 } };
    const ladderPanel = (id: string, columnOverrides?: object) => {
      const { data, options } = fromFixture('bullet', 'four-band-neutral-ladder');
      return { id, type: 'bullet', data, options: { ...options, ...(columnOverrides ? { columnOverrides } : {}) } };
    };
    const inner = (id: string, type: string, panels: object[], options?: object) => ({ id, type, data: { panels }, ...(options ? { options } : {}) });
    const sized = (panels: object[], width: number, height: number) => ({ type: 'grid', data: { panels }, options: { size: { width, height } } }) as never;
    const widthWarnings = (drawn: { warnings: readonly { code: string; message: string; field?: readonly (string | number)[] }[] }) =>
      drawn.warnings.filter((warning) => /^generated-column-width-/.test(warning.code));
    const expectDraws = (spec: never, field: readonly (string | number)[], prefix: string) => {
      expect(canDraw(spec).ok).toBe(true);
      const drawn = layoutResolvedRequest(resolveChartRequest(spec));
      expect(Boolean(drawn.refused)).toBe(false);
      const moved = widthWarnings(drawn).filter((warning) => warning.field !== undefined);
      expect(moved.map((warning) => warning.field)).toContainEqual(field);
      expect(moved.find((warning) => warning.field!.join() === field.join())!.message.startsWith(`${prefix}columnOverrides.label.width`)).toBe(true);
      return drawn;
    };

    // The panel type was read before its alias resolved, so the alias refused where the type itself gave way.
    it('gives way under a panel type alias', () => {
      const { data, options } = fromFixture('likert', 'engagement-options');
      const spec = sized([{ id: 'first', type: 'diverging-stacked', data, options: { ...options, columnOverrides: { label: { width: 100 } } } }, side], 800, 600);
      expectDraws(spec, ['data', 'panels', 0, 'options', 'columnOverrides', 'label', 'width'], '[first] ');
    });

    // Only the top level of panels was read, so a panel one grid down kept its refusal.
    it('gives way in a nested grid, also an authored one and one written as an alias', () => {
      const field = (at: number) => ['data', 'panels', 0, 'data', 'panels', at, 'options', 'columnOverrides', 'label', 'width'];
      const pair = [ladderPanel('first', narrow), ladderPanel('second', narrow)];
      expectDraws(sized([inner('outer', 'grid', pair)], 1200, 600), field(1), '[outer] [second] ');
      expectDraws(sized([inner('outer', 'facets', pair)], 1200, 600), field(1), '[outer] [second] ');
    });

    it('gives way in a nested authored grid', () => {
      const pair = [ladderPanel('first', narrow), ladderPanel('second', narrow)];
      const spec = sized([inner('outer', 'grid', pair, { columns: [1] })], 1200, 600);
      expect(canDraw(sized([inner('outer', 'grid', pair.map(({ id }) => ladderPanel(id)), { columns: [1] })], 1200, 600)).ok).toBe(true);
      expectDraws(spec, ['data', 'panels', 0, 'data', 'panels', 1, 'options', 'columnOverrides', 'label', 'width'], '[outer] [second] ');
    });

    it('gives way in a nested repeat, at the template path', () => {
      const { data, options } = fromFixture('bullet', 'four-band-neutral-ladder');
      const repeat = (columnOverrides?: object) => ({ id: 'outer', type: 'grid', data: {
        repeat: { dimension: 'region', values: ['north', 'south'] },
        template: { id: '$region', type: 'bullet', data: { bySlice: { north: data, south: data } }, options: { ...options, ...(columnOverrides ? { columnOverrides } : {}) } },
      } });
      expect(canDraw(sized([repeat()], 1200, 600)).ok).toBe(true);
      expectDraws(sized([repeat(narrow)], 1200, 600), ['data', 'panels', 0, 'data', 'template', 'options', 'columnOverrides', 'label', 'width'], '[outer] ');
    });

    // The ids repeat across the two inner grids. A panel keeps its own warning when only its namesake moved.
    it('takes back only the warning of the panel that moved', () => {
      const spec = sized([
        inner('left', 'grid', [ladderPanel('first', narrow), ladderPanel('second')]),
        inner('right', 'grid', [ladderPanel('first', { label: { width: 5000 } }), ladderPanel('second')]),
      ], 1200, 1000);
      const drawn = layoutResolvedRequest(resolveChartRequest(spec));
      expect(Boolean(drawn.refused)).toBe(false);
      const left = widthWarnings(drawn).filter((warning) => warning.message.startsWith('[left] [first] '));
      expect(left.map((warning) => warning.field)).toEqual([['data', 'panels', 0, 'data', 'panels', 0, 'options', 'columnOverrides', 'label', 'width']]);
      const right = widthWarnings(drawn).filter((warning) => warning.message.startsWith('[right] [first] '));
      expect(right.map((warning) => warning.code)).toEqual(['generated-column-width-capped']);
      // Each level's range still lines up with its own panels, so a repaint replaces the same warnings.
      const walk = (geometry: { warnings: readonly { message: string }[]; marks: unknown }) => {
        for (const panel of (geometry.marks as { panels?: { id: string; chart?: { warningOffset?: number; geometry: never } }[] }).panels ?? []) {
          const chart = panel.chart;
          if (chart?.warningOffset === undefined) continue;
          const child = chart.geometry as { warnings: readonly { message: string }[]; marks: unknown };
          child.warnings.forEach((warning, index) => expect(geometry.warnings[chart.warningOffset! + index]!.message).toBe(`[${panel.id}] ${warning.message}`));
          walk(child);
        }
      };
      walk(drawn as never);
    });

    describe('in the slices of a nested repeat', { timeout: 60_000 }, () => {
      const sliceSpec = (slices: Record<string, unknown>, height: number, repeat: object = { dimension: 'region', values: ['north', 'south'] }, id = '$region') =>
        sized([{ id: 'outer', type: 'grid', data: { repeat, template: { id, type: 'grid', data: { bySlice: slices } } } }], 1200, height);
      const pairOf = (first?: object, second?: object) => ({ panels: [ladderPanel('first', first), ladderPanel('second', second)] });
      const atSlice = (key: string, at: number) => ['data', 'panels', 0, 'data', 'template', 'data', 'bySlice', key, 'panels', at, 'options', 'columnOverrides', 'label', 'width'];

      // Only panels and template were read, so a width in a slice found no group and the grid kept its refusal.
      it('gives way and warns at the authored path', () => {
        expect(canDraw(sliceSpec({ north: pairOf(), south: pairOf() }, 1100)).ok).toBe(true);
        const before = sliceSpec({ north: pairOf(narrow, narrow), south: pairOf() }, 1100);
        const copy = JSON.stringify(before);
        expectDraws(before, atSlice('north', 1), '[outer] [north] [second] ');
        expect(JSON.stringify(before)).toBe(copy);
      });

      // The inner ids repeat across the slices. A panel keeps its own warning when only its namesake moved.
      it('takes back only the warning of the slice that moved', () => {
        const drawn = expectDraws(sliceSpec({ north: pairOf(narrow), south: pairOf({ label: { width: 5000 } }) }, 1007), atSlice('north', 0), '[outer] [north] [first] ');
        const south = widthWarnings(drawn).filter((warning) => warning.message.startsWith('[outer] [south] [first] '));
        expect(south.map((warning) => warning.code)).toEqual(['generated-column-width-capped']);
      });

      // A slice draws with its placeholder filled in, so an id or a type read from the authored text names no panel.
      it('reads ids and types after the placeholder is filled in', () => {
        const filled = { panels: [ladderPanel('$region-a', narrow), ladderPanel('$region-b', narrow)] };
        expectDraws(sliceSpec({ north: filled, south: pairOf() }, 1100), atSlice('north', 1), '[outer] [north] [north-b] ');
        const typed = { panels: [{ ...ladderPanel('a', narrow), type: '$kind' }, { ...ladderPanel('b', narrow), type: '$kind' }] };
        expectDraws(sliceSpec({ bullet: typed }, 600, { dimension: 'kind', values: ['bullet'] }, 'chart'), atSlice('bullet', 1), '[outer] [chart] [b] ');
      });

      // A key outside repeat.values passes validation and never draws, so it must not stop the give-way.
      it('skips a slice that does not draw', () => {
        expectDraws(sliceSpec({ north: pairOf(narrow, narrow), south: pairOf(), west: 12, unused: { panels: [null] } }, 1100), atSlice('north', 1), '[outer] [north] [second] ');
      });
    });

    it('does not change the caller object and keeps a refusal that holds with every width unset', () => {
      const spec = sized([inner('outer', 'grid', [ladderPanel('first', narrow), ladderPanel('second', narrow)])], 1200, 600);
      const before = JSON.stringify(spec);
      layoutResolvedRequest(resolveChartRequest(spec));
      expect(JSON.stringify(spec)).toBe(before);
      const tooSmall = sized([inner('outer', 'grid', [ladderPanel('first', narrow), ladderPanel('second', narrow)])], 1200, 120);
      expect(canDraw(tooSmall).ok).toBe(false);
    });
  });

  // A cap the author does not hear about looks like the option did nothing.
  it('warns when a wide width stops at the plot floor', () => {
    expect(codes('dot', 'column-overrides', { columnOverrides: { label: { width: 5000 } } })).toContain('generated-column-width-capped');
  });

  // The diverging slope has no change column, so a width there would do nothing without a word.
  it('refuses columnOverrides on the diverging slope', () => {
    const slope = fixture('slope', 'diverging-sort-data');
    expect(() => layoutResolvedRequest(resolveChartRequest({ type: 'slope', data: slope.data as never, options: { ...slope.options, columnOverrides: { change: { width: 60 } } } as never }))).toThrow();
    const result = render({ spec: { type: 'slope', data: slope.data, options: { ...slope.options, columnOverrides: { change: { width: 60 } } } } } as never);
    expect(result.exit).not.toBe(0);
  });
});

describe('bullet columns', () => {
  // The compact mark has no columns or lines, so these keys would otherwise do nothing without a word.
  it('refuses the column keys and label lines on density compact', () => {
    for (const options of [{ columnVisibility: { target: false } }, { columnOrder: ['plot'] }, { columnOverrides: { label: { width: 60 } } }, { labels: { direction: false } }]) {
      const result = draw('bullet', 'compact-120', options);
      expect(result.warnings.some((warning) => warning.code === 'invalid-options')).toBe(true);
    }
  });

  // A hidden column takes its hover value with it; hiding a printed label alone does not.
  it('drops the hover value of a hidden column', () => {
    const displayed = (options: object, part: string) => (draw('bullet', 'column-overrides', { columnOverrides: undefined, ...options }) as Geometry).scene.filter((node) => (node as { part?: string }).part === part).some((node) => (node as { display?: unknown }).display !== undefined);
    expect(displayed({}, 'target')).toBe(true);
    expect(displayed({ columnVisibility: { target: false } }, 'target')).toBe(false);
    expect(displayed({ columnVisibility: { actual: false } }, 'bar')).toBe(false);
  });

  // The values print on the rows here, so saying the chart does not draw them would be false.
  it('says a form without tracks cannot move a printed column', () => {
    const found = codes('bullet', 'column-overrides', { columnOverrides: undefined, targetColumns: false, columnOrder: ['actual', 'plot'] });
    expect(found).toContain('option-ignored');
    expect(found).not.toContain('generated-id-unknown');
  });

  // An id in the warning's field path crashed the render as an invalid JSON array index.
  it('warns with the list for ids the current form does not draw', () => {
    const result = draw('bullet', 'column-overrides', { columnOverrides: undefined, columnVisibility: { share: false }, columnOrder: ['delta', 'plot'] });
    const unknown = result.warnings.filter((warning) => warning.code === 'generated-id-unknown');
    expect(unknown.map((warning) => warning.field?.[1])).toEqual(expect.arrayContaining(['columnVisibility', 'columnOrder']));
    expect(unknown[0]!.message).toContain('gap');
  });

  // Without the number and without the warning, the reader cannot tell what the target tick stands for.
  it('warns when the target column leaves the tick unexplained', () => {
    expect(codes('bullet', 'column-overrides', { columnOverrides: undefined, columnVisibility: { target: false } })).toContain('bullet-target-column-hidden');
  });

  // Two spellings of one request must draw the same rows, or authors get different charts for the same wish.
  it('draws strings.lowerBetter empty like labels.direction false on lower-is-better rows', () => {
    const item = fixture('bullet', 'no-direction-line');
    const lower = { ...item.data as object, rows: (item.data as { rows: object[] }).rows.map((row) => ({ ...row, direction: 'lowerIsBetter' })) };
    const scene = (options: object) => JSON.stringify((layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: lower as never, options: { ...item.options, labels: undefined, ...options } as never })) as Geometry).scene);
    expect(scene({ strings: { lowerBetter: '' } })).toBe(scene({ labels: { direction: false } }));
  });
});

describe('hidden bullet columns in records', () => {
  const rows = [{ id: 'one', label: 'First', value: 42, target: 60 }, { id: 'two', label: 'Second', value: 75, target: 80 }];
  const records = (options: object) => {
    const request = resolveChartRequest({ type: 'bullet', data: { rows } as never, options: { size: { width: 900, height: 300 }, ...options } as never });
    return interactionRecords({ request, geometry: layoutResolvedRequest(request) as Geometry, scope: request.scope, claims: [] });
  };
  const first = (options: object) => records(options)[0]!;
  const numbers = (record: ReturnType<typeof first>) => [record.value.raw, ...record.fields.map((field) => field.value.raw), ...record.comparisons.flatMap((comparison) => [comparison.current.raw, comparison.reference.raw])];

  // A removed column printed nothing on the chart but still printed in the hover card and the data table.
  it('follows the target-column form, one column at a time', () => {
    const open = first({ targetColumns: true });
    expect(open.value.raw).toBe(42);
    expect(open.fields.map((field) => field.key)).toEqual(['target']);
    expect(open.comparisons).toHaveLength(1);

    const noActual = first({ targetColumns: true, columnVisibility: { actual: false } });
    expect(noActual.value.raw).toBe(60);
    expect(noActual.valueLabel).toBe('Target');
    expect(noActual.fields.map((field) => field.key)).toEqual(['gap']);
    expect(numbers(noActual)).not.toContain(42);

    const noTarget = first({ targetColumns: true, columnVisibility: { target: false } });
    expect(noTarget.value.raw).toBe(42);
    expect(noTarget.fields.map((field) => field.key)).toEqual(['gap']);
    expect(noTarget.comparisons).toEqual([]);

    const noGap = first({ targetColumns: true, columnVisibility: { gap: false } });
    expect(noGap.fields.map((field) => field.key)).toEqual(['target']);
    expect(noGap.comparisons).toEqual([]);

    const gapLeads = first({ targetColumns: true, columnVisibility: { actual: false, target: false } });
    expect(gapLeads.value.raw).toBe(-18);
    expect(numbers(gapLeads)).toEqual([-18]);
  });

  it('follows the percent-of-target form, one column at a time', () => {
    const percent = { sharedScale: 'percentOfTarget' };
    const shareLeads = first({ ...percent, columnVisibility: { actual: false } });
    expect(shareLeads.value.raw).toBe(70);
    expect(numbers(shareLeads)).not.toContain(42);
    const deltaLeads = first({ ...percent, columnVisibility: { actual: false, share: false } });
    expect(deltaLeads.value.raw).toBe(-18);
    // The delta column still prints, so its number stays in the record for the hover card and the data table.
    const noShare = first({ ...percent, columnVisibility: { share: false } });
    expect(noShare.comparisons).toEqual([]);
    expect(noShare.fields.find((field) => field.key === 'delta')?.value.raw).toBe(-18);
    expect(first({ ...percent, columnVisibility: { delta: false } }).comparisons).toEqual([]);
    expect(records({ ...percent, columnVisibility: { actual: false, share: false, delta: false } })).toEqual([]);
  });

  it('leaves no record when every column is hidden', () => {
    expect(records({ targetColumns: true, columnVisibility: { actual: false, target: false, gap: false } })).toEqual([]);
  });

  // An id the form does not draw and a label switch only stop printing, so the record stays as it was.
  it('keeps the record for an id the form does not draw and for label switches', () => {
    const open = first({ targetColumns: true });
    const same = (record: ReturnType<typeof first>) => [record.value.raw, record.fields.length, record.comparisons.length];
    expect(same(first({ targetColumns: true, columnVisibility: { share: false, delta: false } }))).toEqual(same(open));
    expect(same(first({ targetColumns: true, labels: { point: false } }))).toEqual(same(open));
    expect(same(first({ targetColumns: true, labels: { annotation: false } }))).toEqual(same(open));
    expect(same(first({ targetColumns: true, labels: { point: false }, columnVisibility: { actual: false } }))).toEqual(same(open));
  });
});
