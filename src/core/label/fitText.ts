/**
 * The one truncation policy: text never truncates while free space
 * exists. Every layout that has to fit a string into a width asks here, and
 * the answer follows one order:
 *
 *   1. place      the text on one line at its own font
 *   2. wrap       to the caller's line limit (two by default)
 *   3. widen      into the extra width the layout can still hand out (a row
 *                 gutter that may grow before its label is cut)
 *   4. shrink     one type step, where the theme's floor for the role allows
 *   5. ellipsis   last, and the full text travels as the node's `<title>`
 *
 * A caller that has no extra width or no smaller step simply leaves those
 * options out; the order stays the same. Frame text (title, subtitle) never
 * shrinks, so the frame passes no step. The row-gutter helpers (the widened
 * budget, the type step, a column that steps as a whole) live in
 * ./rowFit.ts, so charts without a gutter do not carry them.
 */

import { ellipsize, wrapText, type FontSpec, type TextMeasurer } from '../text';

import { DEFAULT_TARGET, targetFloorsPx } from '../target';
import type { RenderTarget } from '../types/options';
import type { TypographyMetadata } from '../types/scene';

export interface FittedText extends TypographyMetadata {
  lines: string[];
  /** Widest drawn line. */
  w: number;
  /** Line count times the font's line box. */
  h: number;
  /** The font the lines are drawn in: the caller's, or one step down. */
  font: FontSpec;
  /** The untruncated text, present only when a line was cut. */
  title?: string;
}

export interface FitOptions extends TypographyMetadata {
  /** Pass the layout target. */
  target?: RenderTarget;
  /** The chart's `textScale`; the shrink floor scales with it. */
  textScale?: number;
  /** A wider budget the layout can still give before the text is cut (step 3). */
  wider?: number;
  /** The one-step-smaller font from `stepDownFont` (step 4); absent when the theme allows none. */
  shrink?: FontSpec;
  /** A name: its lines may also break after `_`, `-`, `/` or `.` (wrapText). */
  breakAfter?: boolean;
}

export function lineBox(font: FontSpec): number {
  return font.size * (font.lineHeight ?? 1.2);
}

function attempt(
  text: string,
  font: FontSpec,
  width: number,
  maxLines: number,
  measure: TextMeasurer,
  typeRole: TypographyMetadata['typeRole'],
  breakAfter = false,
): { fitted: FittedText; cut: boolean } {
  const wrapped = wrapText(text, font, Math.max(1, width), maxLines, measure, breakAfter);
  const lines = wrapped.lines;
  return {
    fitted: {
      ...(typeRole !== undefined ? { typeRole } : {}),
      lines,
      w: Math.max(1, ...lines.map((line) => measure(line, font).width)),
      h: lines.length * lineBox(font),
      font,
    },
    cut: wrapped.truncated,
  };
}

/** Filter an engine shrink step; an authored base font remains unchanged. */
export function shrinkFont(font: FontSpec, options: FitOptions): FontSpec | undefined {
  const step = options.shrink;
  if (!step || step.size >= font.size) return undefined;
  return step.size >= targetFloorsPx(options.target ?? DEFAULT_TARGET, options.textScale)[options.typeRole ?? 'label'] ? step : undefined;
}

