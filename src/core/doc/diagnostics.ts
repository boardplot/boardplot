import type { z } from 'zod';
import type { DocExpansion } from './docExpand';
import { canonicalChartType } from '../registry';
import { receivedDescription, schemaDiagnostic, type DiagnosticMetadata } from '../diagnostics/describe';
import { addWhereAbsent, parseJsonPointer, readJsonPointer, toJsonPointer, type JsonPatchOperation } from '../diagnostics/jsonPatch';
import { normalizeOptionShapes, optionShape } from '../normalize/optionShapes';

interface DiagnosticSource { input: unknown; sources: DocExpansion['sources'] }
interface NamedDocument { charts: { name: string; type: string }[] }
/** What every verb puts into an envelope before completion fills the rest in. */
export type DocumentFinding = {
  code: string; message: string; suggest?: string;
  /** The offending field, relative to the chart that owns the finding. */
  field?: readonly (string | number)[];
} & Partial<DiagnosticMetadata>;
type Finding = DocumentFinding;

// Source correspondence belongs to the loaded document and never enters its serialized content.
const sourceDocuments = new WeakMap<object, DiagnosticSource>();

export function rememberDiagnosticSource(document: object, source: DiagnosticSource): void {
  sourceDocuments.set(document, source);
}

function documentSource(document: NamedDocument): DiagnosticSource {
  return sourceDocuments.get(document) ?? { input: document, sources: document.charts.map((_, index) => ({ index })) };
}

function sourceSegments(source: DiagnosticSource, expanded: readonly (string | number)[]): (string | number)[] {
  if (expanded[0] !== 'charts' || expanded.length < 2) return [...expanded];
  const origin = source.sources[Number(expanded[1])];
  if (!origin) return [...expanded];
  const rest = expanded.slice(2);
  return ['charts', origin.index, ...(origin.slice !== undefined && rest[0] === 'data'
    ? ['data', 'bySlice', origin.slice, ...rest.slice(1)] : rest)];
}

function sameSourceValue(original: ReturnType<typeof readJsonPointer>, actual: ReturnType<typeof readJsonPointer>): boolean {
  // The parse reads an owned copy, so an object value is equal, not identical.
  return original.found && actual.found && (Object.is(original.value, actual.value)
    || (typeof original.value === 'object' && original.value !== null && JSON.stringify(original.value) === JSON.stringify(actual.value)));
}

/** The authored field and its parent at the same pointer a chart diagnostic will report. */
export function chartSchemaSource(
  document: NamedDocument, chart: { name: string }, base: string, path: readonly PropertyKey[], input: unknown,
) {
  const source = documentSource(document);
  const expanded = ['charts', document.charts.findIndex(candidate => candidate.name === chart.name), base, ...path.map(String)];
  const pointer = toJsonPointer(sourceSegments(source, expanded));
  const original = readJsonPointer(source.input, pointer);
  const actual = readJsonPointer(input, toJsonPointer(path.map(String)));
  const parent = readJsonPointer(source.input, pointer.slice(0, pointer.lastIndexOf('/')));
  return { path: pointer, same: sameSourceValue(original, actual), parent: parent.found ? parent.value : undefined };
}

/** Native schema paths stay structured until their final JSON Pointer encoding. */
export function sourceSchemaDiagnostic(
  source: DiagnosticSource, expandedPath: readonly (string | number)[],
  issue: z.core.$ZodIssue, localInput: unknown,
  context: { code: string; message: string; displayPath: string; docs: string; suggest?: string },
) {
  const segments = sourceSegments(source, expandedPath);
  const path = toJsonPointer(segments);
  const original = readJsonPointer(source.input, path);
  const actual = readJsonPointer(localInput, toJsonPointer(issue.path.map(String)));
  const same = sameSourceValue(original, actual);
  return schemaDiagnostic(issue, localInput, { ...context, path, allowFix: same });
}

export function chartSchemaDiagnostic(
  document: NamedDocument, chart: { name: string; type: string }, base: string,
  issue: z.core.$ZodIssue, input: unknown, code: string, message: string, suggest?: string,
) {
  const path = ['charts', document.charts.findIndex(candidate => candidate.name === chart.name), base, ...issue.path.map(String)];
  return sourceSchemaDiagnostic(documentSource(document), path, issue, input, {
    code, message, suggest, displayPath: `charts[${chart.name}].${base}${issue.path.length ? `.${issue.path.join('.')}` : ''}`,
    docs: `docs/reference/${canonicalChartType(chart.type) ?? chart.type}.md#${base}`,
  });
}

export function completeDiagnostic<T extends Finding>(finding: T, input?: unknown, segments: readonly (string | number)[] = [], docs = 'docs/reference/options.md#options'): T & DiagnosticMetadata {
  const displayPath = finding.displayPath ?? (finding.path && !finding.path.startsWith('/') ? finding.path : undefined);
  const path = finding.path?.startsWith('/') ? finding.path : toJsonPointer(segments);
  const actual = input === undefined ? { found: false as const } : readJsonPointer(input, path);
  return { ...finding, path, ...(displayPath ? { displayPath } : {}),
    ...(finding.fix && input !== undefined ? { fix: addWhereAbsent(input, finding.fix) } : {}),
    // Without an expectation of its own, the finding states it in message and suggest; a copy here would repeat them.
    expected: finding.expected ?? {},
    received: finding.received ?? (input === undefined ? { type: 'unavailable' } : receivedDescription(actual.found ? actual.value : undefined, actual.found)),
    docs: finding.docs ?? docs,
  };
}

