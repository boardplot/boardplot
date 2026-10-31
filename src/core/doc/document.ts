import * as z from 'zod';
import { isRecord } from '../lint/shared';
import { isBareChart } from './bareChart';
import { diagnosedSafeParse } from '../schema/shared';
import { documentSchemaHint, documentSchemaHintWarning } from '../schema/documentContract';
import { flattenIssues } from '../schema/flattenIssues';
import type { LintWarning } from '../types/scene';
import type { ThemeRef } from '../types/theme';
import { optionsTake } from './chartValidation';
import { DocExpansionError, expandDoc, missingChartName, ownedDocumentCopy } from './docExpand';
import { completeDiagnostic, rememberDiagnosticSource, sourceSchemaDiagnostic, type DocumentFinding } from './diagnostics';
import { toJsonPointer } from '../diagnostics/jsonPatch';
import { atPath, messageText } from '../diagnostics/describe';

export interface DocumentEnvelope {
  ok: boolean;
  errors: DocumentFinding[];
  warnings: LintWarning[];
}

interface DocumentParseResult {
  doc: BoardplotDoc;
  envelope: DocumentEnvelope;
}

export class DocumentSchemaError extends Error {
  constructor(readonly envelopeErrors: DocumentEnvelope['errors']) {
    super(
      `document schema errors:\n${envelopeErrors
        .map((issue) => `  ${issue.displayPath || issue.path || '(root)'}: ${messageText(issue)}`)
        .join('\n')}`,
    );
    this.name = 'DocumentSchemaError';
  }
}

export interface DocChart {
  name: string;
  type: string;
  data: unknown;
  options?: Record<string, unknown>;
  annotations?: unknown[];
}

export interface BoardplotDoc {
  /** Root language tag; inherited as options.locale.language for number and date labels. */
  locale?: unknown;
  version: number;
  theme?: ThemeRef;
  charts: DocChart[];
}

const documentSchema = z.preprocess(
  // ownedDocumentCopy AFTER the rebuild: normalizeSubtitleArrays constructs
  // normal-prototype objects (Object.fromEntries), and zod's parse of those
  // reads absent optional keys through the chain — a writable prototype
  // gadget would materialize into the parsed doc as authored content.
  (value) => ownedDocumentCopy(normalizeSubtitleArrays(value)),
  z
    .object({
      $schema: z.string().optional().describe('Optional schema-location hint; document version selects the supported format.'),
      version: z.literal(1).describe('Document format version; the supported value is 1.'),
      theme: z.unknown().optional().describe('Document theme inherited by charts without an explicit theme; checked during theme resolution.'),
      locale: z.unknown().optional().describe('Root language tag inherited by charts. Non-string values are accepted structurally but warn and have no effect; explicit chart format examples take precedence.'),
      charts: z
        .array(
          z.object({
            name: z.string({ error: missingChartName }).min(1).describe('Unique chart name within the document, used for chart selection and output identity.'),
            type: z.string().min(1).describe('Registered chart type or alias; selects the data and options schemas.'),
            data: z.unknown().describe('Chart data; the selected chart data schema validates the contents.'),
            options: z.record(z.string(), z.unknown().describe('Option value checked by the selected chart options schema.')).optional().describe('Chart-specific options overriding inherited document settings.'),
            annotations: z.array(z.unknown().describe('Data-bound annotation checked by the selected chart and annotation pass.')).optional().describe('Top-level chart annotations folded into chart options by the document loader.'),
          }).describe('Named chart specification within the document.'),
        )
        .min(1).describe('One or more charts in authored order; names must be unique.'),
    })
    .superRefine((doc, ctx) => {
      const seen = new Map<string, number>();
      doc.charts.forEach((chart, index) => {
        const first = seen.get(chart.name);
        if (first !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['charts', index, 'name'],
            message: `duplicate chart name '${chart.name}' (first used at charts.${first}.name)`,
          });
        } else {
          seen.set(chart.name, index);
        }
      });
    }).describe('Chart document after repeat expansion and subtitle shorthand normalization.'),
).describe('Versioned chart document; normalizes subtitle arrays before structural validation.');

