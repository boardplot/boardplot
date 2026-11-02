import type { TextMeasurer } from './text';

export const BOLD_OPEN = '\uE000';
export const BOLD_CLOSE = '\uE001';
const PAIR = /(?<![\p{L}\p{N}])\*\*(?![\s*])([^\n]*?)(?<![\s*])\*\*(?![\p{L}\p{N}])/gu;
const MARKER = /[\uE000\uE001]/;
type Run = { text: string; weight?: number };

export function hasBold(text: string): boolean {
  return text.includes('**') && text.search(PAIR) >= 0;
}

/** Each bold word keeps its own markers when wrapping moves it to another line. */
export function markBold(text: string): string {
  return text.includes('**') ? text.replace(PAIR, (_, span: string) =>
    span.replace(/\S+/g, word => `${BOLD_OPEN}${word}${BOLD_CLOSE}`)) : text;
}

/** Plain text for drawing, comparisons and accessible names, never for stored authored text. */
export function plainText(text: string): string {
  if (MARKER.test(text)) return text.replace(/[\uE000\uE001]/g, '');
  return text.includes('**') ? text.replace(PAIR, '$1') : text;
}

/** A cut through a marked word can start before its close or end after its open. */
export function boldRuns(marked: string, boldWeight: number, baseWeight: number): Run[] {
  const runs: Run[] = [];
  let bold = marked.indexOf(BOLD_CLOSE) >= 0 && (marked.indexOf(BOLD_OPEN) < 0 || marked.indexOf(BOLD_CLOSE) < marked.indexOf(BOLD_OPEN));
  for (const part of marked.split(/([\uE000\uE001])/)) {
    if (part === BOLD_OPEN) bold = true;
    else if (part === BOLD_CLOSE) bold = false;
    else if (part) {
      const weight = bold && boldWeight !== baseWeight ? boldWeight : undefined;
      const last = runs[runs.length - 1];
      if (last && last.weight === weight) last.text += part;
      else runs.push({ text: part, ...(weight === undefined ? {} : { weight }) });
    }
  }
  return runs.length ? runs : [{ text: '' }];
}

/** Only callers with an actual pair install this wrapper. */
export function boldMeasurer(measure: TextMeasurer, boldWeight: number): TextMeasurer {
  const wrapped: TextMeasurer = (text, font) => {
    if (!MARKER.test(text)) return measure(text, font);
    const runs = boldRuns(text, boldWeight, font.weight);
    const sizes = runs.map(run => measure(run.text, run.weight === undefined ? font : { ...font, weight: run.weight }));
    return {
      width: sizes.reduce((sum, size) => sum + size.width, 0) + (font.letterSpacing ?? 0) * (runs.length - 1),
      height: Math.max(...sizes.map(size => size.height)),
      ascent: Math.max(...sizes.map(size => size.ascent)),
    };
  };
  wrapped.capHeight = measure.capHeight;
  return wrapped;
}

export function splitBoldLines(lines: string[], boldWeight: number, baseWeight: number): { lines: string[]; lineRuns?: Run[][] } {
  if (!lines.some(line => MARKER.test(line))) return { lines };
  const lineRuns = lines.map(line => boldRuns(line, boldWeight, baseWeight));
  return {
    lines: lineRuns.map(runs => runs.map(run => run.text).join('')),
    ...(lineRuns.some(runs => runs.some(run => run.weight !== undefined)) ? { lineRuns } : {}),
  };
}
