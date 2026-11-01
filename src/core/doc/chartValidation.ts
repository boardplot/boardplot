import * as z from 'zod';
import { EMPTY_DATA, isEmptyDataIssue } from '../emptyData';
import { isRecord } from '../lint/shared';
import { canonicalChartType, getChartSchemas, unsupported } from '../registry';
import { annotationSchema, diagnosedSafeParse } from '../schema/shared';
import { flattenIssues } from '../schema/flattenIssues';
import { allowedValues, expectedTypes } from '../diagnostics/describe';
import { refusalSuggest } from '../schema/capabilityReasons';
import { LABEL_KINDS } from '../schema/capability';
import { WORDING_KEYS, closestKey, movedKey, nearestOptionTerm, typoRenameFix, unknownKeySuggest, unknownOptionMessage, valueChangeSuggest } from '../schema/unknownKeyWords';
import { ownedDocumentCopy } from './docExpand';
import { chartSchemaDiagnostic, completeChartDiagnostic } from './diagnostics';
import type { DocChart, BoardplotDoc, DocumentEnvelope } from './document';
import { diagramKindError } from '../schema/diagramKind';
import type { DiagramData, DiagramOptions } from '../types/diagram';
import { pushAll } from '../arrays';
import { timeAnnotationAnchors } from '../timeAxis';
import { retireChartSettings } from '../retired';

type Definition = NonNullable<ReturnType<typeof getChartSchemas>>;

/**
 * The one sentence a caller gets for an unsupported name: which type and
 * option draw it, or that Boardplot does not draw it.
 */
export function unsupportedSuggestion(name: string): string | undefined {
  if (/^(driver[- ]?tree|issue[- ]?tree)$/i.test(name)) return 'Use type diagram with options.variant: issue-tree. Run boardplot describe diagram --full or boardplot fixtures --type diagram.';
  const entry = unsupported.find((candidate) => candidate.name === name);
  if (!entry) return undefined;
  const article = /^[aeiou]/.test(name) ? 'an' : 'a';
  if (!entry.use) return `Boardplot does not draw ${article} ${name}; call boardplot_list for the types it draws.`;
  const parts = Object.keys(entry.use.options).map((key) =>
    key === 'variant' ? `variant ${String(entry.use!.options.variant)}` : `options.${key}`);
  return `Boardplot draws ${article} ${name} as type ${entry.use.type}${parts.length ? ` with ${parts.join(' and ')}` : ''}.`;
}

/**
 * Every chart type one chart's validation consults: its own, and for a grid
 * the type of every panel and template the sweep walks, nested grids
 * included. A caller that loads schemas on demand needs all of them before
 * it validates — one missing panel type would silently drop that panel's
 * refusals. The data is raw here, so anything shape-odd is skipped, exactly
 * as the sweep itself skips it.
 */
/**
 * `canonical` resolves an alias such as `facets` to its type. The default asks
 * the registry, which serves the synchronous parse with the catalogue loaded;
 * a caller that loads schemas on demand passes its own static table, because
 * this runs before any schema has arrived.
 */
export function referencedChartTypes(
  type: string, data: unknown, canonical: (name: string) => string | undefined = canonicalChartType,
): string[] {
  return [...new Set([type, ...gridPanelOptionTargets(type, data, '', ['data'], canonical).map((target) => target.type)])];
}

/** Validate authored chart input without running layout or registering charts. */
export function validateChartInput(
  doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope,
  dataOwnership: 'document' | 'schema' = 'document',
) {
  const errorsBefore = envelope.errors.length;
  const warningsBefore = envelope.warnings.length;
  try {
    return parseChartInput(doc, chart, envelope, dataOwnership);
  } finally {
    for (let index = errorsBefore; index < envelope.errors.length; index++) {
      envelope.errors[index] = completeChartDiagnostic(doc, chart, envelope.errors[index]!);
    }
    for (let index = warningsBefore; index < envelope.warnings.length; index++) {
      envelope.warnings[index] = completeChartDiagnostic(doc, chart, envelope.warnings[index]!);
    }
  }
}