/** The documented v1 contract: everything else is refused. */
const DOC_ROOT_FIELDS = new Set(['$schema', 'version', 'theme', 'locale', 'charts']);
const DOC_CHART_FIELDS = new Set(['name', 'type', 'data', 'options', 'annotations', 'repeat']);
/** The bare chart: one chart without the envelope. */
const BARE_FIELDS = new Set(['name', 'type', 'data', 'options', 'annotations', 'theme']);
/** A bare chart's name names its file under --out, so it stays a plain file stem. */
const FILE_STEM = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const SHAPE_SUGGEST = 'Send { type, data } for one chart, or { version: 1, charts: [...] } with a name per chart for several.';
/** The name a bare chart without `name` takes inside its one-chart envelope. */
export const BARE_CHART_NAME = 'chart';
export const NAME_RULE = "letters, digits, '.', '_' and '-', at most 100, not starting with '.'";

export { isBareChart };

/** Wrap a bare chart into the one-chart envelope every verb reads. */
function bareEnvelope(spec: Record<string, unknown>): Record<string, unknown> {
  const chart: Record<string, unknown> = Object.create(null);
  chart.name = Object.hasOwn(spec, 'name') ? spec.name : BARE_CHART_NAME;
  for (const key of ['type', 'data', 'options', 'annotations']) {
    if (Object.hasOwn(spec, key)) chart[key] = spec[key];
  }
  const envelope: Record<string, unknown> = Object.create(null);
  envelope.version = 1;
  if (Object.hasOwn(spec, 'theme')) envelope.theme = spec.theme;
  envelope.charts = [chart];
  return envelope;
}

/** Point into the spec the caller sent: `/options/x` for a bare chart, not `/charts/0/options/x`. */
function barePointer(pointer: string): string {
  if (pointer === '/charts/0') return '';
  return pointer.startsWith('/charts/0/') ? pointer.slice('/charts/0'.length) : pointer;
}

/** Rewrite one finding for a caller that sent a bare chart. */
export function bareFinding<T extends DocumentFinding>(finding: T): T {
  // The bare chart may carry its own name; a validated name holds no quote or bracket.
  const chartPrefix = /^chart '[^']*': /;
  const displayPath = finding.displayPath?.replace(/^charts(?:\.0|\[[^\]]*\])\.?/, '');
  // A schema message names its field by the envelope's display path (`atPath`); it names the bare one instead.
  const message = chartPrefix.test(finding.message) ? finding.message.replace(chartPrefix, '')
    : displayPath !== undefined && finding.displayPath !== displayPath ? atPath({ displayPath }, messageText(finding)) : finding.message;
  return {
    ...finding,
    ...(message === finding.message ? {} : { message }),
    ...(finding.path === undefined ? {} : { path: barePointer(finding.path) }),
    ...(displayPath === undefined ? {} : { displayPath }),
    ...(finding.fix === undefined ? {} : {
      fix: finding.fix.map((operation) => ({ ...operation, path: barePointer(operation.path) })),
    }),
  };
}

function unknownField(
  input: Record<string, unknown>, segments: (string | number)[], where: string,
  edit: Pick<DocumentFinding, 'suggest' | 'fix'> = { suggest: `Remove '${segments[segments.length - 1]}'.`, fix: [{ op: 'remove', path: toJsonPointer(segments) }] },
): DocumentFinding {
  return completeDiagnostic({
    code: 'unknown-field',
    message: `${where} field '${segments[segments.length - 1]}' is not part of the spec.`,
    ...edit,
  }, input, segments, 'docs/manual.md#the-spec');
}

