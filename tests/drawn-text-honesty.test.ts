import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, measure, resolveChartRequest } from '../src/core/request';
import { defaultMeasurer } from '../src/core/text';
import { isNumberAlone } from '../src/core/textRole';
import { emphasisWeight, resolveTheme } from '../src/core/theme';
import { clippedTextWarnings } from '../src/core/textClip';
import type { Geometry } from '../src/core/types/scene';
// @ts-expect-error The census script is plain JavaScript.
import { censusCase, garbled, tokens } from '../scripts/number-census.mjs';

const svgOf = (spec: unknown): string => (render({ spec, format: 'svg', return: ['svg'] }).body as { svg: string }).svg;
const descOf = (svg: string) => /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? '';

// Accounting and share labels must keep numeric typography without treating prose or nested brackets as numbers.
it('keeps numeric roles for Unicode numbers, accounting and shares', () => {
  for (const text of ['', '  ', 'n/a', 'n.m.', '—', '1,234.50', '−1.2bn', '12USD', '35.6M (37%)',
    '35.6M(37%)', ' 35.6M\n(37%) ', '($1,200,000.00)', '( 12 )', '(−1.2bn)', '؜-١٬٢٣٤٫٥',
    '١٢٪؜', '𝟙𝟚𝟛', '١٢ (۳۴٪)']) expect(isNumberAlone(text), text).toBe(true);
  for (const text of ['USD12', '12 May 2026', '12 vs target', '(12)(34)', '12 ((34))', '(12) (34)',
    '12 (34) (56)', '12 (34) trailing', '12 (n/a)', 'n/a (34)', '()', '12 )', '12 (34', '($12))']) {
    expect(isNumberAlone(text), text).toBe(false);
  }
});

describe('the description states the drawn numbers', () => {
  // The description reformatted the raw value and said "0%, 1%" where the labels read "6%, 54%".
  for (const type of ['bar', 'column', 'dot']) {
    it(`${type}: one series reads its labels, not the raw values`, () => {
      const svg = svgOf({ type, data: {
        categories: [{ id: 'a', label: 'North' }, { id: 'b', label: 'South' }],
        series: [{ id: 's', label: 'Churn rate', values: [{ number: 0.06, label: '6%' }, { number: 0.54, label: '54%' }] }],
      }, options: { title: 'Churn by region' } });
      expect(descOf(svg)).toMatch(/North 6%[,;] South 54%/);
    });
  }
});