function parseChartInput(doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope, dataOwnership: 'document' | 'schema') {
  // The one choke point every verb lays out through, so the ownership
  // boundary lives here too: callers rebuild chart objects with ordinary
  // literals (theme/size/interactive overrides), and zod would read their
  // absent optional keys off a polluted prototype chain.
  // Library data is a JavaScript model, as in a registered normalizer. Keep
  // its schema output; document transports retain their JSON ownership guard.
  if (dataOwnership === 'document') chart = ownedDocumentCopy(chart);
  const def = getChartSchemas(chart.type);
  if (!def) {
    envelope.errors.push({
      code: 'unknown-type',
      message: `chart '${chart.name}': unknown type '${chart.type}'`,
      path: `charts[${chart.name}].type`,
      field: ['type'],
      suggest: unsupportedSuggestion(chart.type)
        ?? `Call boardplot_list for the types Boardplot draws; '${chart.type}' is not one of them.`,
    });
    return null;
  }
  // A retired setting draws as its successor or is dropped, and warns; only a key that never existed is refused below.
  const retired = retireChartSettings(def.type, chart, canonicalChartType);
  chart = retired.chart;
  pushAll(envelope.warnings, retired.warnings);
  // Options are validated against the chart's schema; unknown keys are refused
  const optResult = diagnosedSafeParse(
    def.optionsSchema as z.ZodType,
    // Apply alias values while its authored type is still available. The
    // owned copy keeps inherited optional keys out of the schema parse.
    ownedDocumentCopy({ ...def.aliasDefaults?.[chart.type], ...chart.options }),
  );
  // An explicit mode selects its data branch from the already-loaded schemas.
  const selectedMode = Object.entries(def.dataSchemaByOption ?? {})
    .find(([option]) => chart.options && Object.hasOwn(chart.options, option));
  const selectedSchema = selectedMode?.[1];
  const dataSchema = selectedSchema ?? def.dataSchema as z.ZodType;
  const dataResult = diagnosedSafeParse(dataSchema, chart.data);
  // A mode option on data of another form (options.stack on a panel grid) is
  // one finding about the option, not the mode schema's errors about data it
  // was never meant to read; an invalid option still reports first. The
  // mode's required data keys and the authored sub-options' own descriptions
  // say where the option applies.
  if (!dataResult.success && selectedMode && optResult.success && isRecord(chart.data)) {
    const [option, modeSchema] = selectedMode;
    const required = schemaNodeAtPath(modeSchema, [])[0]?.required ?? [];
    const missing = required.filter(key => !Object.hasOwn(chart.data as object, key));
    if (missing.length > 0) {
      const authored = chart.options?.[option];
      const notes = isRecord(authored) ? Object.keys(authored).flatMap(key => schemaNodeAtPath(def.optionsSchema as z.ZodType, [option, key])
        .flatMap(node => node.description ? [`options.${option}.${key}: ${node.description}`] : []).slice(0, 1)) : [];
      envelope.errors.push(completeChartDiagnostic(doc, chart, {
        code: 'invalid-options',
        message: `options.${option} needs data with ${required.join(', ')}; this data has no ${missing.join(', ')}`,
        suggest: [`Remove options.${option}, or send ${missing.join(', ')} in data.`, ...notes].join(' '),
      }, ['options', option]));
      return null;
    }
  }
  if (!dataResult.success && (!selectedSchema || optResult.success)) {
    for (const i of flattenIssues(dataResult.error.issues).flatMap(splitUnknownKeys)) {
      const unknown = unknownKeyText(i, dataSchema, def.optionsSchema as z.ZodType, undefined, chart.data);
      // The repair is the expected condition, as on every non-schema finding.
      envelope.errors.push(chartSchemaDiagnostic(doc, chart, 'data', unknown ? { ...i, message: unknown.suggest } : i, chart.data, isEmptyDataIssue(i, chart.data) ? EMPTY_DATA : 'invalid-data',
        unknown?.message ?? schemaIssueMessage(i, chart.data, i.path as (string | number)[], dataSchema) +
          inputHint(chart.data, i.path as (string | number)[], i.message === 'Invalid input'),
        unknown?.suggest ?? dataIssueSuggest(def.type, chart.data, i.path as (string | number)[], i)));
    }
    return null;
  }

  if (!optResult.success) {
    // flattenIssues, not error.issues: every `boolean | { … }` option is a zod
    // union, and a union reports one wrapper issue whose message is the useless
    // string "Invalid input" while the field-level reason sits nested inside.
    for (const i of flattenIssues(optResult.error.issues).flatMap(splitUnknownKeys)) {
      const unknown = unknownKeyText(i, def.optionsSchema as z.ZodType, undefined, def.type, chart.options);
      // A key a strict object refuses is the same finding as a key a plain one strips.
      envelope.errors.push(chartSchemaDiagnostic(doc, chart, 'options', unknown ? { ...i, message: unknown.suggest } : i, chart.options ?? {}, unknown ? 'unknown-option' : 'invalid-options',
        unknown?.message ?? schemaIssueMessage(i, chart.options ?? {}, i.path as (string | number)[], def.optionsSchema as z.ZodType),
        unknown?.suggest ?? withEventAtHint(chart, i, issueSuggestion(i, def.type, true, i.path as (string | number)[]))));
    }
    return null;
  }
  if (!dataResult.success) return null; // Both failed: the mode option error above takes priority.
  // ownedDocumentCopy on the parse OUTPUTS too: zod assembles ordinary
  // objects, and layout reads absent optional keys off them — an inherited
  // `labels: false` changed a clean render's bytes until these copies.
  const parsedOptions = ownedDocumentCopy(optResult.data as Record<string, unknown>);
  if (validateOptionKeys(doc, chart, envelope, def, dataResult.data, parsedOptions)) return null;
  if (def.type === 'diagram') {
    const error = diagramKindError((dataResult.data as DiagramData).nodes, parsedOptions as unknown as DiagramOptions);
    if (error) {
      envelope.errors.push(completeChartDiagnostic(doc, chart, {
        code: error.code, message: error.message, suggest: error.suggest,
      }, error.segments));
      return null;
    }
  }

  // Annotations validated (kind enum rejects garbage)
  if (chart.annotations !== undefined) {
    const time = def.type === 'line' && (parsedOptions.xAxis as { type?: string } | undefined)?.type === 'time';
    const annResult = diagnosedSafeParse(z.array(annotationSchema), time ? chart.annotations.map(timeAnnotationAnchors) : chart.annotations);
    if (!annResult.success) {
      for (const i of flattenIssues(annResult.error.issues)) {
        envelope.errors.push(chartSchemaDiagnostic(doc, chart, 'annotations', i, chart.annotations, 'invalid-annotation', i.message,
          withEventAtHint(chart, i, concreteSuggestion(i, def.type))));
      }
      return null;
    }
    if (time) chart = { ...chart, annotations: ownedDocumentCopy(annResult.data) };
  }

  if (def.type !== 'line') {
    const errorsBefore = envelope.errors.length;
    for (const [base, raw] of [[['annotations'], chart.annotations], [['options', 'annotations'], parsedOptions.annotations]] as const) {
      if (!Array.isArray(raw)) continue;
      raw.forEach((annotation, index) => {
        if (!isRecord(annotation) || annotation.kind !== 'valueLine' || (annotation.value ?? 'mean') !== 'mean') return;
        for (const field of ['seriesId', 'from', 'to']) if (annotation[field] !== undefined) envelope.errors.push(completeChartDiagnostic(doc, chart, {
          code: 'valueline-scope-unsupported', message: 'Scoped means are line-only; this chart cannot compute the requested scope.',
          suggest: 'Remove seriesId/from/to for the whole-chart mean, or use type line for a scoped mean.',
        }, [...base, index, field]));
      });
    }
    if (envelope.errors.length > errorsBefore) return null;
  }
  return { chart, definition: def, data: dataOwnership === 'schema' ? dataResult.data : ownedDocumentCopy(dataResult.data), options: parsedOptions };
}

