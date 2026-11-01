/**
 * The theme shape, stated once: `THEME_SHAPE` is the closed key set, the
 * types, the bounds and the grammars of a theme file. `checkThemeShape`
 * walks it for every check (CLI, React, document), and `themeFieldReference`
 * in themeFields.ts walks it for `boardplot describe theme`. The TypeScript
 * type in types/theme.ts names the same fields for code.
 *
 * A module of its own because of where it is NEEDED: only a theme a caller
 * PATCHED goes through it, so a React chart entry fetches it on demand
 * (core/deferred) instead of carrying the checker for a preset. Code
 * splitting works on whole modules, so leaving it in `themeRules` — which
 * the render path reaches for its colour helpers — kept it linked whatever
 * the import said. The descriptions stay in themeFields.ts for the same
 * reason: no chart entry needs them.
 *
 * It imports from `themeRules` and `themeRules` never imports back: that one
 * direction is what keeps the checker out of the render path.
 */

import { toJsonPointer, type JsonPatchOperation } from './diagnostics/jsonPatch';
import { parseColor } from './color';
import { COLOR_FIX } from './colorLiteral';
import { isTransparentTableFill } from './themeFill';
import {
  FONT_FAMILY_GRAMMAR, FONT_FAMILY_MAX_LENGTH, FONT_FAMILY_PATTERN, judgmentErasure,
  MOTION_EASING_GRAMMAR, MOTION_EASING_MAX_LENGTH, MOTION_EASING_PATTERN,
  SHADOW_GRAMMAR, SHADOW_MAX_LENGTH, SHADOW_PATTERN,
} from './themeRules';
import type { LintWarning } from './types/scene';
import type { Theme } from './types/theme';

/**
 * One node of the theme shape. `opt` marks a key that may be absent; `doc`
 * names the description key in themeFields.ts when it is not the path
 * itself (the shared role, face and pad descriptions).
 */
export type ShapeNode = { opt?: true; doc?: string } & (
  | { kind: 'string'; min: number; max?: number; pattern?: RegExp; grammar?: string; color?: true }
  | { kind: 'number'; min?: number; max?: number; above?: true }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: readonly (string | number)[] }
  | { kind: 'object'; props: Readonly<Record<string, ShapeNode>> }
  | { kind: 'record'; value: ShapeNode }
  | { kind: 'array'; item: ShapeNode; min: number; max?: number }
  | { kind: 'tuple'; items: readonly ShapeNode[] }
);

const opt = (node: ShapeNode, doc?: string): ShapeNode => ({ ...node, opt: true, ...(doc ? { doc } : {}) });
const named = (node: ShapeNode, doc: string): ShapeNode => ({ ...node, doc });
const num = (min?: number, max?: number): ShapeNode => ({ kind: 'number', min, max });
const optNum = (min?: number, max?: number, doc?: string): ShapeNode => opt(num(min, max), doc);
const oneOf = (...values: (string | number)[]): ShapeNode => ({ kind: 'enum', values });
const optOneOf = (...values: string[]): ShapeNode => opt(oneOf(...values));
const flag: ShapeNode = opt({ kind: 'boolean' });
const object = (props: Record<string, ShapeNode>): ShapeNode => ({ kind: 'object', props });
const each = <K extends string>(keys: readonly K[], node: (key: K) => ShapeNode): Record<string, ShapeNode> =>
  Object.fromEntries(keys.map((key) => [key, node(key)]));
const grammar = (max: number, pattern: RegExp, words: string): ShapeNode =>
  ({ kind: 'string', min: 1, max, pattern, grammar: words });

const color: ShapeNode = { kind: 'string', min: 3, color: true };
const optColor = opt(color);
const fontFamily = grammar(FONT_FAMILY_MAX_LENGTH, FONT_FAMILY_PATTERN, FONT_FAMILY_GRAMMAR);
const weight = num(100, 1000);

const TYPE_ROLES = ['title', 'subtitle', 'label', 'axis', 'footnote', 'micro', 'secondary'] as const;