/** Chart furniture an author often puts at the top level; options takes each of these as a string. */
const MOVABLE_KEYS = ['title', 'subtitle', 'unit', 'source'] as const;
/** Movable only when the chart type's options schema lists the key: diagram and creative take no `unit`, and a moved key there would be refused again. */
const isMovable = (input: Record<string, unknown>, key: string): boolean => (MOVABLE_KEYS as readonly string[]).includes(key) && typeof input[key] === 'string'
  && typeof input.type === 'string' && optionsTake(input.type, key);

/**
 * A top-level `title`, `subtitle`, `unit` or `source` string holds what the
 * author meant for the chart, so its fix moves it into options instead of
 * dropping it unseen. Any other stray key is no option name, so options would
 * refuse it: its fix removes it, and the fixed chart draws.
 */
function strayKey(input: Record<string, unknown>, key: string, where: string, strays: readonly string[]): DocumentFinding {
  if (!isMovable(input, key)) return unknownField(input, [key], where);
  const { options } = input;
  // Without options, every fix adds the same whole object: two adds of /options would otherwise overwrite each other.
  const append = options === undefined ? { op: 'add' as const, path: '/options', value: Object.fromEntries(strays.filter(name => isMovable(input, name)).map(name => [name, input[name]])) }
    : isRecord(options) && !Object.hasOwn(options, key) ? { op: 'add' as const, path: toJsonPointer(['options', key]), value: input[key] }
      : undefined;
  // Options already hold this key (or are no object): the options value stays and the fix removes the top-level copy.
  return append ? unknownField(input, [key], where, { suggest: `Move '${key}' into options.`, fix: [append, { op: 'remove', path: toJsonPointer([key]) }] }) : unknownField(input, [key], where);
}

/**
 * Unknown root and chart fields are refused: zod would strip them, and an
 * author would get no signal that `chart.title` or a typo'd `anotations` did
 * nothing. A non-string root locale stays a warning, because it has no effect.
 */
function unknownDocFields(raw: unknown): { errors: DocumentFinding[]; warnings: LintWarning[] } {
  const errors: DocumentFinding[] = [];
  const warnings: LintWarning[] = [];
  if (!isRecord(raw)) return { errors, warnings };
  // `$schema` is a hint, and any string keeps parsing. Only a hint that
  // claims to be a boardplot schema is worth a sentence, because only that one
  // promises a format this reader may not be reading.
  const hintMessage = documentSchemaHintWarning(documentSchemaHint(raw.$schema));
  if (hintMessage) {
    warnings.push(completeDiagnostic({
      code: 'schema-hint-unusable', severity: 'warn', message: hintMessage,
    }, raw, ['$schema']));
  }
  // `version` beside chart keys and no `charts`: the keys are one chart and the version is the stray one.
  const oneChart = !Object.hasOwn(raw, 'charts') && ['type', 'data', 'options', 'annotations'].some(key => Object.hasOwn(raw, key));
  const strays = Object.keys(raw).filter(key => !DOC_ROOT_FIELDS.has(key) && !(oneChart && BARE_FIELDS.has(key)));
  for (const key of Object.keys(raw)) {
    if (oneChart && key === 'version') {
      errors.push(completeDiagnostic({
        code: 'unknown-field',
        message: "Root field 'version' belongs to a document with 'charts'; one chart takes none.",
        suggest: "Remove 'version', or put the chart into 'charts'.",
        fix: [{ op: 'remove', path: '/version' }],
      }, raw, ['version'], 'docs/manual.md#the-spec'));
    } else if (strays.includes(key)) {
      // An envelope has no root options to move a key into, so its fix removes the key.
      errors.push(oneChart ? strayKey(raw, key, 'Root', strays) : unknownField(raw, [key], 'Root'));
    }
  }
  if (Object.hasOwn(raw, 'locale') && typeof raw.locale !== 'string') {
    warnings.push(completeDiagnostic({
      code: 'locale-ignored',
      severity: 'warn',
      message: "root 'locale' must be a language tag such as 'de'; anything else has no effect; explicit chart formats override the language tag",
    }, raw, ['locale']));
  }
  if (Array.isArray(raw.charts)) {
    raw.charts.forEach((chart, index) => {
      if (!isRecord(chart)) return;
      for (const key of Object.keys(chart)) {
        if (!DOC_CHART_FIELDS.has(key)) errors.push(unknownField(raw, ['charts', index, key], `charts.${index}:`));
      }
    });
  }
  return { errors, warnings };
}