function validateOptionKeys(
  doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope,
  def: Definition, data: unknown, parsedOptions: Record<string, unknown>,
): boolean {
  let hasInvalidOption = sweepStrippedOptionKeys(
    envelope,
    chart.options ?? {},
    parsedOptions,
    def.optionsSchema as z.ZodType,
    `chart '${chart.name}'`,
    `charts[${chart.name}].options`,
    { doc, chart, segments: ['options'] },
    def.type,
  );

  // Grid panels carry per-child options inside DATA, where the sweep above
  // cannot see them. Keys zod silently STRIPS get the same near-miss/ignored
  // split, per panel, with the panel spelled out in message and path.
  for (const target of gridPanelOptionTargets(def.type, data, `charts[${chart.name}].data`)) {
    const where = `chart '${chart.name}' ${target.label}`;
    const panelDef = getChartSchemas(target.type);
    if (!panelDef) {
      // 'text' and 'legend' composition panels take no options at all; a key
      // authored there would vanish with zero trace, so each is refused.
      if (target.type === 'text' || target.type === 'legend') {
        for (const key of Object.keys(target.options)) {
          hasInvalidOption = true;
          envelope.errors.push(completeChartDiagnostic(doc, chart, {
            code: 'unknown-option',
            message: `${where}: unknown option '${key}' ('${target.type}' composition panels take no options)`,
            displayPath: `${target.path}.${key}`,
            suggest: `Remove '${key}'; a '${target.type}' panel takes no options.`,
          }, [...target.segments, key]));
        }
      }
      continue;
    }
    const schema = panelDef.optionsSchema as z.ZodType;
    // The grid hands every panel its slot size and drops the standalone
    // canvas bound (isPanelSlotSizedIssue). A margin wider than the default
    // canvas must not cost the parse output, or nested keys go unjudged, so
    // a failed parse retries on a canvas no margin fills.
    const parse = (options: unknown) => {
      const result = schema.safeParse(options);
      return result.success || !isRecord(options)
        ? result
        : schema.safeParse(ownedDocumentCopy({ ...options, size: { width: Number.MAX_VALUE, height: Number.MAX_VALUE } }));
    };
    let panelResult = parse(target.options);
    // A repeat template's raw options fail on their '$dimension' placeholder;
    // bound to a slice value they parse, so nested keys are judged too.
    for (const value of panelResult.success ? [] : target.slices?.values ?? []) {
      const bound = parse(substitutePlaceholder(target.options, target.slices!.placeholder, value));
      if (bound.success) { panelResult = bound; break; }
    }
    // Option VALUES are the schema layer's job: grid composition forwards
    // every child refusal off the NORMALIZED panels, so a failed re-parse of
    // the raw authored object here proves nothing. This sweep hunts the one
    // thing zod never reports, silently STRIPPED keys; without a parse output
    // it checks the authored keys against the schema's own key list instead.
    hasInvalidOption =
      sweepStrippedOptionKeys(
        envelope,
        target.options,
        panelResult.success ? (panelResult.data as Record<string, unknown>) : undefined,
        schema,
        where,
        target.path,
        { doc, chart, segments: target.segments },
        canonicalChartType(target.type) ?? target.type,
      ) || hasInvalidOption;
  }
  return hasInvalidOption;
}

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  not?: object;
  const?: unknown;
  minimum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  enum?: unknown[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
  description?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
  propertyNames?: JsonSchemaNode;
  additionalProperties?: JsonSchemaNode | boolean;
}

interface PanelOptionTarget {
  type: string;
  options: Record<string, unknown>;
  /** Envelope path of the panel's options object, e.g. charts[g].data.panels.0.options */
  path: string;
  segments: (string | number)[];
  /** Human location for messages: "panel 'kpi'", "panel 2", or "template". */
  label: string;
  /** A repeat template's placeholder and the slice values it binds. */
  slices?: { placeholder: string; values: string[] };
}

/** The grid's slice binding (grid/normalize.ts substitute): every placeholder in every string, keys untouched. */
function substitutePlaceholder(value: unknown, placeholder: string, replacement: string): unknown {
  if (typeof value === 'string') return value.split(placeholder).join(replacement);
  if (Array.isArray(value)) return value.map((item) => substitutePlaceholder(item, placeholder, replacement));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitutePlaceholder(item, placeholder, replacement)]));
  return value;
}

/**
 * The authored options objects inside a grid document, one per chart panel,
 * template options once for the repeat form, nested explicit grids walked
 * through. Repeat templates of type 'grid' stop at the template's own options
 * on purpose: their bySlice map may carry slices the repeat never binds, and
 * sweeping unused slices would hard-error content the document never renders.
 * Structure the schema did not vouch for is skipped, not thrown on: this runs
 * after a successful dataSchema parse, so anything shape-odd here is a nested
 * document the schema layer already owns.
 */