/** One type role. */
const fontSpec = object({
  family: opt(fontFamily, 'type.<role>.family'),
  size: { kind: 'number', min: 0, above: true, doc: 'type.<role>.size' },
  weight: named(weight, 'type.<role>.weight'),
  lineHeight: { kind: 'number', min: 0, above: true, opt: true, doc: 'type.<role>.lineHeight' },
});

/**
 * A table face. A glyph is printed as text and never reaches CSS;
 * its grammar only keeps control characters and runaway strings out.
 */
const tableFace = {
  size: optNum(6, 32, 'table.<face>.size'),
  weight: optNum(100, 1000, 'table.<face>.weight'),
  lineHeight: optNum(1, 2, 'table.<face>.lineHeight'),
  tracking: optNum(0, 0.3, 'table.<face>.tracking'),
};
/** A head row's air, in px. */
const tablePad = opt(object({ top: optNum(0, 24, 'table.<pad>.top'), bottom: optNum(0, 24, 'table.<pad>.bottom') }));
const optWeight = optNum(100, 1000);

/** The theme file, in the order `describe theme` lists it. Every object is closed. */
export const THEME_SHAPE: ShapeNode = object({
  name: { kind: 'string', min: 1 },
  color: object({
    good: color, bad: color, goodFill: optColor, badFill: optColor, rest: optColor, othersMark: optColor,
    markInk: optColor, heatTop: optColor, heatTopInk: optColor, onFillInk: optColor, onFillLightInk: optColor,
    neutral: color, neutralLight: color, neutralMark: optColor, highlight: color, focus: optColor, spark: optColor,
    total: color, others: color, ink: color, inkInverse: color, inkMuted: color, inkMeta: optColor,
    axis: color, grid: color, rule: optColor, reference: optColor, leader: color, background: color,
    series: { kind: 'array', item: color, min: 1 },
    casePair: opt({ kind: 'tuple', items: [color, color] }),
    stack: opt({ kind: 'array', item: color, min: 2 }),
    treemap: opt({ kind: 'array', item: color, min: 2 }),
    seriesOverflow: optOneOf('repeatLast', 'cycle'),
    palettes: opt({ kind: 'record', value: { kind: 'array', item: color, min: 2 } }),
    // External themes may carry more status keys than the documented ones.
    status: { kind: 'record', value: color },
    colorblind: object({ good: color, bad: color, goodFill: optColor, badFill: optColor }),
    warn: optColor, warnFill: optColor,
  }),
  // Scenario semantics are FIXED (notation rule), except the plan look.
  scenario: object({ AC: oneOf('solid'), PY: oneOf('solidLight'), PL: oneOf('outline', 'solidMuted'), FC: oneOf('hatch45') }),
  pattern: object({
    hatchAngle: oneOf(45), hatchColor: optOneOf('ink', 'segment'),
    hatchGap: num(2, 12), hatchStrokeWidth: num(0.5, 4), outlineStrokeWidth: num(0.5, 4),
  }),
  type: object({
    family: fontFamily,
    ...each(['title', 'subtitle', 'label', 'axis', 'footnote'] as const, () => named(fontSpec, 'type.<role>')),
    micro: opt(fontSpec), secondary: opt(fontSpec),
    // Width-class stepping: S and L columns; W-M is each role's own size.
    scale: opt(object(each(['S', 'L'] as const, () =>
      opt(object(each(TYPE_ROLES, () => optNum(6, 64, 'type.scale.<column>.<role>'))), 'type.scale.<column>')))),
    numeric: optOneOf('tabular', 'proportional'),
    figure: opt(object({ family: opt(fontFamily), weight: optWeight })),
    eyebrow: opt(object({
      size: optNum(6, 24), weight: optWeight, lineHeight: optNum(1, 2), tracking: optNum(0, 0.3),
      ink: optOneOf('inkMuted', 'inkMeta'),
    })),
    emphasis: opt(object({ weight: optWeight })),
  }),
  // Bands catch nonsense (a 300px margin), not taste.
  space: object({
    tierGap: num(4, 64), facetGap: num(4, 64), labelPad: num(1, 16),
    canvas: opt(object(each(['base', 'wide'] as const, () =>
      object(each(['top', 'right', 'bottom', 'left'] as const, () => named(num(0, 96), 'space.canvas.<class>.<side>')))))),
    gap: opt(object(each(['titleSubtitle', 'subtitlePlot', 'subtitlePlotWide', 'axisFootnote', 'axisFootnoteWide', 'footnoteSource', 'legend'] as const, () => optNum(0, 32)))),
    legendRowH: optNum(12, 28),
    barRow: opt(object({ thickness: num(2, 96), pitch: num(4, 120) })),
  }),
  legend: opt(object({ auto: flag, required: optOneOf('bottom', 'top') })),
  marks: opt(object({
    lineMarkers: optOneOf('auto', 'none'), areaTint: optNum(0, 1), nodeRadius: optNum(0, 16),
    nodeStroke: optOneOf('axis', 'grid', 'leader', 'ink', 'inkMuted'), nodeStrokeWidth: optNum(0, 3),
    restOutline: flag, areaFromOrigin: flag, barLabels: optOneOf('auto', 'outside'), comboColumnTint: optNum(0, 1),
    comboLine: optOneOf('series', 'ink'), sparkEnd: optOneOf('dot', 'ring'), sparkEndLabel: flag,
    sliceOutline: flag, othersOutline: flag, contrastEdge: flag, nodeFill: optOneOf('role', 'panel'), kpiCaret: flag, kpiSlotFill: flag,
    bridge: optOneOf('neutral', 'sign'), funnelFill: optOneOf('status', 'ramp'), statusFill: optOneOf('quiet', 'full'),
    bulletBandFill: optOneOf('light', 'full'),
  })),
  labels: opt(object({ endLabelPlacement: optOneOf('gutter', 'lineEnd'), ink: optOneOf('ink', 'muted') })),
  valueAxis: opt(object({ titles: flag, includeZero: flag, dualAxis: flag, gridDash: optOneOf('solid', 'dotted', 'dashed') })),
  interaction: opt(object({ dim: optNum(0, 1), outlineWidth: optNum(0) })),
  motion: opt(object({
    easing: opt(grammar(MOTION_EASING_MAX_LENGTH, MOTION_EASING_PATTERN, MOTION_EASING_GRAMMAR)),
    hoverIntent: optNum(0), fade: optNum(0), travel: optNum(0), layout: optNum(0),
  })),
  scheme: optOneOf('light', 'dark'),
  surface: opt(object({
    // 0.05 to 0.97: a dark surface tints the other way (a dark theme may use 0.12).
    chipTint: optNum(0.05, 0.97), rowTint: optNum(0.85, 0.98), elapsedTint: optNum(0.85, 0.99),
    anchorTint: optNum(0.85, 0.99), bandTint: optNum(0, 1), gapTint: optNum(0.5, 0.95),
    ribbonAlpha: optNum(0.15, 0.6), ribbonSheetAlpha: optNum(0.05, 0.6),
    heatSteps: opt({ kind: 'array', item: num(0, 1), min: 1 }),
    chipRadius: optNum(0, 6), sparkWash: flag, sparkAreaBase: optOneOf('zero', 'min'), shortfallCap: optOneOf('outline', 'solid'),
    panelShadow: opt(grammar(SHADOW_MAX_LENGTH, SHADOW_PATTERN, SHADOW_GRAMMAR)),
  })),
  stroke: opt(object(each(['seam', 'hair', 'rule', 'mark', 'data', 'focus', 'casing'] as const, () => optNum(0.25, 12)))),
  dash: opt(object(each(['reference', 'dotted'] as const, () => opt({ kind: 'array', item: num(0.5, 24), min: 2, max: 6 })))),
  table: opt(object({
    head: opt(object({ ...tableFace, case: optOneOf('upper', 'asis') })),
    section: opt(object({ ...tableFace, ink: optOneOf('ink', 'inkMuted', 'inkMeta'), case: optOneOf('upper', 'asis'), spaceBefore: optNum(0, 48), rule: optOneOf('heavy', 'hair') })),
    fixedType: flag,
    noPrevious: optOneOf('na', 'missing'),
    ofWhich: optOneOf('muted', 'ink'),
    groupGround: optOneOf('expanded', 'always', 'none'),
    glyphs: opt(object(each(['missing', 'na', 'nm', 'suppressed'] as const, () =>
      opt(grammar(8, /^[^\u0000-\u001F\u007F]+$/, 'printable characters only'))))),
    headPad: tablePad, groupPad: tablePad,
    mark: optOneOf('bare', 'boxed'),
    dataGap: optOneOf('word', 'glyph'),
    rows: opt(object({ lineHeight: tableFace.lineHeight, pad: optNum(0, 16) })),
    weights: opt(object({
      emphasis: optWeight, subtotal: optWeight, result: optWeight, block: optWeight,
      figures: opt(object(each(['member', 'measure', 'subtotal', 'result'] as const, () => optWeight))),
      member: optWeight, measure: optWeight,
    })),
    tones: optOneOf('ink', 'fill'),
    grounds: opt(object(each(['subtotal', 'total', 'good', 'goodStrong', 'warn', 'bad'] as const, () => optColor))),
    bar: opt(object({ fill: optColor, muted: optColor })),
    inks: opt(object(each(['head', 'subLabel', 'label', 'child', 'figure', 'qualifier', 'operator', 'driver', 'toggle', 'secondary'] as const, () => optColor))),
    ruleInk: optColor,
    ruleWidths: opt(object({ head: optNum(0, 8), row: optNum(0, 8) })),
    qualifier: opt(object({ sizeDelta: optNum(-12, 12), gap: optNum(0, 48) })),
    toggle: opt(object({ size: optNum(1, 48), gap: optNum(0, 64) })),
    operator: opt(object({ width: optNum(0, 64) })),
    resultRule: optOneOf('ink', 'rule', 'none'),
    finalRule: optOneOf('double', 'rule', 'none'),
    driver: opt(object({ italic: flag })),
    headRule: optOneOf('rule', 'ink'),
    blockRule: optOneOf('grid', 'rule'),
    endRule: optOneOf('auto', 'none'),
    closeRule: optOneOf('rule', 'grid', 'none'),
  })),
});

