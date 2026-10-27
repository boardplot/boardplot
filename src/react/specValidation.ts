/**
 * Spec validation without the schema catalogue: the document shape, the
 * theme object, the settings schema, the diagnostics and zod. Everything
 * here is the same for every chart type, so a host bundler emits it once
 * and `BoardplotChart` fetches it once, however many charts a page draws.
 *
 * What it deliberately does NOT hold is a chart type's data and options
 * schemas. `beginSpecParse` reads the document far enough to name the types
 * one chart needs, and the caller brings their schemas — from
 * `src/react/schemaLoaders.ts` in the browser, from the registered
 * catalogue on a server. `src/react/parseChartSpec.ts` is that second
 * caller, and the synchronous entry every CLI and server consumer keeps.
 */

import { ownedDocumentCopy } from '../core/doc/ownedDocumentCopy';
import { bareFinding, DocumentSchemaError, isBareChart, parseDocumentInput,
  type DocChart, type DocumentEnvelope, type BoardplotDoc } from '../core/doc/document';
import { referencedChartTypes, validateChartInput } from '../core/doc/chartValidation';
import { chartTypeAliases, schemaLoaders } from './schemaLoaders';
import { adoptThemeObject, isThemeObject, rootContextErrors } from '../core/doc/themeObject';
import { completeDiagnostic } from '../core/doc/diagnostics';
import { schemaDiagnostic } from '../core/diagnostics/describe';
import { toJsonPointer } from '../core/diagnostics/jsonPatch';
import { flattenIssues } from '../core/schema/flattenIssues';
import { boardplotSpecSettingsSchema } from '../core/schema/spec';
import type { ChartRequest, RequestOptions } from '../core/request';
import type { Annotation } from '../core/types/annotations';
import type { RenderTarget } from '../core/types/options';
import type { ThemeRef } from '../core/types/theme';
import type { ContainerSizeOptions } from './useContainerSize';
import type { LintWarning } from '../core/types/scene';
import { BoardplotSpecError } from '../core/doc/specError';
import { publishSpecValidator } from './specHandover';
import type { HoverOption } from './useHover';
import { pushAll } from '../core/arrays';

/** Serializable BoardplotChart props beside the spec itself. */
export interface BoardplotSpecSettings extends ContainerSizeOptions {
  theme?: ThemeRef;
  target?: RenderTarget;
  hover?: HoverOption;
}

export interface ParsedChartSpec {
  name: string;
  request: ChartRequest;
  /** Schema and document-load warnings. Layout warnings remain on the rendered result. */
  warnings: LintWarning[];
}

/**
 * One chart selected out of a spec, before its own schemas have judged it.
 * `types` names every chart type `finish` will consult; a caller that loads
 * schemas on demand has them all in hand before it calls `finish`. A type
 * that is still missing then is refused as unknown, which is also how an
 * unknown type in the spec reads.
 */
export interface SpecParse {
  types: readonly string[];
  finish(): ParsedChartSpec;
}

export function specSettings(settings: BoardplotSpecSettings): BoardplotSpecSettings {
  const result = boardplotSpecSettingsSchema.safeParse(ownedDocumentCopy(settings));
  if (result.success) return result.data;
  throw new BoardplotSpecError(flattenIssues(result.error.issues).map(issue => schemaDiagnostic(issue, settings, {
    code: 'invalid-react-options', message: issue.message, path: toJsonPointer(issue.path.map(String)),
    docs: 'docs/reference/react.md#spec-settings',
  })));
}

/**
 * Reads a bare chart or an envelope up to the chart it selects, and hands
 * back the types that chart needs plus the rest of the parse. Both halves
 * refuse with the same diagnostics the one-pass parse produced, pointed back
 * into the bare spec when the caller sent one.
 */
/** Alias -> type from the generated table, so a grid named `facets` is a grid before any schema has loaded. */
const aliasOwners = new Map<string, string>();
for (const [type, aliases] of Object.entries(chartTypeAliases)) {
  for (const alias of aliases) aliasOwners.set(alias, type);
}
const staticCanonical = (name: string): string | undefined => (Object.hasOwn(schemaLoaders, name) ? name : aliasOwners.get(name));