/** Fit `text` into `maxWidth` and at most `maxLines` lines, in the policy order above. */
export function fitText(
  text: string,
  font: FontSpec,
  maxWidth: number,
  maxLines: number,
  measure: TextMeasurer,
  options: FitOptions = {},
): FittedText {
  const widths = options.wider !== undefined && options.wider > maxWidth ? [maxWidth, options.wider] : [maxWidth];
  // An authored line break is kept while the lines allow it; with more
  // paragraphs than lines it becomes a space before any text is cut.
  const joined = text.includes('\n') ? text.replace(/\s*\n\s*/g, ' ') : text;
  const texts = joined === text ? [text] : [text, joined];
  for (const width of widths) {
    for (const candidate of texts) {
      const tried = attempt(candidate, font, width, maxLines, measure, options.typeRole, options.breakAfter);
      if (!tried.cut) return tried.fitted;
    }
  }
  const step = shrinkFont(font, options);
  if (step) {
    for (const width of widths) {
      for (const candidate of texts) {
        const tried = attempt(candidate, step, width, maxLines, measure, options.typeRole, options.breakAfter);
        if (!tried.cut) return tried.fitted;
      }
    }
  }
  // The cut keeps the smaller step when the caller allowed one: it shows more of the text.
  const width = widths[widths.length - 1]!;
  const last = attempt(joined, step ?? font, width, maxLines, measure, options.typeRole, options.breakAfter).fitted;
  // wrapText can stop at a word boundary without an ellipsis; the cut still
  // shows. A word it cut on an earlier line already shows it.
  const end = last.lines.length - 1;
  if (end >= 0 && !last.lines.some((line) => line.endsWith('…'))) {
    const lines = [...last.lines];
    lines[end] = ellipsize(`${lines[end]!.trimEnd()}…`, last.font, width, measure).text;
    return { ...last, lines, w: Math.max(1, ...lines.map((line) => measure(line, last.font).width)), title: text };
  }
  return { ...last, title: text };
}

/**
 * an end cut whose visible start also starts another label hides
 * what tells the two apart, so rows that differ in their last words read
 * alike. Such a label is cut in the middle instead: its head, an ellipsis,
 * and its tail from the word where it parts from those labels ("Campaign ·
 * Brand · Sea…Q3 2025"). `lines` are the label's cut lines, `others` the
 * labels it stands among; the answer is the new last line, or undefined
 * where the end cut already tells it apart or the tail alone does not fit.
 * With `breakAfter` the lines may have broken after `_ - / .` (no space
 * between them), and the tail may start after one of those marks too.
 */
export function distinctCut(
  text: string,
  lines: readonly string[],
  others: readonly string[],
  font: FontSpec,
  width: number,
  measure: TextMeasurer,
  breakAfter = false,
): string | undefined {
  const glue = breakAfter && !text.startsWith(lines.join(' ').replace(/…$/, '').trimEnd()) ? '' : ' ';
  const visible = lines.join(glue).replace(/…$/, '').trimEnd();
  if (!text.startsWith(visible)) return undefined;
  const alike = others.filter((other) => other !== text && other.startsWith(visible));
  if (alike.length === 0) return undefined;
  // The tail starts where the first of those labels parts from this one, so it differs from each.
  let parts = text.length;
  for (const other of alike) {
    let common = 0;
    while (common < text.length && text[common] === other[common]) common++;
    parts = Math.min(parts, common);
  }
  const lastStart = lines.slice(0, -1).join(glue).length + (lines.length > 1 ? glue.length : 0);
  const from = Math.min(parts, text.length - 1);
  const tailStart = Math.max(text.lastIndexOf(' ', from), ...(breakAfter ? ['_', '-', '/', '.'].map((mark) => text.lastIndexOf(mark, from - 1)) : [])) + 1;
  if (tailStart <= lastStart) return undefined;
  const tail = text.slice(tailStart);
  const budget = width - measure(tail, font).width;
  if (budget < measure('…', font).width) return undefined;
  const head = ellipsize(text.slice(lastStart, tailStart).trimEnd(), font, budget, measure).text;
  return head.endsWith('…') ? `${head}${tail}` : undefined;
}

/** The same cut the policy makes last, for a caller that already knows no other step helps. */
export function cutWithTitle(
  text: string,
  font: FontSpec,
  maxWidth: number,
  measure: TextMeasurer,
): { text: string; title?: string } {
  const cut = ellipsize(text, font, maxWidth, measure);
  return cut.truncated ? { text: cut.text, title: text } : { text: cut.text };
}