export function gridPanelOptionTargets(
  chartType: string, data: unknown, basePath: string, segments: (string | number)[] = ['data'],
  canonical: (name: string) => string | undefined = canonicalChartType,
): PanelOptionTarget[] {
  if ((canonical(chartType) ?? chartType) !== 'grid' || !isRecord(data)) return [];
  const targets: PanelOptionTarget[] = [];
  // Object.hasOwn before every branch and member read: an inherited 'panels'
  // gadget would reroute repeat data into the explicit walk and skip the
  // authored template, and inherited 'options'/'data' would sweep
  // environment-supplied objects as document content.
  if (Object.hasOwn(data, 'panels') && Array.isArray(data.panels)) {
    data.panels.forEach((panel, index) => {
      if (!isRecord(panel) || typeof panel.type !== 'string') return;
      const options = Object.hasOwn(panel, 'options') && isRecord(panel.options) ? panel.options : {};
      targets.push({
        type: panel.type,
        options,
        path: `${basePath}.panels.${index}.options`,
        segments: [...segments, 'panels', index, 'options'],
        label: typeof panel.id === 'string' ? `panel '${panel.id}'` : `panel ${index}`,
      });
      pushAll(targets, gridPanelOptionTargets(
          panel.type,
          Object.hasOwn(panel, 'data') ? panel.data : undefined,
          `${basePath}.panels.${index}.data`,
          [...segments, 'panels', index, 'data'],
          canonical,
        ));
    });
    return targets;
  }
  if (!Object.hasOwn(data, 'template')) return targets;
  const template = data.template;
  if (!isRecord(template) || typeof template.type !== 'string') return targets;
  const repeat = Object.hasOwn(data, 'repeat') && isRecord(data.repeat) ? data.repeat : undefined;
  const sliceValues = repeat && Array.isArray(repeat.values) ? repeat.values.filter((value): value is string => typeof value === 'string') : [];
  targets.push({
    type: template.type,
    options: Object.hasOwn(template, 'options') && isRecord(template.options) ? template.options : {},
    path: `${basePath}.template.options`,
    segments: [...segments, 'template', 'options'],
    label: 'template',
    ...(repeat && typeof repeat.dimension === 'string' ? { slices: { placeholder: `$${repeat.dimension}`, values: sliceValues } } : {}),
  });
  // Descend through the slices the repeat actually binds: repeat.values
  // names what the document renders, so their panel options get the same
  // sweep as explicit panels. Unused bySlice entries stay unswept — content
  // the document never renders must not block it.
  const templateData =
    Object.hasOwn(template, 'data') && isRecord(template.data) ? template.data : undefined;
  const bySlice =
    templateData && Object.hasOwn(templateData, 'bySlice') && isRecord(templateData.bySlice)
      ? templateData.bySlice
      : undefined;
  if (repeat && bySlice && Array.isArray(repeat.values)) {
    for (const value of repeat.values) {
      if (typeof value !== 'string' || !Object.hasOwn(bySlice, value)) continue;
      pushAll(targets, gridPanelOptionTargets(
          template.type,
          bySlice[value],
          `${basePath}.template.data.bySlice.${value}`,
          [...segments, 'template', 'data', 'bySlice', value],
          canonical,
        ));
    }
  }
  return targets;
}

/**
 * Remediation hint for a data refusal. Normally the envelope type's own
 * fixture — but a grid-forwarded issue belongs to the CHILD whose schema
 * refused, so the hint walks the issue path through the raw grid data to the
 * deepest panel or template type on the way and names that child instead.
 * Option paths point at the child's options schema, data paths at its
 * fixture; the machine-readable target is what the author has to fix.
 */
function dataIssueSuggest(
  defType: string, data: unknown, path: (string | number)[], issue: z.core.$ZodIssue,
): string {
  let node: unknown = data;
  let child: string | undefined;
  let viaOptions = false;
  let optionPath: (string | number)[] | undefined;
  if (defType === 'grid') {
    for (let i = 0; i < path.length; i++) {
      const segment = path[i]!;
      let next: unknown;
      if (Array.isArray(node) && typeof segment === 'number') {
        next = node[segment];
      } else if (isRecord(node) && typeof segment === 'string' && Object.hasOwn(node, segment)) {
        next = node[segment];
      } else {
        next = undefined;
      }
      // Capture the child type only at STRUCTURAL hops — a panels[i] element
      // or a template. Child DATA carries its own `type` fields (a table's
      // sparkline columns) that must not hijack the suggestion.
      const structural =
        (segment === 'template' && isRecord(node)) ||
        (typeof segment === 'number' && i > 0 && path[i - 1] === 'panels');
      if (structural && isRecord(next) && Object.hasOwn(next, 'type') && typeof next.type === 'string') {
        child = next.type;
        viaOptions = path[i + 1] === 'options';
        optionPath = viaOptions ? path.slice(i + 2) : undefined;
      }
      node = next;
    }
  }
  const target = child && canonicalChartType(child) ? child : defType;
  return issueSuggestion(issue, target, viaOptions, optionPath);
}

/**
 * One imperative sentence naming the smallest change that clears the issue.
 * Where the schema states the allowed values or the bound, the sentence says
 * them; otherwise it points at the contract the type publishes.
 */
function issueSuggestion(
  issue: z.core.$ZodIssue, type: string, viaOptions: boolean, optionPath?: readonly (string | number)[],
): string {
  return concreteSuggestion(issue, type, optionPath) ?? (viaOptions
    ? `Check which options '${type}' takes and send one of those.`
    : `Take the shape from the '${type}' example and replace the values.`);
}

/**
 * An event `date` that is no date, on a chart with category ids, is most
 * likely a category id. `at` anchors an event to a category, so the fix names
 * it and gives the first category as the example. A time axis has no
 * category ids to anchor to.
 */
function withEventAtHint<T extends string | undefined>(chart: DocChart, issue: z.core.$ZodIssue, suggest: T): T | string {
  if (issue.code !== 'custom' || issue.path.at(-1) !== 'date' || !issue.message.startsWith('event date must be')) return suggest;
  const xAxis = chart.options?.xAxis;
  if (isRecord(xAxis) && xAxis.type === 'time') return suggest;
  const categories = isRecord(chart.data) ? chart.data.categories : undefined;
  const first = Array.isArray(categories) ? categories[0] : undefined;
  const id = typeof first === 'string' ? first : isRecord(first) ? first.id : undefined;
  if (typeof id !== 'string' || id === '') return suggest;
  return `${suggest ?? ''} To mark a category, use 'at' with its id in place of 'date', for example "at": ${JSON.stringify(id)}.`.trim();
}