/** The name of the value a check received, in zod's words. */
function receivedName(raw: unknown): string {
  if (raw === null) return 'null';
  if (Array.isArray(raw)) return 'array';
  if (typeof raw === 'number' && Number.isNaN(raw)) return 'NaN';
  return typeof raw;
}

/** Check `raw` against `node` into `issues`, and return its owned plain copy: own and inherited shape keys, no prototype. */
function checkNode(node: ShapeNode, raw: unknown, path: string, issues: string[]): unknown {
  if (raw === undefined && node.opt) return undefined;
  const add = (message: string): void => { issues.push(`${path || '(root)'}: ${message}`); };
  const expected = (name: string) => add(`Invalid input: expected ${name}, received ${receivedName(raw)}`);
  const at = (key: string | number) => (path ? `${path}.${key}` : String(key));
  switch (node.kind) {
    case 'string':
      if (typeof raw !== 'string') expected('string');
      else {
        if (raw.length < node.min) add(`Too small: expected string to have >=${node.min} characters`);
        if (node.max !== undefined && raw.length > node.max) add(`Too big: expected string to have <=${node.max} characters`);
        if (node.pattern && !node.pattern.test(raw)) add(`must be ${node.grammar}`);
        if (node.color && !parseColor(raw) && !isTransparentTableFill(path, raw)) add(`must be a parseable colour. ${COLOR_FIX}`);
      }
      return raw;
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) expected('number');
      else {
        if (node.min !== undefined && (node.above ? raw <= node.min : raw < node.min)) {
          add(`Too small: expected number to be ${node.above ? '>' : '>='}${node.min}`);
        }
        if (node.max !== undefined && raw > node.max) add(`Too big: expected number to be <=${node.max}`);
      }
      return raw;
    case 'boolean':
      if (typeof raw !== 'boolean') expected('boolean');
      return raw;
    case 'enum':
      if (!node.values.includes(raw as string)) {
        add(node.values.length === 1
          ? `Invalid input: expected ${JSON.stringify(node.values[0])}`
          : `Invalid option: expected one of ${node.values.map((v) => JSON.stringify(v)).join('|')}`);
      }
      return raw;
    case 'array':
    case 'tuple': {
      if (!Array.isArray(raw)) return expected(node.kind);
      const min = node.kind === 'tuple' ? node.items.length : node.min;
      const max = node.kind === 'tuple' ? node.items.length : node.max;
      if (raw.length < min) return add(`Too small: expected array to have >=${min} items`);
      if (max !== undefined && raw.length > max) return add(`Too big: expected array to have <=${max} items`);
      return raw.map((item, index) => checkNode(node.kind === 'tuple' ? node.items[index]! : node.item, item, at(index), issues));
    }
    case 'object':
    case 'record': {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return expected(node.kind);
      const value = raw as Record<string, unknown>;
      const copy: Record<string, unknown> = {};
      const keep = (key: string, item: unknown) => { if (item !== undefined) copy[key] = item; };
      if (node.kind === 'record') {
        for (const [key, item] of Object.entries(value)) {
          // `__proto__` would set the copy's prototype instead of a key: refused as an unknown key.
          if (key === '__proto__') add(`Unrecognized key: "${key}"`);
          else keep(key, checkNode(node.value, item, at(key), issues));
        }
        return copy;
      }
      for (const [key, child] of Object.entries(node.props)) keep(key, checkNode(child, value[key], at(key), issues));
      for (const key of Object.keys(value)) if (!Object.hasOwn(node.props, key)) add(`Unrecognized key: "${key}"`);
      return copy;
    }
  }
}

