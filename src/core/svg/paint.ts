import { COLOR_FIX, literalColor } from '../colorLiteral';
import { paintColor } from '../theme';
import type { Paint } from '../types/scene';
import type { Theme } from '../types/theme';

/** Accept only document-literal colors that are safe inside an SVG attribute. */
export function isSafeSvgColor(value: string): boolean {
  return literalColor(value) !== null;
}

export function checkedColor(value: string): string {
  const color = literalColor(value);
  if (color === null) throw new Error(`invalid SVG color '${value.slice(0, 120)}'. ${COLOR_FIX}`);
  return color;
}

const FIXED_PAINT_TOKENS = new Set([
  'good',
  'bad',
  'warn',
  'neutral',
  'neutralLight',
  'neutralMark',
  'highlight',
  'total',
  'others',
  'ink',
  'inkInverse',
  'inkMuted',
  'axis',
  'grid',
  'leader',
  'case-1',
  'case-2',
  'background',
  'focus',
  'spark',
  'goodFill',
  'badFill',
  'warnFill',
  'inkMeta',
  'rest',
  'othersMark',
  'markInk',
  'heatTop',
  'heatTopInk',
  'rule',
  'reference',
]);

export function assertPaintToken(token: string): void {
  if (
    !FIXED_PAINT_TOKENS.has(token) &&
    !/^series-[1-9]\d*$/.test(token) &&
    !/^status-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(token)
  ) {
    throw new Error(`invalid SVG paint token '${token}'`);
  }
}

export function validateTint(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`invalid SVG paint tint '${String(value)}'`);
  }
}

export function resolvePaint(paint: Paint, theme: Theme): string {
  if ('css' in paint) return checkedColor(paint.css);
  if ('token' in paint) assertPaintToken(paint.token);
  validateTint(paint.tint);
  return checkedColor(paintColor(theme, paint));
}
