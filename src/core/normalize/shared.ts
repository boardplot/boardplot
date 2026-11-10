/**
 * Shared normalization: the closed set of input shorthands.
 * Accept ergonomic input, produce canonical internal form. Tooling echoes
 * canonical form back.
 */

import { plainText } from '../inlineBold';
import type { Size } from '../geometry';
import type { Cell, Id, Scenario } from '../types/cell';
import type { Category, Series } from '../types/data';
import type { BaseOptions, RenderTarget, Subtitle } from '../types/options';
import { DEFAULT_TARGET, resolveTargetSize } from '../target';
import type { JsonPatchOperation } from '../diagnostics/jsonPatch';

export class NormalizeError extends Error {
  code: string;
  /** Display path, in the `series[id].values` spelling authors read. */
  path: string;
  /** The same field as pointer segments, relative to the chart. */
  segments?: readonly (string | number)[];
  suggest?: string;
  fix?: JsonPatchOperation[];

  constructor(
    code: string, path: string, message: string, suggest?: string,
    fix?: JsonPatchOperation[],
    segments?: readonly (string | number)[],
  ) {
    super(message);
    this.name = 'NormalizeError';
    this.code = code;
    this.path = path;
    this.segments = segments;
    this.suggest = suggest;
    this.fix = fix;
  }
}

/**
 * The field a refusal's display path names in the authored chart, for a
 * refusal thrown without segments: `rows[cafe].cells[state]` is
 * data.rows[i].cells.state, where item i has the id `cafe`. The path is read
 * from the chart, then from its data, then from its options; a path whose
 * last key is absent names it under the first parent that exists.
 * Undefined when no reading finds the parent.
 *
 * Throw sites put ids and indices alike in brackets (`rows[${row.id}]`,
 * `series[${si}]`), and an id can be '1'. A bracket names the one item with
 * that id; it reads as an index only where that item carries no other id.
 * When the two readings name different items, or several items share the
 * id, the path names no field: a wrong pointer is worse than none.
 */
export function displayPathField(chart: { data?: unknown; options?: unknown }, path: string): (string | number)[] | undefined {
  const keys = [...path.matchAll(/([^.[\]]+)|\[([^\]]*)\]/g)].map((match) => ({ key: match[1] ?? match[2]!, bracket: match[2] !== undefined }));
  if (!keys.length) return undefined;
  const CONFLICT = -1;
  const step = (node: unknown, { key, bracket }: { key: string; bracket: boolean }): string | number | undefined => {
    if (Array.isArray(node)) {
      const at = /^\d+$/.test(key) && Number(key) < node.length ? Number(key) : undefined;
      if (!bracket) return at;
      const idOf = (item: unknown) => (typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id);
      const byId = node.flatMap((item, index) => (idOf(item) === key ? [index] : []));
      const byIndex = at !== undefined && (idOf(node[at]) === undefined || String(idOf(node[at])) === key) ? at : undefined;
      if (byId.length > 1 || (byId.length === 1 && byIndex !== undefined && byId[0] !== byIndex)) return CONFLICT;
      return byId[0] ?? byIndex;
    }
    return node !== null && typeof node === 'object' && Object.hasOwn(node, key) ? key : undefined;
  };
  const roots: (string | number)[][] = [[], ['data'], ['options']];
  for (const whole of [true, false]) {
    for (const root of roots) {
      let node: unknown = root.reduce<unknown>((value, key) => (value as Record<string | number, unknown>)?.[key], chart);
      const field = [...root];
      for (const [index, key] of keys.entries()) {
        const next = step(node, key);
        if (next === CONFLICT) return undefined;
        const last = index === keys.length - 1;
        if (next === undefined && !(last && !whole && !key.bracket && node !== null && typeof node === 'object' && !Array.isArray(node))) break;
        field.push(next ?? key.key);
        node = next === undefined ? undefined : (node as Record<string | number, unknown>)[next];
        if (last) return field;
      }
    }
  }
  return undefined;
}

/**
 * A BCP 47 language tag in canonical form: "de_DE" and "de-de" read "de-DE"
 *. Null when Intl rejects the tag, which the schema reports at its path
 * instead of failing inside the first number the layout formats.
 */
export function canonicalLanguage(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag.replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

/** Numeric cells outside this range cannot produce a meaningful chart scale. */
export const MAGNITUDE_CEILING = 1e15;

export function magnitudeMessage(value: number): string {
  return `value ${value} exceeds the supported magnitude of 1e15. Rescale the unit instead, for example report €bn rather than €`;
}

export function normalizedNumber(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new NormalizeError('invalid-number', path, 'expected a finite number');
  }
  if (Math.abs(raw) > MAGNITUDE_CEILING) {
    throw new NormalizeError('invalid-number', path, magnitudeMessage(raw));
  }
  return raw;
}

/** Scenario aliases. */
export function normalizeScenario(s: string | undefined, path: string, namedBaseline?: string): Scenario | undefined {
  if (s === undefined) return undefined;
  const map: Record<string, Scenario> = {
    AC: 'AC', PY: 'PY', PL: 'PL', FC: 'FC',
    ACT: 'AC', BUD: 'PL', FCST: 'FC', LY: 'PY',
  };
  const norm = map[s.toUpperCase()];
  if (!norm) {
    throw new NormalizeError(
      'invalid-scenario', path,
      `unknown scenario '${s}'`, `one of AC, PY, PL, FC (aliases ACT, BUD, FCST, LY)${namedBaseline ? `; a baseline with its own name, such as a month, goes in ${namedBaseline}` : ''}`,
    );
  }
  return norm;
}