describe('drawn text stays on the canvas', () => {
  const names = [
    'Membership-supported equipment', 'Subscription-supported training',
    'Equipment-maintenance contracts', 'Distribution-management services',
    'Subscription-management services', 'Software-maintenance agreements',
    'Equipment-rental arrangements', 'Warehouse-management services',
  ];

  // A highlighted rotated column name measured at regular weight was clipped at the left edge.
  it('column: highlighted rotated names fit at their drawn weight in every variant', () => {
    const data = {
      categories: names.map((label, i) => ({ id: `c${i}`, label })),
      series: [
        { id: 'a', label: 'Online', values: [25, 20, 35, 30, 20, 25, 10, 20] },
        { id: 'b', label: 'Stores', values: [20, 10, 15, 10, 5, 20, 10, 25] },
      ],
    };
    for (const variant of ['grouped', 'stacked', 'stacked100']) {
      const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data,
        options: { variant, highlight: 'c0', size: { width: 520, height: 700 } },
      } as never)) as Geometry;
      const label = geometry.scene.find(node => node.id === 'label:category:c0');
      expect(label?.t).toBe('text');
      if (label?.t !== 'text') continue;
      expect(label.rotate).toBe(-45);
      expect(label.lines).toEqual([names[0]]);
      expect(label.font.weight).toBe(emphasisWeight(resolveTheme()));
      expect(clippedTextWarnings(geometry, defaultMeasurer)).toEqual([]);
    }
  });

  // A retried row plan read the bold widths back from the plan cache and lost the extra row height.
  it('column: a retried row plan keeps the height of a highlighted rotated name', () => {
    const fixture = getFixtures('column').find((f) => f.id === 'stacked-series-cagr')!;
    const data = structuredClone(fixture.data) as { categories: { id: string; label?: string }[] };
    data.categories.forEach((c, i) => { c.label = names[i % names.length]; });
    const first = data.categories[0]!.id;
    const baseline = (highlight?: string) => {
      const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data,
        options: { ...fixture.options, ...(highlight ? { highlight } : {}), size: { width: 720, height: 700 } },
        annotations: fixture.annotations,
      } as never)) as Geometry;
      const axis = geometry.scene.find(node => node.id === 'axis:baseline');
      return axis?.t === 'line' ? axis.y1 : NaN;
    };
    expect(baseline()).toBeGreaterThan(baseline(first));
  });

  // A bold extreme label was seated at its regular width and ran 5 px past the right edge.
  it('column: the bold extreme label fits at its drawn width', () => {
    const fixture = getFixtures('column').find((f) => f.id === 'anomaly-torture')!;
    const data = structuredClone(fixture.data) as { series: { values: unknown[] }[] };
    for (const s of data.series) s.values = s.values.map((v) => (typeof v === 'number' ? v * 1234.567 : v));
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { ...fixture.options, size: { width: 360 } }, annotations: fixture.annotations } as never)) as Geometry;
    const label = geometry.scene.find((n) => n.t === 'text' && n.id.includes('extreme'));
    expect(label?.t).toBe('text');
    if (label?.t !== 'text') return;
    expect(label.x + defaultMeasurer(label.lines[0]!, label.font).width).toBeLessThanOrEqual(geometry.size.width);
    expect(geometry.warnings.map((w) => w.code)).not.toContain('text-clipped');
  });

  // A text past the edge was cut off with no warning at all.
  it('a text past the edge warns text-clipped', () => {
    const font = { family: 'Helvetica', size: 12 };
    const geometry = { size: { width: 200, height: 100 }, scene: [{ t: 'text', id: 'label:end', x: 150, y: 40, lines: ['Northern region'], font, align: 'start' }] } as unknown as Geometry;
    const [warning] = clippedTextWarnings(geometry, defaultMeasurer);
    expect(warning?.code).toBe('text-clipped');
    expect(warning?.message).toContain("'Northern region' (label:end");
  });
});

describe('currency signs print where the locale puts them', () => {
  // Mekko joined "$" after the figure as if it were a word unit: "10,000 $" in English.
  const mekko = (language: string) => svgOf({ type: 'mekko', data: {
    categories: [{ id: 'a', label: 'North' }],
    series: [{ id: 'web', label: 'Web', unit: '$', values: [6000] }, { id: 'store', label: 'Store', unit: '$', values: [4000] }],
  }, options: { title: 'Revenue', variant: 'stacked100', locale: { language } } });
  it('English puts $ before the figure, German after it', () => {
    expect(mekko('en')).toContain('$10,000');
    expect(mekko('de')).toMatch(/>10,000\s\$</);
  });
});

describe('text read back from the SVG matches the drawn text', () => {
  const textOf = (svg: string, id: string) => {
    const node = new RegExp(`<text data-id="${id}"[^>]*>([\\s\\S]*?)</text>`).exec(svg)?.[1] ?? '';
    return node.replace(/<[^>]*>/g, '');
  };
  // A wrapped title read back from the SVG joined its two lines as "reopenedat".
  it('a wrapped line break keeps a space and does not move the lines', () => {
    const svg = svgOf({ type: 'column', data: { categories: ['A', 'B'], series: [{ id: 's', label: 'Sales', values: [4, 5] }] },
      options: { title: 'Total orders rose every single week after the store reopened at 15:00 UTC in late October, website first and then the app', size: { width: 760 } } });
    expect(textOf(svg, 'frame:title:0')).toContain('reopened at 15:00');
    expect(svg).toMatch(/<tspan x="24" dy="0"> <\/tspan><tspan x="24" dy="25">at 15:00/);
  });

  // A cut label kept its full text in a <title> inside <text>, so read-back text ran the full and the cut text together.
  it('the hover title of a cut label sits on its group, not inside the text', () => {
    const fixture = getFixtures('dot').find((f) => f.id === 'long-labels-lollipop')!;
    const svg = svgOf({ type: 'dot', data: fixture.data, options: fixture.options, annotations: fixture.annotations });
    expect(svg).not.toMatch(/<text\b[^>]*><title>/);
    expect(svg).toMatch(/<g role="img" aria-label="[^"]+"><title>[^<]+<\/title>(<rect[^>]*\/>)?<text\b/);
  });
});