/** The suggestion when the issue itself names the change, else undefined. */
function concreteSuggestion(
  issue: z.core.$ZodIssue, type: string, optionPath?: readonly (string | number)[],
): string | undefined {
  const typed = issue as z.core.$ZodIssue & {
    expected?: unknown; values?: unknown[]; minimum?: unknown; maximum?: unknown; keys?: unknown[];
    params?: { renameTo?: string };
  };
  if (Array.isArray(typed.values) && typed.values.length > 0) {
    return `Use one of: ${typed.values.map(value => JSON.stringify(value)).join(', ')}.`;
  }
  if (typed.code === 'invalid_type' && typed.expected === 'never') {
    // zod spells a key the schema does not accept at this position as
    // `expected: never`. A key the capability tables refuse names its way
    // out; any other may be valid elsewhere, so the sentence says
    // where it is refused, not that the type never takes it.
    return (optionPath && refusalSuggest(type, optionPath)) ?? 'Remove this field; it is not accepted at this position.';
  }
  if (typed.code === 'custom' && typed.params?.renameTo !== undefined) {
    return `Rename '${String(typed.path.at(-1))}' to '${typed.params.renameTo}'.`;
  }
  // A schema's own rule words the condition and the way out; that sentence
  // is the suggestion.
  if (typed.code === 'custom' && typed.message) return /[.?]$/.test(typed.message) ? typed.message : `${typed.message}.`;
  const values = typed.code === 'invalid_union' ? allowedValues(typed) : [];
  if (values.length > 0) return `Use one of: ${values.map(value => JSON.stringify(value)).join(', ')}.`;
  // A full theme object sent to options.theme parses as the { preset, overrides } form and misses its
  // preset (zod words that "received undefined"); a preset of the wrong type keeps its type repair.
  if (typed.code === 'invalid_type' && typed.path.at(-1) === 'preset' && typed.path.at(-2) === 'theme' && typed.message.endsWith('received undefined')
    || typed.code === 'invalid_union' && typed.path.at(-1) === 'theme') {
    return "A full theme object goes in the spec-root 'theme' field. 'options.theme' takes a preset name, or { preset, overrides }.";
  }
  if (typed.code === 'invalid_type' && typeof typed.expected === 'string') {
    return `Send ${article(typed.expected)} ${typed.expected} here.`;
  }
  if (typed.code === 'too_small' && typed.minimum !== undefined) {
    return `Use ${String(typed.minimum)} or more.`;
  }
  if (typed.code === 'too_big' && typed.maximum !== undefined) {
    return `Use ${String(typed.maximum)} or less.`;
  }
  if (Array.isArray(typed.keys) && typed.keys.length > 0) {
    return `Remove ${typed.keys.map(key => `'${String(key)}'`).join(', ')}.`;
  }
  return undefined;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Every authored option key the parse did not keep, at any depth, is refused
 * with unknown-option. zod strips an unknown key from a plain object
 * without a word, so a typo anywhere in the options draws the default; a
 * strict object refuses the same key. One rule covers both: the finding
 * names the nearest key that object takes, as a rename when it is close.
 * One body for the doc-level and the grid panel sweep so the vocabulary
 * cannot diverge. Object.hasOwn, not `in`: an authored key like 'toString'
 * is on the prototype of every parse result and would slip the sweep.
 */
function sweepStrippedOptionKeys(
  envelope: DocumentEnvelope,
  authored: Record<string, unknown>,
  parsed: Record<string, unknown> | undefined,
  schema: z.ZodType,
  where: string,
  pathBase: string,
  source: { doc: BoardplotDoc; chart: DocChart; segments: (string | number)[] },
  type: string,
): boolean {
  // Without a parse output (the raw re-parse failed on a value the schema
  // layer already owns), a top-level key counts as kept when the schema declares it.
  const declaredKeys =
    parsed === undefined
      ? new Set(Object.keys((z.toJSONSchema(schema, { io: 'input' }) as JsonSchemaNode).properties ?? {}))
      : undefined;
  const stripped: { path: (string | number)[]; known?: readonly string[] }[] = (parsed === undefined
    ? Object.keys(authored).filter((key) => !declaredKeys!.has(key)).map((key) => [key])
    : strippedKeys(authored, parsed)).map((path) => ({ path }));
  // The labels map keeps every key through the parse; each type reads its own kinds.
  const kinds = LABEL_KINDS[type];
  const labels = Object.hasOwn(authored, 'labels') ? authored.labels : undefined;
  if (kinds && isRecord(labels)) {
    for (const key of Object.keys(labels)) {
      if (labels[key] !== undefined && !kinds.includes(key)) stripped.push({ path: ['labels', key], known: kinds });
    }
  }
  for (const { path: keyPath, known } of stripped) {
    const key = String(keyPath.at(-1));
    const parent = keyPath.slice(0, -1);
    const field = [...source.segments, ...keyPath];
    // A data key written among the options (valueKind) is named where the data takes it.
    const dataPlace = parent.length === 0 ? dataKeyPlace(type, key) : undefined;
    if (dataPlace) {
      envelope.errors.push(completeChartDiagnostic(source.doc, source.chart, {
        code: 'unknown-option',
        message: `${where}: '${key}' is data, not a chart option — set it on ${dataPlace}`,
        displayPath: `${pathBase}.${key}`,
        suggest: `Remove '${key}' from options and set it on ${dataPlace}.`,
      }, field));
      continue;
    }
    // At the top the near miss also reads the words an option's values use (showValues -> labels).
    const near = parent.length === 0 ? nearestOptionKey(key, schema) : undefined;
    const siblings = known ?? expectedObjectKeys(schema, parent);
    const nearest = near ? { key: near, near: true } : closestKey(key, siblings);
    const dotted = keyPath.join('.');
    const moved = movedKey(dotted, (target) => expectedObjectKeys(schema, target.slice(0, -1)).includes(target.at(-1)!));
    // A rename is advice only when the near option takes the authored value too.
    const renameFits = !nearest?.near || moved !== undefined || valueFitsKey(schema, parent, nearest.key, valueAtPath(authored, keyPath));
    const fix = renameFits && moved === undefined ? typoRenameFix(field, nearest, siblings, valueAtPath(authored, parent)) : undefined;
    envelope.errors.push(completeChartDiagnostic(source.doc, source.chart, {
      code: 'unknown-option',
      message: `${where}: ${unknownOptionMessage(dotted, nearest, moved)}`,
      displayPath: `${pathBase}.${dotted}`,
      suggest: renameFits ? unknownKeySuggest(key, nearest, moved) : valueChangeSuggest(key, nearest!.key, kinds),
      ...(fix ? { fix } : {}),
    }, field));
  }
  return stripped.length > 0;
}

/** Whether the options schema takes `value` under `key` in the object at `parent`: the value alone, set where the rename would put it. */
function valueFitsKey(schema: z.ZodType, parent: readonly (string | number)[], key: string, value: unknown): boolean {
  const place = [...parent, key];
  let probe: unknown = value;
  for (const segment of [...place].reverse()) {
    if (typeof segment === 'number') {
      const items: unknown[] = [];
      items[segment] = probe;
      probe = items;
    } else probe = { [segment]: probe };
  }
  return !(schema.safeParse(probe).error?.issues ?? []).some((issue) => place.every((segment, index) => issue.path[index] === segment));
}

/** Where the data of a chart type takes a key: on each series, at the data root, or both. */
function dataKeyPlace(type: string, key: string): string | undefined {
  const dataSchema = getChartSchemas(type)?.dataSchema as z.ZodType | undefined;
  if (!dataSchema) return undefined;
  const series = expectedObjectKeys(dataSchema, ['series', 0]).includes(key);
  const root = expectedObjectKeys(dataSchema, []).includes(key);
  if (series) return root ? `each series (data.series[].${key}), or data.${key} for every series` : `each series (data.series[].${key})`;
  return root ? `data.${key}` : undefined;
}

/** Paths of the authored keys missing from the parse output, objects and arrays walked in step. */
function strippedKeys(authored: unknown, parsed: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(authored)) {
    if (!Array.isArray(parsed) || parsed.length !== authored.length) return [];
    return authored.flatMap((item, index) => strippedKeys(item, parsed[index], [...path, index]));
  }
  if (!isRecord(authored) || !isRecord(parsed)) return [];
  return Object.keys(authored).flatMap((key) => {
    // An explicit undefined (a React prop) authors nothing.
    if (authored[key] === undefined) return [];
    if (!Object.hasOwn(parsed, key)) return [[...path, key]];
    return strippedKeys(authored[key], parsed[key], [...path, key]);
  });
}