/** Category shorthands. */
export function normalizeCategory(raw: string | Category, index: number): Category {
  if (typeof raw === 'string') return { id: raw, label: raw };
  if (!raw || typeof raw !== 'object' || !raw.id) {
    throw new NormalizeError('missing-id', `categories[${index}]`, 'category requires an id');
  }
  return { ...raw, label: raw.label ?? raw.id };
}

/** Bare number ⇒ NumberCell; null passes through. */
export function normalizeCell(raw: unknown, path: string): Cell {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return { number: normalizedNumber(raw, path) };
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const keys = ['number', 'pct', 'date'].filter((k) => k in o);
    if (keys.length !== 1) {
      throw new NormalizeError(
        'invalid-cell', path,
        `cell must have exactly one of number/pct/date, found: ${keys.join(', ') || 'none'}`,
        'percentage' in o ? 'pct' : undefined,
      );
    }
    const numericKey = keys[0] === 'number' || keys[0] === 'pct' ? keys[0] : undefined;
    if (numericKey) normalizedNumber(o[numericKey], `${path}.${numericKey}`);
    return raw as Cell;
  }
  throw new NormalizeError('invalid-cell', path, `expected number, null, or cell object`);
}

/** Point-keyed values ⇒ positional. */
export function normalizeSeriesValues(
  series: Series & { values: unknown },
  categories: Category[],
  seriesIndex: number,
): Cell[] {
  const raw = series.values as unknown[];
  const path = `series[${series.id ?? seriesIndex}].values`;
  if (!Array.isArray(raw)) {
    throw new NormalizeError(
      'invalid-values', path, 'values must be an array',
      'Send values as a JSON array, one entry per category.',
      undefined, ['data', 'series', seriesIndex, 'values'],
    );
  }
  const pointKeyed = raw.every(
    (v) => typeof v === 'object' && v !== null && 'categoryId' in (v as object),
  );
  if (pointKeyed && raw.length > 0) {
    const byCat = new Map<Id, unknown>();
    for (const entry of raw as { categoryId: Id; value: unknown }[]) {
      byCat.set(entry.categoryId, entry.value);
    }
    return categories.map((c, i) => normalizeCell(byCat.get(c.id), `${path}[${i}]`));
  }
  if (raw.length !== categories.length) {
    throw new NormalizeError(
      'length-mismatch', path,
      `${raw.length} values for ${categories.length} categories`,
      `Send ${categories.length} values, one per category, or drop the extra categories.`,
      undefined, ['data', 'series', seriesIndex, 'values'],
    );
  }
  // Array.from visits a hole of a sparse array as undefined, which reads as a missing value; map would keep the hole.
  return Array.from(raw, (v, i) => normalizeCell(v, `${path}[${i}]`));
}

/** Convert an authored frame to layout pixels. */
export function resolveSize(size: BaseOptions['size'], target: RenderTarget = DEFAULT_TARGET): Size {
  // Grid probes can have no remaining room. Keep those finite pixel frames so
  // the child can measure its requirement; the registered public boundary
  // validates authored dimensions before layout.
  if (typeof size === 'object' && size.unit === undefined
    && Number.isFinite(size.width) && (size.height === undefined || Number.isFinite(size.height))) {
    return { width: size.width, height: size.height ?? Math.round(size.width * 9 / 16) };
  }
  return resolveTargetSize(target, size).sizePx;
}

/** Apply outer margins before layouts reserve space for their own labels. */
export function resolveCanvasOptions<O extends Pick<BaseOptions, 'canvas' | 'margin'>>(options: O): O {
  const override = options.canvas?.margin;
  if (override === undefined) return options;
  const resolved = { ...options, margin: { ...options.margin } };
  delete resolved.canvas;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (override[side] !== undefined) resolved.margin[side] = override[side];
  }
  return resolved;
}

/** Hiding the frame title does not remove the chart's accessible name. */
export function accessibleTitle(title: string | false | undefined, fallback: string): string {
  return typeof title === 'string' ? plainText(title) : fallback;
}

/** Subtitle string shorthand. */
export function resolveSubtitle(subtitle: BaseOptions['subtitle']): Subtitle | undefined {
  if (subtitle === undefined) return undefined;
  return typeof subtitle === 'string' ? { measure: subtitle } : subtitle;
}

/**
 * The subtitle's scenarios as one segment: "AC vs PL", one scenario alone.
 * Any string joins verbatim: subtitleSchema accepts
 * z.array(z.string()), so the declared domain is open (see Subtitle.scenarios).
 */
export function formatScenarios(scenarios: readonly string[]): string {
  return scenarios.join(' vs ');
}

/** Highlight singleton. */
export function resolveHighlight(h: BaseOptions['highlight']): Id[] {
  if (h === undefined) return [];
  return Array.isArray(h) ? h : [h];
}

/** A copy with a repeat's placeholder filled in, in every string. Object keys and array order stay. */
export function substitute(value: unknown, placeholder: string, replacement: string): unknown {
  if (typeof value === 'string') return value.split(placeholder).join(replacement);
  if (Array.isArray(value)) return value.map((item) => substitute(item, placeholder, replacement));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, placeholder, replacement)]));
  }
  return value;
}