/**
 * A finding about an option the author wrote in short form (`sort: "desc"` read as `{ categories: "desc" }`)
 * points at the authored option, and so does its patch. A `remove` inside the option removes the option. An
 * `add` or `replace` inside it replaces the option with its expanded form after that operation. A patch that
 * cannot be built exactly for the authored option is dropped.
 */
function authoredShortForm<T extends Finding>(finding: T, authoredChart: unknown): T {
  // Only a finding with a field, or without a document path, writes its patch relative to the chart.
  const relativeFix = finding.fix !== undefined && (finding.field !== undefined || !finding.path?.startsWith('/'));
  if ((!finding.field && !relativeFix) || authoredChart === null || typeof authoredChart !== 'object') return finding;
  const { shortForms } = normalizeOptionShapes(canonicalChartType((authoredChart as { type?: string }).type ?? '') ?? '', authoredChart as object, canonicalChartType);
  if (shortForms.length === 0) return finding;
  const inside = (segments: readonly (string | number)[]) =>
    shortForms.find(prefix => segments.length > prefix.length && prefix.every((key, i) => String(key) === String(segments[i])));
  const field = finding.field && inside(finding.field);
  // The expanded value of each short form, as the patch so far changes it.
  const expanded = new Map<string, unknown>();
  const authoredOption = (form: (string | number)[]) => {
    const pointer = toJsonPointer(form);
    if (!expanded.has(pointer)) {
      const authored = form.reduce<any>((node, key) => node?.[key], authoredChart);
      expanded.set(pointer, structuredClone(optionShape(String(form.at(-1)), authored)));
    }
    return { pointer, value: expanded.get(pointer) };
  };
  const rewrite = (operation: JsonPatchOperation): JsonPatchOperation | undefined => {
    const segments = parseJsonPointer(operation.path);
    const form = inside(segments);
    if (!form) return operation;
    const { pointer, value } = authoredOption(form);
    if (operation.op === 'remove') return { op: 'remove', path: pointer };
    if (operation.op !== 'add' && operation.op !== 'replace') return undefined;
    const rest = segments.slice(form.length);
    const parent = rest.slice(0, -1).reduce<any>((node, key) => (node !== null && typeof node === 'object' ? node[key] : undefined), value);
    const key = String(rest.at(-1));
    if (parent === null || typeof parent !== 'object') return undefined;
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length - (operation.op === 'replace' ? 1 : 0)) return undefined;
      parent.splice(index, operation.op === 'replace' ? 1 : 0, operation.value);
    } else {
      if (operation.op === 'replace' && !Object.hasOwn(parent, key)) return undefined;
      parent[key] = operation.value;
    }
    return { op: 'replace', path: pointer, value: structuredClone(value) };
  };
  const fix = relativeFix ? finding.fix!.map(rewrite) : finding.fix;
  if (!field && fix === finding.fix) return finding;
  const { fix: _fix, field: _field, ...rest } = finding;
  return {
    ...rest,
    ...(field ? { field } : finding.field ? { field: finding.field } : {}),
    ...(fix && fix.every(Boolean) ? { fix: fix as JsonPatchOperation[] } : {}),
  } as unknown as T;
}

export function completeChartDiagnostic<T extends Finding>(document: NamedDocument, chart: { name: string; type: string }, finding: T, relative: readonly (string | number)[] = []) {
  const source = documentSource(document);
  const index = document.charts.findIndex(candidate => candidate.name === chart.name);
  // A finding that knows its own field carries it relative to the chart, and
  // so are the patch paths it proposes. Schema diagnostics already point at
  // the whole document and carry a path, so their patches stay untouched. An engine
  // finding with a fix but no field still writes its fix relative to the chart, and
  // must be rebased too, or addWhereAbsent reads it against the document root and
  // turns `replace /options/size` into `add /options`, which drops every other option.
  // A theme the chart inherits from the document is fixed at the document: /theme, not /charts/N/options/theme.
  const base = index < 0 ? [] : sourceSegments(source, ['charts', index]);
  const authoredChart = base.reduce<any>((node, key) => node?.[key], source.input);
  const { field: chartField, ...rest } = authoredShortForm(finding, authoredChart);
  const inherited = chartField?.[0] === 'options' && chartField[1] === 'theme'
    && authoredChart?.options?.theme === undefined && (source.input as { theme?: unknown } | null)?.theme !== undefined;
  const field = inherited ? undefined : chartField;
  const segments = inherited ? ['theme', ...chartField.slice(2)] : sourceSegments(source, index < 0 ? [] : ['charts', index, ...(field ?? relative)]);
  const rebased = inherited && rest.fix
    ? rest.fix.map(operation => ({ ...operation, path: `/theme${operation.path.slice('/options/theme'.length)}` }))
    : (field || !rest.path?.startsWith('/')) && rest.fix
    ? rest.fix.map(operation => ({
      ...operation,
      path: `${toJsonPointer(sourceSegments(source, index < 0 ? [] : ['charts', index]))}${operation.path}`,
    }))
    : undefined;
  // A size refusal points at the type's floors; every other chart finding at its options.
  const type = canonicalChartType(chart.type);
  const docs = type === undefined ? 'docs/reference/options.md#options'
    : finding.code === 'size-below-floor' ? `docs/reference/${type}.md#sizing` : `docs/reference/${type}.md#options`;
  return completeDiagnostic((rebased ? { ...rest, fix: rebased } : rest) as T, source.input, segments, docs);
}

export function completeDocumentDiagnostic<T extends Finding>(document: NamedDocument, finding: T) {
  const source = documentSource(document);
  const segments = finding.path?.startsWith('/') ? sourceSegments(source, parseJsonPointer(finding.path)) : [];
  return completeDiagnostic({ ...finding, path: toJsonPointer(segments) }, source.input, segments);
}