/**
 * The structural theme check and the checked theme as an owned plain copy,
 * so a prototype or a later change to the caller's object cannot reach it.
 */
export function parseThemeShape(value: unknown): { issues: string[]; theme: unknown } {
  const issues: string[] = [];
  const theme = checkNode(THEME_SHAPE, value, '', issues);
  return { issues, theme };
}

/**
 * The structural theme check: every issue as `path: message`, `(root)` for
 * the top level. Empty when the value is a well-formed theme.
 */
export function checkThemeShape(value: unknown): string[] {
  return parseThemeShape(value).issues;
}

/** Runtime override gate: check only the erasure rule that can reject a patch. */
export function semanticErasureWarnings(theme: Theme): LintWarning[] {
  return ['good', 'bad', 'warn', 'goodFill', 'badFill', 'warnFill'].flatMap(key => {
    const mark = theme.color[key as 'good' | 'bad' | 'warn' | 'goodFill' | 'badFill' | 'warnFill'];
    const warning = mark === undefined ? undefined : judgmentErasure(key, mark, theme.color.background);
    return warning ? [warning] : [];
  });
}

/**
 * The way out of a shape refusal that names unknown keys: the keys to
 * remove, and a remove patch per key under `root`. Undefined when the shape
 * check named no unknown key. A retired key never gets here (retired.ts).
 */