export function beginSpecParse(spec: unknown, chart?: string): SpecParse {
  // The document parser wraps a bare chart into a one-chart envelope under
  // its `name`, default `chart`; its findings point back into the spec the
  // caller sent.
  const bare = isBareChart(spec);
  const rethrow = (error: unknown): never => {
    if (bare && error instanceof BoardplotSpecError) throw new BoardplotSpecError(error.errors.map(bareFinding));
    throw error;
  };
  const guarded = <T>(step: () => T): T => {
    try {
      return step();
    } catch (error) {
      if (error instanceof BoardplotSpecError) return rethrow(error);
      if (error instanceof DocumentSchemaError) return rethrow(new BoardplotSpecError(error.envelopeErrors));
      throw error;
    }
  };

  const selection = guarded(() => selectChart(spec, chart));
  // `finish` settles once. Validation appends its findings to the selected
  // envelope, so a second call on the same parse (React Strict Mode runs a
  // memo twice) must hand back the first outcome, not judge the chart again
  // and double every diagnostic.
  let settled: { value: ParsedChartSpec } | { thrown: unknown } | undefined;
  return {
    types: referencedChartTypes(selection.selected.type, selection.selected.data, staticCanonical),
    finish: () => {
      if (!settled) {
        try {
          settled = { value: guarded(() => validateSelection(selection)) };
        } catch (thrown) {
          settled = { thrown };
        }
      }
      if ('thrown' in settled) throw settled.thrown;
      return settled.value;
    },
  };
}

/** The document, its envelope and the one chart the spec selected out of it. */
interface Selection {
  doc: BoardplotDoc;
  envelope: DocumentEnvelope;
  selected: DocChart;
}

function selectChart(spec: unknown, chart?: string): Selection {
  if (chart !== undefined && (typeof chart !== 'string' || chart.length === 0)) {
    throw new BoardplotSpecError([completeDiagnostic({ code: 'invalid-react-options', message: 'chart must be a non-empty chart name.',
      suggest: 'Pass the name of one chart in the envelope.' }, { chart }, ['chart'], 'docs/reference/react.md#spec-settings')]);
  }
  const { doc, envelope } = parseDocumentInput(ownedDocumentCopy(spec));
  // A full theme object is adopted under its own name, as the CLI does.
  if (isThemeObject(doc.theme)) {
    const adopted = adoptThemeObject(doc.theme);
    if (!adopted.ok) {
      throw new DocumentSchemaError([completeDiagnostic({ code: adopted.code, message: adopted.message, suggest: adopted.suggest, fix: adopted.fix },
        doc, ['theme'], 'docs/reference/theme.md#theme')]);
    }
    pushAll(envelope.warnings, adopted.warnings.map(warning => completeDiagnostic(warning, doc, ['theme'], 'docs/reference/theme.md#theme')));
    doc.theme = adopted.ref;
  }
  const rootErrors = rootContextErrors(doc);
  if (rootErrors.length) throw new DocumentSchemaError(rootErrors.map(finding => completeDiagnostic(finding, doc)));
  const selected = chart === undefined && doc.charts.length === 1 ? doc.charts[0]
    : doc.charts.find(candidate => candidate.name === chart);
  if (!selected) throw new DocumentSchemaError([completeDiagnostic({
    code: chart === undefined ? 'chart-selection-required' : 'chart-not-found',
    message: chart === undefined ? 'Choose a chart by name when a document contains multiple charts.' : `No chart named '${chart}'.`,
    expected: { values: doc.charts.map(candidate => candidate.name) },
    suggest: 'Pass chart with one of the expanded chart names.',
  }, chart === undefined ? {} : { chart }, ['chart'], 'docs/reference/react.md#spec-settings')]);
  return { doc, envelope, selected };
}

function validateSelection({ doc, envelope, selected }: Selection): ParsedChartSpec {
  const validated = validateChartInput(doc, selected, envelope);
  if (!validated) throw new DocumentSchemaError(envelope.errors);
  const type = validated.definition.type;
  return {
    name: selected.name,
    request: {
      type, data: validated.data,
      options: {
        ...(doc.theme === undefined ? {} : { theme: doc.theme }),
        ...(typeof doc.locale === 'string' ? { locale: { language: doc.locale } } : {}),
        ...validated.options,
      } as RequestOptions,
      ...(validated.chart.annotations === undefined ? {} : { annotations: validated.chart.annotations as Annotation[] }),
    },
    warnings: envelope.warnings,
  };
}

export { BoardplotSpecError } from '../core/doc/specError';

// BoardplotChart links this module dynamically. Announcing it here lets a graph
// that already carries validation render its first spec without a round trip.
publishSpecValidator({ beginSpecParse, specSettings, BoardplotSpecError });