function bareFieldErrors(spec: Record<string, unknown>): DocumentFinding[] {
  const strays = Object.keys(spec).filter((key) => !BARE_FIELDS.has(key));
  const errors = strays.map((key) => strayKey(spec, key, 'Top-level', strays));
  if (Object.hasOwn(spec, 'name') && !(typeof spec.name === 'string' && FILE_STEM.test(spec.name))) {
    errors.push(completeDiagnostic({
      code: 'invalid-name',
      message: `name names the output file: ${NAME_RULE}`,
      suggest: 'Pass a name such as revenue-q3, or leave name out to get chart.',
    }, spec, ['name'], 'docs/manual.md#the-spec'));
  }
  return errors;
}

/**
 * Parse a bare chart or an envelope. A bare chart is wrapped into a one-chart
 * envelope first; findings then point into that envelope, and `bareFinding`
 * points them back into the bare spec.
 */
export function parseDocumentInput(input: unknown): DocumentParseResult {
  if (isBareChart(input)) {
    const unknown = bareFieldErrors(input);
    if (unknown.length) throw new DocumentSchemaError(unknown.map((finding) => ({ ...finding, path: `/charts/0${finding.path}`,
      fix: finding.fix?.map((operation) => ({ ...operation, path: `/charts/0${operation.path}` })) })));
    input = bareEnvelope(input);
  }
  let expanded: ReturnType<typeof expandDoc>;
  try {
    expanded = expandDoc(input);
  } catch (error) {
    if (!(error instanceof DocExpansionError)) throw error;
    throw new DocumentSchemaError(error.issues.map(issue => completeDiagnostic({
      code: 'cli-error', message: atPath({ displayPath: issue.path.join('.') }, issue.message), displayPath: issue.path.join('.'), suggest: SHAPE_SUGGEST,
    }, input, issue.path)));
  }
  const fields = unknownDocFields(input);
  if (fields.errors.length) throw new DocumentSchemaError(fields.errors);
  // Re-own the root assembled by expansion and every schema output: inherited
  // properties must never turn into authored options at this process boundary.
  const result = diagnosedSafeParse(documentSchema as z.ZodType, Object.assign(Object.create(null), expanded.doc));
  const source = { input, sources: expanded.sources };
  if (!result.success) {
    throw new DocumentSchemaError(flattenIssues(result.error.issues).map(issue =>
      sourceSchemaDiagnostic(source, issue.path.map(String), issue, expanded.doc, {
        code: 'cli-error', message: issue.message, displayPath: issue.path.join('.'),
        docs: 'docs/manual.md#the-spec', suggest: SHAPE_SUGGEST,
      })));
  }
  const doc = ownedDocumentCopy(result.data) as unknown as BoardplotDoc;
  rememberDiagnosticSource(doc, source);
  return { doc, envelope: {
    ok: true, errors: [],
    warnings: [...fields.warnings, ...expanded.warnings.map(warning => completeDiagnostic(warning, input))],
  } };
}

function normalizeSubtitleArrays(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    if (key === 'subtitle' && value.every((item): item is string => typeof item === 'string')) {
      return value.join(' · ');
    }
    return value.map((item) => normalizeSubtitleArrays(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, item]) => [entryKey, normalizeSubtitleArrays(item, entryKey)]),
    );
  }
  return value;
}