export function unknownThemeKeyRepair(issues: readonly string[], root: string): { suggest: string; fix: JsonPatchOperation[] } | undefined {
  // The parent path is ours and dotted; the key is the author's and may hold
  // '.', '/' or '~' (a flattened "space.barGap"), so it stays one segment.
  const keys = issues.flatMap((issue) => {
    const unknown = /^(.+): Unrecognized key: "(.+)"$/.exec(issue);
    return unknown ? [[...(unknown[1] === '(root)' ? [] : unknown[1]!.split('.')), unknown[2]!]] : [];
  });
  if (!keys.length) return undefined;
  const accepted = keys.flatMap(segments => {
    let node = THEME_SHAPE;
    for (const key of segments.slice(0, -1)) {
      if (node.kind !== 'object' || !node.props[key]) return [];
      node = node.props[key]!;
    }
    return node.kind === 'object'
      ? [`${segments.slice(0, -1).join('.') || 'theme'} accepts ${Object.keys(node.props).join(', ')}.`] : [];
  });
  return {
    suggest: [`Remove ${keys.map((segments) => segments.join('.')).join(', ')}; the theme takes no such key.`, ...new Set(accepted)].join(' '),
    fix: keys.map((segments) => ({ op: 'remove', path: root + toJsonPointer(segments) })),
  };
}