describe('number census', () => {
  // The census scaled "$k" box statistics by 1,000 twice and flagged correct medians as wrong-scale.
  it('reads $k box statistics once', () => {
    const fixture = structuredClone(getFixtures('box').find((f) => f.id === 'salary-bands-p10p90')!) as { options: { unit: string } };
    fixture.options.unit = '$k';
    const { findings } = censusCase('box', fixture, 720, 'en') as { findings: { class: string }[] };
    expect(findings.filter((f) => f.class === 'wrong-scale')).toEqual([]);
  });

  const en = { decimal: '.', thousands: ',' };
  type Finding = { class: string; id: string };
  const scaled = <T,>(value: T, factor: number): T => JSON.parse(JSON.stringify(value), (_, v) => (typeof v === 'number' ? v * factor : v));

  // The census did not know the trillion magnitude, so it read "$4.8T" as 4.8 and flagged a correct value.
  it('reads the trillion magnitude', () => {
    expect(tokens('$4.8T', en)[0]?.value).toBe(4.8e12);
    expect(tokens('2.1 trillion', en)[0]?.value).toBe(2.1e12);
  });

  // A dimswitch row is a measure with its own scale, so a column that prints "120,000" orders and "12.0M" revenue is not mixed units.
  it('reads a dimswitch column as one unit per row', () => {
    const fixture = structuredClone(getFixtures('dimswitch').find((f) => f.id === 'no-group-heads')!) as { data: { facts: unknown } };
    fixture.data.facts = scaled(fixture.data.facts, 1000);
    const { findings } = censusCase('dimswitch', fixture, 320, 'en') as { findings: Finding[] };
    expect(findings.filter((f) => f.class === 'mixed-units')).toEqual([]);
  });

  // A log axis steps by decades ("500M", "1.0B"), so its ticks print several magnitudes by design;
  // the same ticks on a linear axis still mix magnitudes.
  it('spares log-axis ticks and still flags mixed magnitudes on a linear axis', () => {
    const fixture = structuredClone(getFixtures('scatter').find((f) => f.id === 'log-both-stores-revenue')!) as { data: { points: unknown }; options: Record<string, unknown> };
    fixture.data.points = scaled(fixture.data.points, 1e6);
    const request = { type: 'scatter', data: fixture.data, options: { ...fixture.options, size: { width: 320 } }, annotations: [] };
    const axisFindings = (measured: unknown) => (censusCase('scatter', fixture, 320, 'en', measured) as { findings: Finding[] }).findings
      .filter((f) => f.class === 'mixed-units' && /^:[xy]$/.test(f.id));
    expect(axisFindings(measure(request as never))).toEqual([]);
    // Move every tick to a position affine in its value: the axis now reads as linear.
    const linear = measure(request as never) as { geometry: { axes: { ticks: { at: number; pos: number }[] }[] } };
    for (const axis of linear.geometry.axes) for (const tick of axis.ticks) tick.pos = tick.at / 1e7;
    expect(axisFindings(linear).length).toBeGreaterThan(0);
  });

  // Removing spaces before the authored-text skip turned the list comma in "(0.6, 17)" into a decimal comma.
  it('reads a list comma as a list comma and still flags a decimal comma', () => {
    const withAuthored = { ...en, authored: ['Plant1'] };
    expect(garbled('Not labelled on the chart: Payments (0.6, 17), and 1 more.', withAuthored)).toEqual([]);
    expect(garbled('Payments 1,5 m (0.6, 17)', withAuthored)).toContain("decimal comma in a chart with '.' marks");
  });

  type Spec = { data: unknown; options?: Record<string, unknown>; annotations?: unknown[] };
  const fixtureOf = <T extends Spec = Spec>(type: string, id: string) => structuredClone(getFixtures(type).find((f) => f.id === id)!) as unknown as T;
  /** Census findings of a spec at one width; `edit` changes the drawn geometry first, to plant a defect. */
  const census = (type: string, spec: Spec, width: number, edit?: (geometry: Geometry) => void): Finding[] => {
    const measured = measure({ type, data: spec.data, options: { ...spec.options, size: { width } }, annotations: spec.annotations ?? [] } as never) as { geometry: Geometry };
    edit?.(measured.geometry);
    return (censusCase(type, spec, width, 'en', measured) as { findings: Finding[] }).findings;
  };
  const retext = (id: string, text: string) => (geometry: Geometry) => {
    const node = geometry.scene.find((n) => n.id === id);
    if (node?.t !== 'text') throw new Error(`no text ${id}`);
    node.lines = [text];
  };
  const of = (findings: Finding[], cls: string, id?: string) => findings.filter((f) => f.class === cls && (id === undefined || f.id.includes(id)));

  // A bartable's totals of two measures ("$k" savings, a count of roles) were read as one group of mixed magnitudes.
  it('reads bartable totals per column and still flags mixed magnitudes in one column', () => {
    const spec = fixtureOf('bartable', 'null-and-long-labels');
    spec.data = scaled(spec.data, 1e6);
    expect(of(census('bartable', spec, 320), 'mixed-units')).toEqual([]);
    expect(of(census('bartable', spec, 320, retext('label:end:fte:a', '18,000,000')), 'mixed-units')).not.toEqual([]);
  });

  // A grid inside a grid: the census read the panel types of the outer panels only and flagged the inner variance panel.
  it('applies the contract of a nested grid panel by its own type', () => {
    const categories = [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }];
    const series = [{ id: 'ac', label: 'Actual', scenario: 'AC', values: [40, 46] }, { id: 'pl', label: 'Plan', scenario: 'PL', role: 'reference', values: [42, 44] }];
    const inner = { panels: [{ id: 'sales', type: 'column', data: { categories, series } },
      { id: 'gap', type: 'variance', data: { categories, series }, options: { variant: 'absolute', variance: { vs: 'pl' } } }] };
    const spec = { data: { panels: [{ id: 'inner', type: 'grid', data: inner }, { id: 'total', type: 'column', data: { categories, series: [series[0]] } }] } };
    expect(of(census('grid', spec, 720), 'unbound')).toEqual([]);
  });

  // A table row prints its magnitude in its unit affix ("Revenue $M"); the census did not read it and flagged every cell and rounding gap as wrong-scale.
  it('reads a table row in the magnitude its unit affix names and still flags a row without one', () => {
    const spec = fixtureOf('table', 'steering-table-v2');
    spec.options = { ...spec.options, magnitude: 'million' };
    expect(of(census('table', spec, 840), 'wrong-scale')).toEqual([]);
    expect(of(census('table', spec, 840, retext('unit:revenue', 'net')), 'wrong-scale', 'cell:revenue:m1')).not.toEqual([]);
    // An affix in millions beside a cell in thousands is a contradiction, not a repeat of the cell's magnitude.
    expect(of(census('table', spec, 840, retext('cell:revenue:m1', '6,980.0k')), 'mixed-units', 'cell:revenue:m1')).not.toEqual([]);
  });

  // A map overlay label is the author's text ("UK 78%"); it was read as the overlay glyph's value.
  it('leaves overlay labels to the author and still checks a printed map value', () => {
    const spec = fixtureOf<Spec & { data: { overlays: { glyph: { value: number } }[] } }>('choropleth', 'world-footprint');
    for (const overlay of spec.data.overlays) overlay.glyph.value = 0;
    expect(of(census('choropleth', spec, 720), 'mismatch')).toEqual([]);
    expect(of(census('choropleth', spec, 720, retext('label:value-table-value:GB', '80')), 'mismatch', 'value-table-value:GB')).not.toEqual([]);
  });

  // Under basis 'previous' a period with no survivors makes every later cell of its cohort n.m.; the census recomputed a rate.
  it('accepts the n.m. tail after a period with no survivors and still flags an n.m. without one', () => {
    const spec = fixtureOf<Spec & { data: { cohorts: { id: string; active: number[] }[] } }>('cohort', 'retention-previous-period');
    const [first, second] = spec.data.cohorts;
    first!.active[1] = 0;
    expect(of(census('cohort', spec, 320), 'derived')).toEqual([]);
    const blank = (geometry: Geometry) => {
      const row = (geometry.derived as { cohorts: { id: string; retention: (number | null)[] }[] }).cohorts.find((c) => c.id === second!.id)!;
      row.retention[1] = null;
    };
    expect(of(census('cohort', spec, 320, blank), 'derived', `${second!.id}:t1`)).not.toEqual([]);
  });

  // ">−0.1pp" says a change between −0.1 and 0; the census read it as a magnitude above 0.1.
  it('reads a negative bound toward zero and still flags a bound the value breaks', () => {
    const spec = fixtureOf<Spec & { data: { measures: { id: string; value: { factor?: number } }[] } }>('dimswitch', 'thresholds-by-kind');
    spec.data.measures.find((entry) => entry.id === 'rate')!.value.factor = 0.1;
    const id = 'cell:["by-measure","total","rate"]:pp';
    expect(census('dimswitch', spec, 400).filter((f) => f.class === 'wrong-scale')).toEqual([]);
    expect(census('dimswitch', spec, 400, retext(id, '>−0.01pp')).filter((f) => f.id === id)).not.toEqual([]);
  });

  // Sum-consistent rounding prints a share one step off ("10%" for 9.25%); the census read it as another scale first.
  it('reads a sum-consistent share before another scale and still flags a share at the wrong scale', () => {
    const spec = fixtureOf<Spec & { data: { categories: { id: string; label: string }[]; series: { values: number[] }[] } }>('mekko', 'rounding-smallest-tie');
    spec.data.categories = [...spec.data.categories, { id: 'b', label: 'Second market' }];
    for (const series of spec.data.series) series.values = [...series.values, ...series.values];
    expect(of(census('mekko', spec, 320), 'wrong-scale')).toEqual([]);
    expect(census('mekko', spec, 320, retext('label:segment:tiny:b', '1%')).map((f) => f.class)).toContain('wrong-scale');
  });

  // A percent change off a base the table prints as 0 is n.m. (near-zero base); the census recomputed it.
  it('accepts n.m. off a base printed as zero and still flags n.m. off a printed base', () => {
    const spec = fixtureOf('table', 'department-steering-mini');
    spec.data = scaled(spec.data, 1e-3);
    expect(of(census('table', spec, 400), 'derived')).toEqual([]);
    expect(of(census('table', spec, 400, retext('cell:operations:py', '<0.1')), 'derived')).toEqual([]);
    expect(of(census('table', spec, 400, retext('cell:operations:py', '440')), 'derived', 'operations:yoy')).not.toEqual([]);
  });

  // A hidden base column is read from its record: an n.m. was accepted for any hidden base, also a nonzero one.
  it('accepts n.m. off a hidden base that prints as zero and flags n.m. off a hidden nonzero base', () => {
    const spec = fixtureOf('table', 'steering-theme-conventions');
    const small = { ...spec, data: scaled(spec.data, 1e-3) };
    expect(of(census('table', small, 400), 'derived')).toEqual([]);
    const nm = (geometry: Geometry) => {
      const cell = (geometry.derived as { computedCells: { rowId: string; colId: string; raw: number | null; state: string; displayed: string }[] })
        .computedCells.find((c) => c.rowId === 'revenue-north' && c.colId === 'yoy')!;
      Object.assign(cell, { raw: null, state: 'nm', displayed: 'n.m.' });
    };
    expect(of(census('table', spec, 400, nm), 'derived', 'revenue-north:yoy')).not.toEqual([]);
  });

  // "1.3 CHF M" puts a currency code between the figure and its magnitude, and the second subtitle line names it.
  it('reads a magnitude after a currency code', () => {
    expect(tokens('1.3 CHF M', en)[0]?.value).toBe(1.3e6);
    const spec = fixtureOf('table', 'shared-spaced-cash-movement');
    spec.data = scaled(spec.data, 1e3);
    expect(of(census('table', spec, 320), 'wrong-scale')).toEqual([]);
  });

  // A bullet prints its gap as printed value minus printed target, so "−$0.1" between "$0.4" and "$0.5" is right.
  it('reads a bullet gap from its printed operands and still flags a gap that is neither', () => {
    const spec = fixtureOf<Spec & { data: { rows: { id: string; value: unknown; target: unknown }[] } }>('bullet', 'columns-hidden');
    spec.options = { ...spec.options, sharedScale: true };
    const revenue = spec.data.rows.find((row) => row.id === 'revenue')!;
    revenue.value = { number: 0.412, format: '$412k' };
    revenue.target = { number: 0.45, format: '$450k' };
    expect(of(census('bullet', spec, 600), 'wrong-scale')).toEqual([]);
    expect(census('bullet', spec, 600, retext('label:delta:revenue', '−$0.2')).filter((f) => f.id === 'delta:revenue')).not.toEqual([]);
  });

  // With the target column hidden, "−$1" between "$1" and a plan of $2 is the same rule, and the census called it a mismatch.
  it('reads a bullet gap from its printed operands when the target column is hidden', () => {
    const spec = fixtureOf<Spec & { data: { rows: { id: string; value: unknown; target: unknown }[] } }>('bullet', 'columns-hidden');
    spec.options = { ...spec.options, columnVisibility: { target: false } };
    const revenue = spec.data.rows.find((row) => row.id === 'revenue')!;
    revenue.value = { number: 1.25, format: '$1,234' };
    revenue.target = { number: 1.5, format: '$1,234' };
    expect(census('bullet', spec, 600).filter((f) => f.id === 'delta:revenue')).toEqual([]);
  });
});

