/**
 * The Boardplot engine for Python: the CLI's own render, rows, describe and
 * list code, bundled into one IIFE (global `Boardplot`) that runs in embedded
 * V8 (mini-racer). Every function takes one JSON string and returns one JSON
 * string, the body the CLI prints for the same input.
 */
import { polyfills as installedPolyfills } from './polyfills';
import { render as cliRender } from '../../../src/cli/render';
import { applyRows } from '../../../src/cli/rows';
import { describe as cliDescribe } from '../../../src/cli/describe';
import { list as cliList } from '../../../src/cli/list';
import { InputError, runVerb, type VerbResult } from '../../../src/cli/result';
import { registerCatalogue } from '../../../src/core/charts';
import { registerAllGeoPacks } from '../../../src/core/geo/packs';
import { linkAnnotateEngine } from '../../../src/core/annotateEngine';
import { linkStoryLayer } from '../../../src/core/storyLayer';
import { linkThemeShapeRules } from '../../../src/core/themeShapeRules';
import { sanitizeObjectPrototype } from '../../../src/core/doc/docExpand';
import { isSizeDependentRefusal } from '../../../src/core/schema/refusals';
import { CHART_TYPE_OF, ROWS_SHAPES } from '../../../src/core/rowsTypes';
import { BOARDPLOT_VERSION } from '../../../src/version';

/** The build identity: the npm distribution identity plus the frontend protocol. build.mjs injects it. */
interface BuildIdentity {
  version: string;
  engineRev: number;
  git: string;
  source: string;
  frontendProtocol: number;
}
declare const __BOARDPLOT_IDENTITY__: BuildIdentity;

// Linked and registered by value, as the CLI entry does (src/cli/main.ts), so
// no bundler drops them: patched themes, annotations, the story layer, every
// chart type and every geo pack.
linkThemeShapeRules();
linkAnnotateEngine();
linkStoryLayer();
registerCatalogue();
registerAllGeoPacks();
// A fresh isolate has no foreign Object.prototype members; the CLI clears them the same way.
sanitizeObjectPrototype(() => undefined);

export const identity: BuildIdentity = __BOARDPLOT_IDENTITY__;
export const version: string = BOARDPLOT_VERSION;
/** The web APIs the engine had to add to this V8 isolate. */
export const polyfills: readonly string[] = installedPolyfills;

type Body = Record<string, unknown>;

interface RenderInput {
  spec: unknown;
  rows?: unknown;
  columns?: unknown;
  width?: unknown;
  height?: unknown;
  target?: unknown;
}

/** Parse the argument; a broken JSON string is the caller's input error, not an engine failure. */
function parse(json: string): Body {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new InputError('invalid-json', `the engine argument is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('invalid-argument', 'the engine argument must be a JSON object', { expected: { types: ['object'] } });
  }
  return value as Body;
}

/** Run one verb on a JSON argument and return its body as JSON, as the CLI prints it. */
function call(json: string, work: (input: Body) => VerbResult): string {
  return JSON.stringify(runVerb(() => work(parse(json))).body);
}

function renderInput(input: Body, rows: boolean): RenderInput {
  return {
    spec: input.spec,
    ...(rows && input.rows !== undefined ? { rows: input.rows } : {}),
    ...(rows && input.columns !== undefined ? { columns: input.columns } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.target !== undefined ? { target: input.target } : {}),
  };
}

/** The CLI render body (format svg, svg and reading returned) for a spec and an optional explicit size. */
export function render(json: string): string {
  return call(json, (input) => cliRender({ ...renderInput(input, false), format: 'svg', return: ['svg', 'reading'] }));
}

/** A refusal finding as the CLI sends it: the minimum size sits under `expected.minimum`. */
interface Finding {
  code: string;
  message: string;
  expected?: { minimum?: { width?: unknown; height?: unknown } };
}

/** The minimum size a refusal names, only when it has a width and a height. */
function minimumOf(finding: Finding): { width: number; height: number } | undefined {
  const minimum = finding.expected?.minimum;
  return typeof minimum?.width === 'number' && typeof minimum.height === 'number' ? { width: minimum.width, height: minimum.height } : undefined;
}

/**
 * Map rows (when given), validate and draw once. Three kinds of answer:
 * - `drawn`: `{ok: true, kind, spec, svg, size, reading, notes, warnings, ...}`, the CLI body plus the resolved spec;
 * - `refused`: the spec is valid, but the layout refuses it at this size with refusals that more width or
 *   height can clear: `{ok: false, kind, spec, svg: null, refusal: {code, message, minimum?}, errors, warnings}`;
 * - `invalid`: `{ok: false, kind, errors, warnings}`, the CLI body.
 * The resolved spec is the bare spec after `applyRows`. A one-chart document answers like a bare chart.
 */
export function prepare(json: string): string {
  return call(json, (input) => {
    const request = renderInput(input, true);
    const result = cliRender({ ...request, format: 'svg', return: ['svg', 'reading'] });
    const body = result.body;
    if (body.ok !== true) {
      const errors = (body.errors ?? []) as Finding[];
      if (errors.length === 0 || !errors.every((error) => isSizeDependentRefusal(error))) {
        return { ...result, body: { ...body, kind: 'invalid' } };
      }
      const first = errors[0]!;
      const minimum = minimumOf(first);
      return {
        ...result,
        body: {
          ok: false, kind: 'refused', spec: applyRows(request.spec, request).spec, svg: null,
          refusal: { code: first.code, message: first.message, ...(minimum ? { minimum } : {}) },
          errors, warnings: body.warnings ?? [], engineRev: body.engineRev,
        },
      };
    }
    const resolved = applyRows(request.spec, request).spec;
    const charts = body.charts as Body[] | undefined;
    if (charts !== undefined) {
      if (charts.length !== 1) {
        throw new InputError('invalid-argument', `a Chart holds one chart; this document draws ${charts.length}`, {
          path: '/spec/charts', suggest: 'Pass one chart of the document at a time.',
        });
      }
      const { charts: _charts, ...rest } = body;
      return { ...result, body: { ...rest, ...charts[0], kind: 'drawn', spec: resolved } };
    }
    return { ...result, body: { ...body, kind: 'drawn', spec: resolved } };
  });
}

/** The body of `boardplot describe` for the input `boardplot_describe` takes: type, detail, path, schema. */
export function describe(json: string): string {
  return call(json, (input) => cliDescribe(input));
}

/** The body of `boardplot list`; `boardplot_list` takes no arguments. */
export function list(json: string): string {
  return call(json, (input) => {
    const extra = Object.keys(input);
    if (extra.length) {
      throw new InputError('invalid-argument', `list takes no arguments, not ${extra.join(', ')}`, { path: `/${extra[0]}` });
    }
    return cliList();
  });
}

/** Every chart type and alias with its type, and the rows shape of each type that takes rows. */
export function rowsShapes(): string {
  return JSON.stringify({ types: Object.fromEntries(CHART_TYPE_OF), shapes: Object.fromEntries(ROWS_SHAPES) });
}
