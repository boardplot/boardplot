import { ladderHeights, onLadderStep } from '../core/aspect';
import { resolveSize } from '../core/normalize/shared';
import { renderTargetSchema } from '../core/schema/shared';
import { DEFAULT_TARGET, toLayoutPx } from '../core/target';
import type { CanvasSizeInput, LengthUnit, RenderTarget } from '../core/types/options';
import type { Size } from '../core/geometry';
import type { DocChart } from '../core/doc/document';
import type { DocumentFinding } from '../core/doc/diagnostics';
import { readJsonPointer, type JsonPatchOperation } from '../core/diagnostics/jsonPatch';
import { InputError } from './result';

/** A pixel argument: a positive finite number. */
export function pixels(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
    throw new InputError('invalid-argument', `${name} must be a positive number of pixels`, {
      path: `/${name}`, expected: { types: ['number'], minimum: 0, inclusive: false }, suggest: `Pass ${name} as a number such as 960.`,
    });
  }
  return number;
}

export const TARGETS = renderTargetSchema.options;

/** The target argument. It beats the spec's options.target; absent, the spec decides (default report). */
export function targetArgument(value: unknown): RenderTarget | undefined {
  if (value === undefined) return undefined;
  if (!(TARGETS as readonly unknown[]).includes(value)) {
    throw new InputError('invalid-argument', `target must be one of ${TARGETS.join(', ')}`, {
      path: '/target', expected: { values: [...TARGETS] }, received: { type: typeof value, value }, suggest: 'Pass target report (the default), dashboard, slide or print.',
      fix: [{ op: 'replace', path: '/target', value: DEFAULT_TARGET }],
    });
  }
  return value as RenderTarget;
}

/** A width or height argument in its own unit. */
export interface Length { value: number; unit: LengthUnit }

/** A number is px; a string may end in px, pt or mm (660pt, 180mm), and a bare one is px. */
export function length(name: 'width' | 'height', value: unknown): Length | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value.trim() : undefined;
  const unit = (text === undefined ? undefined : /(px|pt|mm)$/.exec(text)?.[1]) as LengthUnit | undefined;
  const number = text === undefined ? value : Number(unit ? text.slice(0, -2) : text);
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
    throw new InputError('invalid-argument', `${name} must be a positive length: a number of px, or one ending in px, pt or mm`, {
      path: `/${name}`, expected: { types: ['number'], minimum: 0, inclusive: false }, received: { type: typeof value, value },
      suggest: `Pass ${name} as px such as 960, or with a unit such as 660pt or 180mm.`,
    });
  }
  return { value: number, unit: unit ?? 'px' };
}

const px = (length: Length): number => toLayoutPx(length.value, length.unit);

/** A size in one unit; px stays unmarked, as specs write it. */
function sizeIn(unit: LengthUnit, width: number, height?: number) {
  return { width, ...(height === undefined ? {} : { height }), ...(unit === 'px' ? {} : { unit }) };
}

/**
 * Layout px in a unit, to 0.01, rounded up for a side the fix raises and down
 * for one it lowers, so the rounded frame still satisfies the fix.
 */
function inUnit(valuePx: number, unit: LengthUnit, up: boolean): number {
  const exact = valuePx / toLayoutPx(1, unit) * 100;
  return (up ? Math.ceil(exact - 1e-6) : Math.floor(exact + 1e-6)) / 100;
}

/**
 * Apply a width or height override to one chart, keeping the other side of
 * its authored or target default size. A width alone over a size preset
 * keeps the preset's shape instead. The size it writes uses one unit: the
 * arguments' unit when every side shares it, else layout px for both sides,
 * so no px value lands in a size marked pt. An invalid authored size is left
 * for the schema to report at its own path.
 */
export function withSize(chart: DocChart, width: Length | undefined, height: Length | undefined, target: RenderTarget = DEFAULT_TARGET): DocChart {
  if (!width && !height) return chart;
  const sized = (size: object): DocChart => ({ ...chart, options: { ...(chart.options ?? {}), size } });
  const authored = chart.options?.size as CanvasSizeInput | undefined;
  const object = typeof authored === 'object' && authored !== null ? authored : undefined;
  // An omitted height belongs to the shared sizing policy, for every type.
  if (width && !height && (authored === undefined || (object !== undefined && object.height === undefined))) return sized(sizeIn(width.unit, width.value));
  let base: Size;
  try {
    base = resolveSize(authored, target);
  } catch {
    return chart;
  }
  // A size preset is a shape: a width alone keeps its ladder step at the new width (its
  // ratio when it sits on no step), so the height does not stay at the preset's px.
  if (width && !height && typeof authored === 'string') return sized({ width: px(width), height: presetHeight(base, px(width)) });
  const unit = (width ?? height)!.unit;
  const kept = !width ? object?.width : !height ? object?.height : undefined;
  const oneUnit = (!width || width.unit === unit) && (!height || height.unit === unit)
    && (width && height ? true : typeof kept === 'number' && (object?.unit ?? 'px') === unit);
  if (oneUnit) return sized(sizeIn(unit, width?.value ?? kept!, height?.value ?? kept));
  return sized({ width: width ? px(width) : base.width, height: height ? px(height) : base.height });
}

