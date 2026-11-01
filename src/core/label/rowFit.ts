/**
 * Row-gutter side of the truncation policy (./fitText.ts): how far a
 * label column may widen, the one type step down the theme allows, and a
 * column that takes that step as a whole.
 */

import type { FontSpec, TextMeasurer } from '../text';
import { microType } from '../theme';
import { DEFAULT_TARGET, targetFloorsPx } from '../target';
import type { RenderTarget } from '../types/options';
import type { TypographyMetadata } from '../types/scene';
import type { Theme, TypeRoleName } from '../types/theme';
import { distinctCut, fitText, shrinkFont, type FitOptions, type FittedText } from './fitText';
import { maxOf } from '../arrays';

/**
 * A row-label gutter keeps its default share of the plot width while every
 * label fits wrapped. A label that would be cut there may widen the gutter
 * up to this share first: the plot keeps more than half the
 * width, and the label keeps its name.
 */
export const GUTTER_MAX_SHARE = 0.45;

/**
 * The widened budget of a row-label gutter: up to GUTTER_MAX_SHARE of the
 * plot, and never so wide that what stays for the marks drops under
 * `keep` px (a matrix needs its natural cell columns). Never below `cap`.
 */
export function gutterBudget(cap: number, plotW: number, keep = 0): number {
  return Math.max(cap, Math.min(plotW * GUTTER_MAX_SHARE, plotW - keep));
}

const ROLE_ORDER: readonly Exclude<TypeRoleName, 'secondary'>[] = ['title', 'subtitle', 'label', 'axis', 'footnote', 'micro'];

/**
 * The next smaller step of the theme's type scale below `font`, starting at
 * `role` (a card label drawn above its role size steps to the role size
 * first), carried onto `font`: family, weight and line height stay. The
 * theme allows the step when that size is still at or above the role's own
 * target floor: a report M axis can step from 14 to 13 px. Pass the
 * resolved theme and options.target.
 */
export function stepDownFont(theme: Theme, font: FontSpec, role: TypeRoleName, target: RenderTarget = DEFAULT_TARGET, textScale = 1): FontSpec | undefined {
  const floor = targetFloorsPx(target, textScale)[role];
  const start = ROLE_ORDER.indexOf(role as Exclude<TypeRoleName, 'secondary'>);
  for (const next of ROLE_ORDER.slice(start)) {
    const size = next === 'micro' ? microType(theme).size : theme.type[next].size;
    if (size >= font.size) continue;
    return size >= floor ? { ...font, size } : undefined;
  }
  return undefined;
}

interface FittedBand {
  labels: FittedText[];
  /** Width of the shared column: the widest label, which the policy kept inside its budget. */
  width: number;
}

interface ColumnEntry extends FitOptions {
  text: string;
  font: FontSpec;
  maxWidth: number;
  maxLines: number;
  wider?: number;
  /** This entry's step down; the column takes it only as a whole. */
  shrink?: FontSpec;
}

/**
 * Fit a column of labels that share one type size. The step down applies to
 * every entry or to none: the column takes it when that cuts fewer names
 * than the chart's own size (the category row does the same), so a gutter
 * never mixes 10.5 and 9 px names.
 */
export function fitColumn(entries: readonly ColumnEntry[], measure: TextMeasurer): FittedText[] {
  const fitAll = (stepped: boolean) => entries.map((entry) =>
    fitText(entry.text, stepped ? shrinkFont(entry.font, entry) ?? entry.font : entry.font, entry.maxWidth, entry.maxLines, measure, { wider: entry.wider, target: entry.target, typeRole: entry.typeRole, breakAfter: entry.breakAfter, tightLines: entry.tightLines }));
  const cuts = (labels: FittedText[]) => labels.filter((label) => label.title !== undefined).length;
  const plain = fitAll(false);
  if (cuts(plain) === 0) return plain;
  const stepped = entries.some((entry) => entry.shrink && entry.shrink.size < entry.font.size) ? fitAll(true) : plain;
  const chosen = cuts(stepped) < cuts(plain) ? stepped : plain;
  // a cut that leaves a label reading like another keeps its distinguishing tail.
  const texts = entries.map((entry) => entry.text);
  return chosen.map((fitted, index) => {
    const entry = entries[index]!;
    const last = fitted.title === undefined ? undefined
      : distinctCut(entry.text, fitted.lines, texts, fitted.font, Math.max(entry.maxWidth, entry.wider ?? 0), measure, entry.breakAfter);
    if (last === undefined) return fitted;
    const lines = [...fitted.lines.slice(0, -1), last];
    return { ...fitted, lines, w: Math.max(1, ...lines.map((line) => measure(line, fitted.font).width)) };
  });
}

/** Fit a column of row labels in one font through the policy; the column is as wide as its widest label. */
export function fitBand(
  /** `reserve` is width this row owes something drawn after its text. */
  rows: readonly { label: string; reserve?: number; maxLines?: number; wider?: number; tightLines?: number }[],
  font: FontSpec,
  maxWidth: number,
  maxLines: number,
  measure: TextMeasurer,
  options: FitOptions = {},
): FittedBand {
  const labels = fitColumn(rows.map((row) => ({ text: row.label, font, maxWidth: maxWidth - (row.reserve ?? 0), maxLines: row.maxLines ?? maxLines, ...options, ...(row.wider === undefined ? {} : { wider: row.wider }), ...(row.tightLines === undefined ? {} : { tightLines: row.tightLines }) })), measure)
    .map((fitted, index) => withoutLoneWord(rows[index]!.label, fitted, Math.max(rows[index]!.maxLines ?? maxLines, fitted.lines.length), measure));
  return { labels, width: rows.length ? maxOf(labels.map((label, index) => label.w + (rows[index]!.reserve ?? 0))) : 0 };
}

/**
 * A wrapped label whose last line is one word narrows, 2 px at a
 * time down to 60 % of its width, until a second word joins it on the same
 * number of lines: "…as a place to / work" becomes "…this company / as a
 * place to work". A cut label, or one no such width helps, stays as fitted.
 */
function withoutLoneWord(text: string, fitted: FittedText, maxLines: number, measure: TextMeasurer): FittedText {
  const last = fitted.lines[fitted.lines.length - 1];
  if (fitted.title !== undefined || fitted.lines.length < 2 || last === undefined || /\s/.test(last.trim())) return fitted;
  for (let width = fitted.w - 2; width >= fitted.w * 0.6; width -= 2) {
    const narrower = fitText(text, fitted.font, width, maxLines, measure, { typeRole: fitted.typeRole });
    if (narrower.title !== undefined || narrower.lines.length !== fitted.lines.length) return fitted;
    if (/\s/.test(narrower.lines[narrower.lines.length - 1]!.trim())) return narrower;
  }
  return fitted;
}

/**
 * Label-request fields for a fitted text: the drawn lines, the `<title>` of a
 * cut, and the stepped-down font when the policy shrank it (the solver carries
 * it to the placed label, and emission prefers it over the chart's font).
 */
export function fittedLabel(fitted: FittedText, base: FontSpec): TypographyMetadata & {
  lines: string[];
  title?: string;
  fontStep?: FontSpec;
} {
  return {
    ...(fitted.typeRole !== undefined ? { typeRole: fitted.typeRole } : {}),
    lines: fitted.lines,
    ...(fitted.title !== undefined ? { title: fitted.title } : {}),
    ...(fitted.font !== base ? { fontStep: fitted.font } : {}),
  };
}