/**
 * A strict object reports every extra key in one issue addressed to the
 * object. Split it so each key gets its own finding whose path names the key
 * itself: that is the field to rename or remove.
 */
function splitUnknownKeys(issue: z.core.$ZodIssue): z.core.$ZodIssue[] {
  if (issue.code !== 'unrecognized_keys') return [issue];
  return issue.keys.map((key) => ({ ...issue, keys: [key], path: [...issue.path, key] }));
}

/**
 * Message and repair for one unknown key (after splitUnknownKeys): the keys
 * the object does take, the near miss when one is close (the same distance
 * rule as unknown options), and for a data root key the schema declares as an
 * option, the move to options.
 */
function unknownKeyText(
  issue: z.core.$ZodIssue, schema: z.ZodType, optionsSchema?: z.ZodType, optionsType?: string, authored?: unknown,
): { message: string; suggest: string } | undefined {
  if (issue.code !== 'unrecognized_keys') return undefined;
  const path = issue.path as (string | number)[];
  const key = String(path.at(-1));
  if (optionsSchema && path.length === 1 && expectedObjectKeys(optionsSchema, []).includes(key)) {
    return {
      message: `'${key}' is a chart option, not data — move it to options.${key}`,
      suggest: `Move '${key}' to options.${key}.`,
    };
  }
  const all = expectedObjectKeys(schema, path.slice(0, -1));
  const nodes = schemaNodeAtPath(schema, path.slice(0, -1));
  const branches = nodes.flatMap(node => node.anyOf ?? node.oneOf ?? []).filter(node => node.properties);
  const value = valueAtPath(authored, path.slice(0, -1));
  const selected = isRecord(value) ? branches.find(branch => Object.entries(branch.properties ?? {}).some(([name, field]) =>
    field.const !== undefined && field.const === value[name])) : undefined;
  if (all.includes(key)) {
    const rule = selected
      ? `This union branch takes ${Object.keys(selected.properties!).join(', ')}; '${key}' belongs to another branch.`
      : `Choose either ${branches.map(branch => `{${Object.keys(branch.properties!).join(', ')}}`).join(' or ')}; do not combine branch fields.`;
    return { message: rule, suggest: rule };
  }
  // A union branch chosen by its tag ({ kind: 'computed' }) takes only its own keys.
  const known = selected ? Object.keys(selected.properties!).filter(name => !refusedNode(selected.properties![name]!)) : all;
  const moved = optionsType === undefined ? undefined
    : movedKey(path.join('.'), (target) => expectedObjectKeys(schema, target.slice(0, -1)).includes(target.at(-1)!));
  if (moved) return { message: `unknown key '${key}' — it is ${moved}`, suggest: unknownKeySuggest(key, undefined, moved) };
  // A cell key beside a keyed value ({ categoryId, value, label }) belongs inside the rich value.
  if (known.includes('value') && expectedObjectKeys(schema, [...path.slice(0, -1), 'value']).includes(key)) {
    const rich = `{ categoryId, value: { number, ${key === 'number' ? 'label' : key} } }`;
    return {
      message: `unknown key '${key}' beside value; '${key}' belongs inside the value: ${rich}`,
      suggest: `Move '${key}' into the value object: ${rich}.`,
    };
  }
  const closest = closestKey(key, known);
  return {
    message: `unknown key '${key}'${closest?.near ? ` — try: ${closest.key}` : ''}${known.length ? `; known keys: ${known.join(', ')}` : ''}`,
    // A strict options schema refuses a capability key as unknown; the table still names the way out.
    suggest: (!closest?.near && optionsType && refusalSuggest(optionsType, path)) || unknownKeySuggest(key, closest),
  };
}

function nearestOptionKey(input: string, schema: z.ZodType): string | undefined {
  const properties = (z.toJSONSchema(schema, { io: 'input' }) as JsonSchemaNode).properties ?? {};
  return nearestOptionTerm(input, Object.entries(properties).map(([key, propertySchema]) => [key, WORDING_KEYS.has(key) ? [key] : [key, ...schemaTerms(propertySchema)]]));
}