/** The height of a size preset's shape at another width: its ladder step there, else its ratio. */
function presetHeight(preset: Size, width: number): number {
  const step = onLadderStep(preset);
  return step ? ladderHeights(width).find((entry) => entry.name === step)!.height : Math.round(width * preset.height / preset.width);
}

type SizeFinding = DocumentFinding & { fix?: JsonPatchOperation[] };
const SIZE_FIXES = ['size-below-floor', 'height-off-ladder', 'plot-under-min', 'aspect-cap'];

/**
 * A size refusal caused by a `width` or `height` argument names that argument,
 * not `/options/size`: patching the spec would not help while the argument
 * still wins. The fix replaces the argument with what the chart needs, in the
 * argument's unit.
 */
export function attributeSizeOverride<T extends SizeFinding>(findings: T[], width: Length | undefined, height: Length | undefined, spec: unknown, target?: RenderTarget): T[] {
  if (!width && !height) return findings;
  const args = { width, height };
  return findings.map((finding) => {
    if (!SIZE_FIXES.includes(finding.code) || !finding.path?.endsWith('/options/size')) return finding;
    const operation = finding.fix?.find(operation => operation.op === 'replace' || operation.op === 'add');
    if (!operation || !('value' in operation)) return finding;
    const needed = (operation.path.endsWith('/options')
      ? (operation.value as { size: Size }).size : operation.value) as Size;
    const short = (['width', 'height'] as const)
      .filter((side) => args[side] && needed?.[side] !== undefined && Math.abs(needed[side] - px(args[side]!)) > 1e-6);
    if (!short.length) return finding;
    const side = short[0]!;
    const original = readJsonPointer(spec, finding.path);
    const authored = original.found ? original.value : undefined;
    // The default frame of an unsized chart is its target's: the argument, else the chart's own.
    const own = readJsonPointer(spec, finding.path.replace(/size$/, 'target'));
    const actual = resolveSize(authored as CanvasSizeInput | undefined, target ?? (own.found ? own.value as RenderTarget : DEFAULT_TARGET));
    // Repair an unpassed side only if its authored/default value is short.
    // An omitted height is automatic and grows after repairing the width.
    // A preset's height follows the width argument, so it is checked at the width the fix asks for.
    const kept = { ...actual, ...(typeof authored === 'string' && args.width && !args.height ? { height: presetHeight(actual, needed.width) } : {}) };
    if (finding.code === 'size-below-floor') for (const name of ['width', 'height'] as const) {
      const automatic = name === 'height' && (authored === undefined || (typeof authored === 'object' && authored !== null && !('height' in authored)));
      if (!args[name] && !automatic && needed[name] > kept[name]) short.push(name);
    }
    const value = (name: 'width' | 'height') => {
      const arg = args[name];
      if (!arg || arg.unit === 'px') return needed[name];
      return `${inUnit(needed[name], arg.unit, needed[name] > px(arg))}${arg.unit}`;
    };
    const received = args[side]!;
    return {
      ...finding,
      path: `/${side}`,
      displayPath: side,
      received: received.unit === 'px' ? { type: 'number', value: received.value } : { type: 'string', value: `${received.value}${received.unit}` },
      suggest: `Pass ${short.map((name) => `${name} ${value(name)}`).join(' and ')}.`,
      fix: short.map((name) => ({ op: args[name] ? 'replace' as const : 'add' as const, path: `/${name}`, value: value(name) })),
    };
  });
}

/**
 * Layout writes size fixes as a whole px object. For a size authored in pt
 * or mm the fix states the same frame in that unit: an unchanged side keeps
 * its authored number, and a changed side rounds to 0.01 toward the fix.
 */
export function keepSizeUnit<T extends SizeFinding>(findings: T[], spec: unknown): T[] {
  return findings.map((finding) => {
    if (!finding.fix?.some((operation) => operation.op === 'replace' && operation.path.endsWith('/options/size'))) return finding;
    const fix = finding.fix.map((operation) => {
      if (operation.op !== 'replace' || !operation.path.endsWith('/options/size')) return operation;
      const needed = operation.value as Partial<Size>;
      const found = readJsonPointer(spec, operation.path);
      const authored = (found.found ? found.value : undefined) as { width?: unknown; height?: unknown; unit?: unknown } | undefined;
      const unit = typeof authored === 'object' && authored !== null ? authored.unit : undefined;
      if ((unit !== 'pt' && unit !== 'mm') || typeof needed?.width !== 'number' || typeof needed.height !== 'number') return operation;
      const side = (name: 'width' | 'height') => {
        const was = authored![name];
        const wasPx = typeof was === 'number' ? toLayoutPx(was, unit) : undefined;
        if (wasPx !== undefined && Math.abs(wasPx - needed[name]!) <= 1e-6) return was as number;
        return inUnit(needed[name]!, unit, wasPx === undefined || needed[name]! > wasPx);
      };
      return { ...operation, value: { width: side('width'), height: side('height'), unit } };
    });
    return { ...finding, fix };
  });
}