describe('a key label leaves room for its own value', () => {
  // The key label wrapped as if it had no value, so a long group name pushed its total past the edge and cut '1,664' to '1,'.
  it('treemap key: label and group total fit a 320 px frame at textScale 1.5', () => {
    const names = ['Training and certification', 'Enterprise software licences', 'Managed services and support', 'Subscription revenue, monthly plans'];
    const groups = names.map((label, i) => ({ id: `g${i}`, label }));
    const items = names.flatMap((_, i) => [0, 1].map((j) => ({ id: `i${i}${j}`, label: `Item ${i}${j}`, group: `g${i}`, value: 800 + i * 20 + j * 5 })));
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'treemap', data: { groups, items }, options: { variant: 'rect', size: { width: 320, height: 600 }, cellValue: 'value-share', textScale: 1.5 } } as never)) as Geometry;
    expect(geometry.scene.some((n) => n.t === 'text' && n.part === 'legendValue')).toBe(true);
    expect(geometry.warnings.map((w) => w.code)).not.toContain('text-clipped');
  });
});

describe('mekko column names', () => {
  // On a percent mekko, a column too narrow for its name lost the name, and its footnote mark then pushed the wide columns' names out of the row too.
  it('percent: every column keeps its name, a narrow one on a second tier', () => {
    const ids = ['home', 'kitchen', 'garden', 'light', 'storage', 'textiles'];
    const names = ['Home goods', 'Kitchen and dining', 'Garden and outdoor', 'Lighting', 'Storage', 'Textiles'];
    const spec = {
      type: 'mekko',
      data: {
        categories: ids.map((id, i) => ({ id, label: names[i], ...(i >= 4 ? { footnote: i - 3 } : {}) })),
        series: [
          { id: 'a', label: 'Marlowe', values: [2.4, 0.5, 0.3, 0.2, 0.2, 0.1] },
          { id: 'b', label: 'Other', values: [3.0, 1.1, 0.9, 0.5, 0.4, 0.2] },
        ],
      },
      options: { variant: 'stacked100', footnotes: ['Storage and organisation', 'Home textiles'], target: 'slide' },
    };
    const geometry = layoutResolvedRequest(resolveChartRequest(spec as never)) as Geometry;
    const drawn = (id: string) => geometry.scene.flatMap((n) => (n.t === 'text' && n.id === `label:category:${id}` ? [n.lines.join(' ')] : []))[0] ?? '';
    expect(ids.map(drawn).map((text, i) => text.startsWith(names[i]!))).toEqual(ids.map(() => true));
  });
});