function schemaTerms(schema: JsonSchemaNode): string[] {
  const terms: string[] = [];
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    terms.push(key, ...schemaTerms(child));
  }
  for (const value of schema.enum ?? []) {
    if (typeof value === 'string') terms.push(value);
  }
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    terms.push(...schemaTerms(branch));
  }
  if (schema.items) terms.push(...schemaTerms(schema.items));
  return terms;
}

/**
 * The schema nodes at `path`, with every `$ref` resolved (a lazy schema such
 * as a recursive calc or row sits behind one) and a record's value node
 * under each of its keys.
 */
function schemaNodeAtPath(schema: z.ZodType, path: readonly (string | number)[]): JsonSchemaNode[] {
  const root = z.toJSONSchema(schema, { io: 'input' }) as JsonSchemaNode;
  const resolve = (node: JsonSchemaNode): JsonSchemaNode => {
    const resolved = node.$ref?.startsWith('#/$defs/') ? root.$defs?.[node.$ref.slice('#/$defs/'.length)] : undefined;
    if (!resolved) return node;
    const branches = (list?: JsonSchemaNode[]) => list?.map(resolve);
    return { ...resolved, anyOf: branches(resolved.anyOf), oneOf: branches(resolved.oneOf), allOf: branches(resolved.allOf) };
  };
  let nodes = [root];
  for (const segment of path) {
    const next: JsonSchemaNode[] = [];
    for (const node of nodes) {
      const branches = [node, ...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])];
      for (const branch of branches) {
        if (typeof segment === 'number') {
          if (branch.items) next.push(resolve(branch.items));
        } else if (branch.properties?.[segment]) {
          next.push(resolve(branch.properties[segment]));
        } else if (typeof branch.additionalProperties === 'object' && (branch.propertyNames?.enum ?? [segment]).includes(segment)) {
          next.push(resolve(branch.additionalProperties));
        }
      }
    }
    nodes = next;
  }
  return nodes;
}

