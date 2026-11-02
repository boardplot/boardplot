/**
 * Schema ergonomics.
 *
 * Two deliverables, one file:
 *
 * 1. the versioned document `$schema`: the published id is named once, a hint
 *    that claims a different boardplot schema warns, and document acceptance is
 *    unchanged with, without or with a foreign hint;
 * 2. the optional named-column adapter: deterministic, order-preserving and
 *    refusing every mapping it cannot make exactly.
 *
 * The runtime validator is the fixed point of the whole file. When a case
 * cannot prove runtime equivalence, it asserts the reported difference.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type * as z from 'zod';
import '../src/core/charts';
import { parseDocumentInput } from '../src/core/doc/document';
import { NormalizeError } from '../src/core/normalize/shared';
import { DOCUMENT_SCHEMA_ID, DOCUMENT_SCHEMA_VERSION } from '../src/core/schema/documentContract';
import { getFixtures } from '../src/fixtures';
import { adaptNamedColumns } from '../src/core/schema/namedColumns';
import { unitConflict } from '../src/core/schema/units';
import { flattenIssues } from '../src/core/schema/flattenIssues';
import { ganttDataSchema } from '../src/core/charts/gantt/schema';
import { render } from '../src/cli/render';
import { resolveChartRequest, layoutResolvedRequest } from '../src/index';
import type { ColumnOptions, KpiOptions } from '../src/index';
import { requireGeometry } from '../src/core/sizing';
import { canvasMargin, resolveTheme } from '../src/core/theme';
import { splitNumberMarks } from '../src/core/numberMarks';
import { sourceLine } from '../src/core/notes';
import { parseChartSpec } from '../src/react/parseChartSpec';
import { getChartSchemas } from '../src/core/registry';

function acceptance(input: unknown): boolean {
  try {
    return parseDocumentInput(input).envelope.ok;
  } catch {
    return false;
  }
}


function refusal(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof NormalizeError) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a refusal, got a result');
}

describe('versioned document $schema', () => {
  const fixture = getFixtures('column').find((entry) => entry.kind === 'example')!;
  const example = {
    $schema: DOCUMENT_SCHEMA_ID,
    version: DOCUMENT_SCHEMA_VERSION,
    charts: [{ name: fixture.id, type: 'column', data: fixture.data, ...(fixture.options ? { options: fixture.options } : {}) }],
  };

  it('ships an example document that the runtime accepts, and keeps accepting it without the hint', () => {
    expect(example).not.toBeNull();
    expect(example!.$schema).toBe(DOCUMENT_SCHEMA_ID);
    expect(acceptance(example)).toBe(true);
    const withoutHint = { version: example!.version, charts: example!.charts };
    expect(acceptance(withoutHint)).toBe(true);
  });

  it('keeps parsing a foreign hint and a later boardplot version, warning only for the latter', () => {
    const foreign = parseDocumentInput({ ...example!, $schema: 'https://example.com/my-editor.json' });
    expect(foreign.envelope.ok).toBe(true);
    expect(foreign.envelope.warnings.filter((warning) => warning.code === 'schema-hint-unusable')).toEqual([]);
    const later = parseDocumentInput({ ...example!, $schema: 'https://boardplot.com/schema/v2/boardplot-doc.json' });
    expect(later.envelope.ok).toBe(true);
    const warned = later.envelope.warnings.filter((warning) => warning.code === 'schema-hint-unusable');
    expect(warned).toHaveLength(1);
    expect(warned[0]!.message).toContain('v2');
    expect(warned[0]!.path).toBe('/$schema');
    const otherArtifact = parseDocumentInput({ ...example!, $schema: 'https://boardplot.com/schema/v1/chart.json' });
    expect(otherArtifact.envelope.ok).toBe(true);
    expect(otherArtifact.envelope.warnings.some((warning) => warning.code === 'schema-hint-unusable')).toBe(true);
  });
});

describe('named-column adapter', () => {
  const exampleFile = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/named-columns.synthetic.json'), 'utf8'),
  ) as { input: { contract: Record<string, string>; rows: Record<string, unknown>[] }; expected: unknown };

  it('reproduces the synthetic example exactly, twice', () => {
    const first = adaptNamedColumns(exampleFile.input as never);
    const second = adaptNamedColumns(exampleFile.input as never);
    expect(first).toEqual(exampleFile.expected);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('refuses every mapping it cannot make exactly', () => {
    const contract = { category: 'period', series: 'driver', value: 'amount' };
    const row = { period: 'Q1', driver: 'Revenue', amount: 1 };
    expect(refusal(() => adaptNamedColumns({ contract, rows: [row, { ...row, amount: 2 }] })).code)
      .toBe('ambiguous-mapping');
    expect(refusal(() => adaptNamedColumns({ contract, rows: [{ ...row, period: 7 }] })).code)
      .toBe('invalid-identity');
    expect(refusal(() => adaptNamedColumns({ contract, rows: [{ ...row, amount: 'n/a' }] })).code)
      .toBe('invalid-value');
    const stateContract = { ...contract, state: 'state' };
    expect(refusal(() => adaptNamedColumns({ contract: stateContract, rows: [{ ...row, state: 'na' }] })).code)
      .toBe('state-with-value');
    expect(refusal(() => adaptNamedColumns({ contract: stateContract, rows: [{ ...row, amount: null, state: 'n/a' }] })).code)
      .toBe('invalid-state');
    const unitContract = { ...contract, unit: 'unit' };
    const conflict = refusal(() => adaptNamedColumns({
      contract: unitContract,
      rows: [
        { ...row, unit: 'EURm' },
        { period: 'Q2', driver: 'Revenue', amount: 2, unit: 'EURk' },
      ],
    }));
    expect(conflict.code).toBe('ambiguous-mapping');
    expect(conflict.message).toContain('unit');
    expect(refusal(() => adaptNamedColumns({ contract: { category: 'a', series: 'a', value: 'b' }, rows: [row] })).code)
      .toBe('invalid-contract');
    expect(refusal(() => adaptNamedColumns({ contract: { ...contract, unit: 'unit' }, rows: [row] })).code)
      .toBe('missing-column');
  });
});

describe('declared units ', () => {
  it('names the first series whose declared unit differs from its scale', () => {
    expect(unitConflict([{ unit: '€ m' }, {}, { unit: '€m' }], '€m')).toBeUndefined();
    expect(unitConflict([{}, { unit: 'units' }, { unit: '%' }])).toEqual({ index: 2, unit: '%', against: 'units' });
    expect(unitConflict([{ unit: '%' }], '€m')).toEqual({ index: 0, unit: '%', against: '€m' });
  });
});

// A gantt task row failed the row union, so the cadence branch's tag error ("expected 'cadence'")
// and a doubled cols error buried the one real mistake.
describe('tagged union issues', () => {
  it('reports a task row with a bad item kind once, at the item, and accepts a cols cell without a tone', () => {
    const result = ganttDataSchema.safeParse({ rows: [{ id: 'a', label: 'A', cols: [{ text: 'sub' }],
      items: [{ id: 'x', kind: 'barr', start: '2026-03-02' }] }] });
    expect(result.success).toBe(false);
    expect(flattenIssues(result.error!.issues).map((issue) => issue.path.join('.'))).toEqual(['rows.0.items.0.kind']);
  });

  // A branch that only misses a field (combo's ruler axis without `ruler`) must not outrank the meant shape.
  it('keeps the real errors of the meant branch when the other branch only misses a field', () => {
    const result = (getChartSchemas('combo')!.optionsSchema as z.ZodType).safeParse({ secondaryAxis: { acknowledge: false, domain: ['oops', 10] } });
    expect(flattenIssues(result.error!.issues).map((issue) => issue.path.join('.')))
      .toEqual(['secondaryAxis.acknowledge', 'secondaryAxis.domain.0']);
  });
  // A share calc without `of` listed four op-enum errors for the other branches and never named `of`.
  it('names the missing field of the branch the op points at', () => {
    const result = (getChartSchemas('table')!.dataSchema as z.ZodType).safeParse({
      columns: [{ id: 'l', kind: 'rowLabel', label: 'L' }, { id: 'v', kind: 'value', label: 'V' }, { id: 's', kind: 'computed', label: 'S', calc: { op: 'share' } }],
      rows: [{ id: 'a', label: 'A', cells: { v: 1 } }],
    });
    expect(flattenIssues(result.error!.issues).map((issue) => issue.path.join('.'))).toEqual(['columns.2.calc.of']);
  });
  // A coloured rule would enter the colour key as a status the chart never draws.
  it('refuses a colour on a gantt rule item', () => {
    const result = ganttDataSchema.safeParse({ rows: [{ id: 'a', label: 'A',
      items: [{ id: 'x', kind: 'rule', start: '2026-03-02', end: '2026-03-09', colorRole: 'bad' }] }] });
    expect(result.success).toBe(false);
    expect(flattenIssues(result.error!.issues).map((issue) => `${issue.path.join('.')}: ${issue.message}`))
      .toEqual(["rows.0.items.0.colorRole: a rule is always the quiet neutral; use kind 'bar' for a coloured span"]);
  });
  // A long badge label would burst its circle; a badge on a column lane would be ignored silently.
  it('refuses a gantt badge label over 3 characters and a badge on a column event', () => {
    const issues = (type: string) => {
      const result = (getChartSchemas(type)!.optionsSchema as z.ZodType).safeParse({ annotations: [{ kind: 'event', at: 'a', label: type === 'gantt' ? 'Live' : '1', labelPlacement: 'badge' }] });
      return flattenIssues(result.error!.issues).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    };
    expect(issues('gantt')).toEqual(["annotations.0.label: a badge holds at most 3 characters; use labelPlacement 'top' for a longer label"]);
    expect(issues('column')).toEqual(['annotations.0.labelPlacement: badge is a gantt event placement']);
  });
});

// A plain option shape was refused, and its fix patch deleted the author's note.
it('accepts short option shapes and preserves their content', async () => {
  const spec = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/option-shapes.json'), 'utf8'));
  const data = spec.data;
  const options: ColumnOptions = { footnotes: 'Keep this note.', source: ['Example ledger', 'Example plan'], locale: 'de', sort: 'desc', topN: 2 };
  const request = (options: object = {}, type = 'column', chartData = data) => resolveChartRequest({ type, data: chartData, options });
  expect(getChartSchemas('column')!.optionsSchema.parse(options)).toMatchObject({ footnotes: ['Keep this note.'],
    source: 'Example ledger; Example plan', locale: { language: 'de' }, sort: { categories: 'desc' }, topN: { n: 2 } });
  expect(getChartSchemas('choropleth')!.optionsSchema.parse({ topN: 3 })).toMatchObject({ topN: { n: 3 } });
  const result = request(options);
  expect(result.options).toMatchObject({ footnotes: ['Keep this note.'], source: 'Example ledger; Example plan',
    sort: { categories: 'desc' }, topN: { n: 2 } });
  expect(splitNumberMarks(result.options.locale!.language!)).toEqual({ language: 'de', marks: { decimal: '.', thousands: ',' } });
  expect(result.inputWarnings ?? []).toEqual([]);
  expect(request({ source: [] }).options.source).toBe('');
  expect(() => request({ source: ['Example ledger', 7] })).toThrow();
  expect(sourceLine('Example ledger', '')).toBe('Example ledger');

  const cardOptions: KpiOptions = { source: ['Example ledger'], locale: 'en' };
  const card = requireGeometry(layoutResolvedRequest(request(cardOptions, 'kpi', { label: '', value: 1234.5, format: '0,000.0' })));
  expect(card.labels.some(label => label.id === 'category:label')).toBe(false);
  expect(card.scene.some(node => node.t === 'text' && node.lines.join('') === '')).toBe(false);
  expect(card.a11y.title).toBe('KPI');
  expect(card.a11y.desc).toContain('1,234.5');
  expect(card.labels.find(label => label.id === 'total:value')!.rect.y).toBe(card.plot.y);

  const base = resolveTheme();
  const themed = request({ theme: { overrides: { space: { canvas: { base: { top: 16 } } } } } });
  expect(canvasMargin(themed.theme, 960)).toEqual({ ...canvasMargin(base, 960), top: 16 });
  expect(canvasMargin(themed.theme, 1200)).toEqual(canvasMargin(base, 1200));
  expect(() => request({ theme: { overrides: { space: { canvas: { base: 16 } } } } })).toThrow(/space.canvas.base/);
  expect(() => request({ theme: { overrides: { space: { canvas: { wide: { left: 97 } } } } } })).toThrow();
  expect(() => request({ theme: { overrides: {}, extra: true } })).toThrow();

  for (const type of ['bar', 'column', 'pie']) {
    for (const order of ['sheet', 'asc', 'desc', 'reverse']) expect(request({ sort: order }, type).options.sort).toEqual({ categories: order });
    expect(request({ sort: true, topN: 2 }, type).options).toMatchObject({ sort: { categories: 'desc' }, topN: { n: 2 } });
  }
  for (const sort of [false, 'largest']) expect(() => request({ sort })).toThrow();
  for (const topN of [0, -1, 1.5]) expect(() => request({ topN })).toThrow();
  expect(() => request({ locale: 'bad tag!' })).toThrow(/BCP 47/);
  const refusedSort = (sort: unknown) => refusal(() => request({ sort }, 'kpi', { label: 'Revenue', value: 12 }));
  expect(refusedSort('desc')).toEqual(refusedSort({ categories: 'desc' }));

  const rendered = render({ spec, return: ['svg'] });
  expect(rendered.exit).toBe(0);
  const body = rendered.body as { svg: string; warnings: { code: string; path?: string; fix?: unknown }[] };
  expect(body.svg).toContain('Invented amounts.');
  expect(body.svg).toContain('Example ledger; Example plan');
  expect(body.svg).not.toContain('Source:');
  expect(body.warnings).toContainEqual(expect.objectContaining({ code: 'name-slugified', path: '/name',
    fix: [{ op: 'replace', path: '/name', value: 'revenue-q3-2024' }] }));
  expect(body.warnings).toContainEqual(expect.objectContaining({ code: 'annotation-text-as-label', path: '/annotations/0/text' }));
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ColumnChart } = await import('../src/react/charts/column');
  const { ComboChart } = await import('../src/react/charts/combo');
  expect(renderToStaticMarkup(createElement(ColumnChart, { data, ...options, fixedSize: true, deferLayout: false }))).toContain('Keep this note.');
  expect(renderToStaticMarkup(createElement(ComboChart, { data, source: ['Example ledger', 'Example plan'], footnotes: 'Keep this note.', locale: 'en', fixedSize: true, deferLayout: false }))).toContain('Example ledger; Example plan');
  const parsed = await parseChartSpec(spec);
  expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: 'name-slugified' }));
  expect(parseDocumentInput({ ...spec, name: 'Keep.UP_A-1' }).doc.charts[0]!.name).toBe('Keep.UP_A-1');
  expect(parseDocumentInput({ ...spec, name: '... Révenue / Q3 ...' }).doc.charts[0]!.name).toBe('revenue-q3');
  expect(parseDocumentInput({ ...spec, name: 'A'.repeat(101) }).doc.charts[0]!.name).toHaveLength(100);
  for (const name of [' / .. ', 12]) expect(() => parseDocumentInput({ ...spec, name })).toThrow();
  expect(parseDocumentInput({ version: 1, charts: [{ name: 'Revenue Q3 2024', type: 'column', data }] }).doc.charts[0]!.name).toBe('Revenue Q3 2024');

  // The overrides-only theme gets the same contrast refusal as { preset, overrides }.
  const unreadable = render({ spec: { type: 'column', data, options: { theme: { overrides: { color: { ink: '#fdfdfd' } } } } }, return: ['svg'] }).body as { errors: { code: string }[] };
  expect(unreadable.errors[0]!.code).toBe('contrast-ink');

  const stray = render({ spec: { type: 'column', data, locale: 'de' }, return: ['svg'] }).body as { errors: { fix: unknown }[] };
  expect(stray.errors[0]!.fix).toEqual([{ op: 'add', path: '/options', value: { locale: 'de' } }, { op: 'remove', path: '/locale' }]);
  const annotation = { kind: 'valueLine', value: 1500, text: 'Target' };
  for (const item of [annotation, { ...annotation, label: 'Target' }]) {
    const line = resolveChartRequest({ type: 'column', data, annotations: [item] as never });
    expect(line.options.annotations).toEqual([{ kind: 'valueLine', value: 1500, label: 'Target' }]);
    expect(line.inputWarnings?.filter(warning => warning.code === 'annotation-text-as-label')).toHaveLength(1);
    expect(line.inputWarnings).toContainEqual(expect.objectContaining({ severity: 'info', fix: [
      { op: 'test', path: '/charts/0/annotations/0', value: item },
      { op: 'replace', path: '/charts/0/annotations/0', value: { kind: 'valueLine', value: 1500, label: 'Target' } },
    ] }));
  }
  expect(() => resolveChartRequest({ type: 'column', data, annotations: [{ ...annotation, label: 'Plan' }] as never })).toThrow();
  expect(() => resolveChartRequest({ type: 'column', data, annotations: [{ kind: 'indicator100', text: 'Full' }] as never })).toThrow();
});