// The census skips authored text before it looks for the other decimal mark; the skip must not hide a real wrong mark.
it('flags a figure in the other decimal mark and spares authored text', () => {
  const en = { decimal: '.', authored: ['Plant1,5'] };
  const de = { decimal: ',', authored: [] };
  expect(garbled('1,5 m', en)).toContain("decimal comma in a chart with '.' marks");
  expect(garbled('Plant1,5', en)).toEqual([]);
  expect(garbled('1.5 m', de)).toContain("decimal point in a chart with ',' marks");
  expect(garbled('1,5 m', de)).toEqual([]);
});

describe('a unit that names a scale takes no second one', () => {
  const texts = (spec: unknown) => [...svgOf(spec).matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map((match) => match[1]!.replace(/<[^>]*>/g, ''));
  const scaled = (all: string[]) => all.filter((text) => /\d(?:\.\d+)?\s?[MB]\b/.test(text));

  // A bar table whose chart unit is "$m" printed its bar ends "2.0M | 3.5M" under "Revenue in $m": the formatter read only the panel unit.
  it('prints bar table ends whole under a chart scale unit', () => {
    const all = texts({ type: 'bartable', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'Bookings' }],
      panels: [{ id: 'revenue', label: 'Revenue', values: { s: [2_000_000, 3_500_000] } }] }, options: { unit: '$m', subtitle: { measure: 'Revenue' }, size: { width: 720 } } });
    expect(all).toContain('3,500,000');
    expect(scaled(all)).toEqual([]);
  });

  // A choropleth key under "in $m" printed its breaks "20M | 30M": the key formatter forced its own magnitude.
  it('prints choropleth key breaks whole under a scale unit', () => {
    const all = texts({ type: 'choropleth', data: { pack: 'de-states', regions: [{ id: 'DE-BY', value: 10_000_000 }, { id: 'DE-NW', value: 50_000_000 }] },
      options: { unit: '$m', subtitle: { measure: 'Revenue' }, steps: [20_000_000, 30_000_000, 40_000_000, 45_000_000], labels: 'none', valueTable: false, size: { width: 960, height: 640 } } });
    expect(all).toContain('20,000,000');
    expect(scaled(all)).toEqual([]);
  });
});