/** The keys the object at `path` accepts; a key it refuses by name (`not: {}`) is not one of them. */
function expectedObjectKeys(schema: z.ZodType, path: readonly (string | number)[]): string[] {
  const keys = new Set<string>();
  for (const node of schemaNodeAtPath(schema, path)) {
    for (const branch of [node, ...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
      for (const [key, child] of Object.entries(branch.properties ?? {})) if (!refusedNode(child)) keys.add(key);
      // A record with fixed keys ({ pending: 'Learning' }) takes the keys its propertyNames list.
      for (const key of branch.propertyNames?.enum ?? []) if (typeof key === 'string') keys.add(key);
    }
  }
  return [...keys];
}

function refusedNode(node: JsonSchemaNode): boolean {
  return node.not !== undefined && Object.keys(node.not).length === 0;
}

function enrichIssueMessage(issue: z.core.$ZodIssue, data: unknown, path: (string | number)[]): string {
  if (issue.message !== 'Invalid input') return issue.message;
  const expected = expectedTypes(issue);
  if (expected.length === 0) return issue.message;
  const value = valueAtPath(data, path);
  const names =
    expected.includes('number') && expected.includes('null') && expected.includes('object')
      ? expected.map((name) => (name === 'object' ? 'value-object' : name))
      : expected;
  return `Invalid input: expected ${names.join(' | ')}, received ${receivedType(value)}`;
}

function receivedValue(value: unknown): string {
  if (typeof value === 'string') return `string '${value.replaceAll("'", "\\'")}'`;
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return `${typeof value} ${String(value)}`;
}

function schemaIssueMessage(
  issue: z.core.$ZodIssue,
  data: unknown,
  path: (string | number)[],
  schema: z.ZodType,
): string {
  // A grid forwards a child's schema issues. Its generic data slot cannot
  // describe the child's union, so read the schema named by that panel.
  const panel = path[0] === 'panels' && typeof path[1] === 'number' && path[2] === 'data'
    && isRecord(data) && Array.isArray(data.panels) ? data.panels[path[1]] : undefined;
  const child = isRecord(panel) && typeof panel.type === 'string' ? getChartSchemas(panel.type) : undefined;
  if (child) return schemaIssueMessage(issue, panel.data, path.slice(3), child.dataSchema);
  const typed = issue as z.core.$ZodIssue & { expected?: unknown; values?: unknown[] };
  // A schema that words its own refusal of a value keeps that wording.
  if (typed.code === 'invalid_value' && Array.isArray(typed.values) && typed.values.length > 0 && typed.message.startsWith('Invalid option')) {
    const field = [...path].reverse().find((segment): segment is string => typeof segment === 'string') ?? 'the value';
    return `${field} accepts one of ${typed.values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(', ')}`;
  }
  // A union whose every branch is an object fails as a union; it is
  // described like one object, branch by branch.
  const types = expectedTypes(issue);
  if (typed.code === 'invalid_union' && isRecord(valueAtPath(data, path))) {
    const primitives = [...new Set(schemaNodeAtPath(schema, path).flatMap(schemaBranches)
      .flatMap(node => typeof node.type === 'string' && node.type !== 'object' ? [node.type] : []))];
    return `expected ${[...primitives, objectShape(schema, data, path)].join(' | ')}; got ${receivedValue(valueAtPath(data, path))}`;
  }
  if ((typed.code === 'invalid_type' && typed.expected === 'object') || (typed.code === 'invalid_union' && types.length === 1 && types[0] === 'object')) {
    return `expected ${objectShape(schema, data, path)}; got ${receivedValue(valueAtPath(data, path))}`;
  }
  return enrichIssueMessage(issue, data, path);
}

/**
 * What an expected object takes, so one error carries everything a valid
 * value needs: the required and the optional fields with their
 * types and allowed values, the condition the object checks across its
 * fields, and an example the schema accepts. A union of objects is described
 * branch by branch, each with its own example, since merging the branches
 * would require keys no single branch takes.
 */
function objectShape(schema: z.ZodType, data: unknown, path: (string | number)[]): string {
  const branches = schemaNodeAtPath(schema, path)
    .flatMap(schemaBranches)
    .filter((branch) => Object.values(branch.properties ?? {}).some((child) => !refusedNode(child)));
  if (branches.length === 0) return 'an object';
  if (branches.length === 1) return `an object with ${branchShape(branches[0]!, schema, data, path)}`;
  return `one of ${branches.length} objects: ${branches.map((branch, index) => `[${index + 1}] ${branchShape(branch, schema, data, path)}`).join(' ')}`;
}

function schemaBranches(node: JsonSchemaNode): JsonSchemaNode[] {
  return [node, ...[...node.anyOf ?? [], ...node.oneOf ?? []].flatMap(schemaBranches)];
}

/**
 * One object's fields, condition and example. The example is built from the
 * schema with every number at its floor; when the schema refuses that, an
 * object's own rule is the condition, and the numbers count up. An example is
 * printed only when the schema accepts it at `path`.
 */
function branchShape(branch: JsonSchemaNode, schema: z.ZodType, data: unknown, path: (string | number)[]): string {
  const fields = new Map(Object.entries(branch.properties ?? {}).filter(([, child]) => !refusedNode(child)));
  const required = new Set(branch.required ?? []);
  const keys = [...fields.keys()];
  const list = (names: string[]) => names.map((name) => `${name} (${fieldType(fields.get(name)!)})`).join(', ');
  const needed = keys.filter((key) => required.has(key));
  const optional = keys.filter((key) => !required.has(key));
  const parts = [
    ...(needed.length ? [`required ${list(needed)}`] : []),
    ...(optional.length ? [`optional ${list(optional)}`] : []),
  ];
  if (needed.length > 0) {
    const floor = exampleObject(fields, needed, false);
    const floorIssues = issuesWith(schema, data, path, floor);
    if (floorIssues?.length === 0) {
      parts.push(`example ${JSON.stringify(floor)}`);
    } else if (floorIssues) {
      const conditions = floorIssues.filter((issue) => issue.code === 'custom' && issue.path.length === path.length).map((issue) => issue.message);
      if (conditions.length === floorIssues.length) pushAll(parts, conditions);
      const counted = exampleObject(fields, needed, true);
      if (issuesWith(schema, data, path, counted)?.length === 0) parts.push(`example ${JSON.stringify(counted)}`);
    }
  }
  return parts.join('; ');
}

/** A field's type as a message prints it: its allowed values where it lists them. */
function fieldType(node: JsonSchemaNode): string {
  if (node.const !== undefined) return quoted(node.const);
  if (node.enum) return node.enum.map(quoted).join(' | ');
  const branches = node.anyOf ?? node.oneOf;
  if (branches) return [...new Set(branches.map(fieldType))].join(' | ');
  return Array.isArray(node.type) ? node.type.join(' | ') : node.type ?? 'any';
}

function quoted(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

/** The required fields at their simplest values; numbers at their floor, or counting up from it. */
function exampleObject(fields: Map<string, JsonSchemaNode>, keys: string[], countUp: boolean): Record<string, unknown> {
  return Object.fromEntries(keys.map((key, index) => [key, exampleValue(fields.get(key)!, countUp ? index : 0)]));
}

function exampleValue(node: JsonSchemaNode, step: number): unknown {
  if (node.const !== undefined) return node.const;
  if (node.enum?.length) return node.enum[0];
  const branch = (node.anyOf ?? node.oneOf)?.find((candidate) => candidate.type !== 'null');
  if (branch) return exampleValue(branch, step);
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === 'number' || type === 'integer') {
    return (node.minimum ?? (node.exclusiveMinimum === undefined ? 0 : node.exclusiveMinimum + 1)) + step;
  }
  if (type === 'string') return 'a';
  if (type === 'boolean') return true;
  if (type === 'array') return Array.from({ length: node.minItems ?? 0 }, () => exampleValue(node.items ?? {}, step));
  if (type === 'object') return Object.fromEntries((node.required ?? []).map((key) => [key, exampleValue(node.properties?.[key] ?? {}, step)]));
  return null;
}

/**
 * The issues the schema raises at or under `path` once `value` sits there;
 * undefined when the value cannot be put there, so nothing is promised.
 */
function issuesWith(schema: z.ZodType, data: unknown, path: (string | number)[], value: unknown): z.core.$ZodIssue[] | undefined {
  let copy: unknown;
  try {
    copy = structuredClone(data);
  } catch {
    return undefined;
  }
  let node = copy;
  for (const segment of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[segment];
  }
  if (path.length === 0 || node === null || typeof node !== 'object') return undefined;
  (node as Record<string | number, unknown>)[path.at(-1)!] = value;
  const result = schema.safeParse(copy);
  return result.success ? [] : flattenIssues(result.error.issues)
    .filter((issue) => path.every((segment, index) => issue.path[index] === segment));
}

function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Common stringified values get an actionable JSON-shape remedy. */
function inputHint(data: unknown, path: (string | number)[], enrichBareUnion: boolean): string {
  const node = valueAtPath(data, path);
  if (typeof node !== 'string') return '';
  if (/^[+\-\s]*[\d.,]+\s*%$/.test(node)) {
    return " — use 'pct' for percent cells (write 50.5, meaning 50.5%)";
  }
  if (
    enrichBareUnion &&
    /^[+\-−]?(?:\d{1,3}(?:[ ,.'’]\d{3})+|\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+\-]?\d+)?$/i.test(
      node.trim(),
    )
  ) {
    return " — use an unquoted JSON number (use '.' for decimals and no thousands separator)";
  }
  return '';
}

function valueAtPath(data: unknown, path: (string | number)[]): unknown {
  let node: unknown = data;
  for (const seg of path) {
    if (node == null || typeof node !== 'object') break;
    node = (node as Record<string | number, unknown>)[seg];
  }
  return node;
}