describe('a claim quotes the text the chart prints', () => {
  const derivedOf = (spec: unknown) => (render({ spec, return: ['reading'] } as never).body as { reading: { derived: { claimId: string; displayed: string; visible: boolean; description?: string }[] } }).reading.derived;
  // The reading called "Done 2" a visible label of the status board, but no text on the chart prints the count.
  it('status: a state count is not displayed and keeps its words as the description', () => {
    const derived = derivedOf({ type: 'status', data: { rows: [{ id: 'web', label: 'Web shop' }], columns: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      cells: [{ row: 'web', col: 'q1', state: 'done' }, { row: 'web', col: 'q2', state: 'done' }] }, options: { states: [{ id: 'done', label: 'Done', tone: 'good' }] } });
    expect(derived.find(entry => entry.claimId === 'status:count:done')).toMatchObject({ displayed: 'Not displayed', visible: false, description: 'Done 2' });
  });
  // The reading quoted "40% = 40 of 100 cells" as printed, but the waffle prints the value, never its count of cells.
  it('waffle: a cell count is not displayed and keeps its words as the description', () => {
    const derived = derivedOf({ type: 'waffle', data: { categories: [{ id: 'members', label: 'Members' }], series: [{ id: 'active', label: 'Active', values: [40] }] } });
    expect(derived.find(entry => entry.claimId === 'waffle:cells:members:active')).toMatchObject({ displayed: 'Not displayed', visible: false, description: '40% = 40 of 100 cells' });
  });
});
