import { footnoteSuffix, type FootnoteRefs } from '../footnoteMark';
import { wrapText, type FontSpec, type TextMeasurer } from '../text';
import type { Id } from '../types/cell';
import { type FitOptions, type FittedText } from './fitText';
import { fitBand } from './rowFit';
import { maxOf } from '../arrays';

/**
 * Measure the displayed row labels and their shared column, through the one
 * truncation policy (src/core/label/fitText.ts). `options.wider` lets the
 * column grow past `maxWidth` before a label is cut; `options.shrink` steps
 * the whole column down one type size when that cuts fewer names.
 *
 * A row carrying an authored `footnote` reference draws its number beside
 * the name. The name is fitted to the band MINUS the mark and the mark
 * goes on after, so a name too long for its gutter ends "Enterprise cloud
 * infra… 1)" and the reader can still follow the reference; the `<title>`
 * carries the name the ellipsis cut.
 *
 * A row `suffix` is the end of its label that must never be cut, such as a
 * cohort size "(n = 1,200)". A label that fits keeps its fit. A cut one
 * fits only the name before the suffix and draws the suffix whole: on its
 * own last line when the row has two or more lines, else after the name on
 * its one line. A name that keeps no more than its first word there takes
 * all the lines and the suffix one more. A suffix wider than the band
 * breaks at its spaces onto two lines. `short` is how many px the band
 * lacks for a whole suffix or a name of two words; above 0 the caller
 * refuses the size.
 */
export function rowLabelBand(
  rows: readonly { label: string; footnote?: number; id?: Id; suffix?: string }[],
  font: FontSpec,
  maxWidth: number,
  maxLines: number,
  lineHeight: number,
  measure: TextMeasurer,
  options: FitOptions & { footnoteRefs?: FootnoteRefs } = {},
) {
  const marks = rows.map((row) => footnoteSuffix(row.footnote, row.id ?? row.label, options.footnoteRefs));
  const reserves = marks.map((mark) => (mark ? measure(mark, font).width : 0));
  const nameOf = (row: (typeof rows)[number]) => row.label.slice(0, row.label.length - row.suffix!.length).trimEnd();
  // 0: the whole label; 1: the name in one line less (or before the suffix on a one-line band);
  // 2: the name in all its lines, the suffix on one more line.
  const fit = (modes: readonly number[]) => fitBand(
    rows.map((row, index) => {
      if (modes[index] === 0) return { label: row.label, reserve: reserves[index] };
      // The suffix takes a line of the rows' pitch, so the name has one line less to grow into.
      const tight = options.tightLines === undefined ? {} : { tightLines: options.tightLines - 1 };
      if (modes[index] === 2) return { label: nameOf(row), reserve: reserves[index], ...tight };
      if (maxLines > 1) return { label: nameOf(row), reserve: reserves[index], maxLines: maxLines - 1, ...tight };
      const reserve = reserves[index]! + measure(` ${row.suffix}`, font).width;
      return { label: nameOf(row), reserve, ...(options.wider === undefined ? {} : { wider: options.wider - reserve }) };
    }),
    font, maxWidth, maxLines, measure, options,
  );
  // A cut name that keeps no more than its first word ("Week…") does not tell its rows apart.
  const bare = (index: number, fitted: FittedText) => {
    if (fitted.title === undefined) return false;
    const kept = fitted.lines.join(' ').replace(/…/g, '').trim();
    return kept.length <= nameOf(rows[index]!).split(/\s+/)[0]!.length;
  };
  let modes = rows.map(() => 0);
  let band = fit(modes);
  const cutSuffix = rows.map((row, index) => row.suffix !== undefined && row.label.endsWith(row.suffix) && band.labels[index]!.title !== undefined);
  if (cutSuffix.some(Boolean)) band = fit(modes = cutSuffix.map((cut) => (cut ? 1 : 0)));
  if (band.labels.some((fitted, index) => modes[index] === 1 && bare(index, fitted))) {
    band = fit(modes = modes.map((mode, index) => (mode === 1 && bare(index, band.labels[index]!) ? 2 : mode)));
  }
  const budget = Math.max(maxWidth, options.wider ?? 0);
  let short = 0;
  const labels = band.labels.map((fitted, index) => {
    const lineH = fitted.font === font ? lineHeight : fitted.font.size * (lineHeight / font.size);
    const lines = [...fitted.lines];
    const split = modes[index] !== 0;
    if (split) {
      const row = rows[index]!;
      const suffix = row.suffix!;
      // A name still cut to its first word refuses the width its first two words need.
      if (bare(index, fitted)) short = Math.max(short, 1, measure(`${nameOf(row).split(/\s+/).slice(0, 2).join(' ')}…`, fitted.font).width - budget);
      if (measure(suffix, fitted.font).width > budget) {
        // A suffix wider than the band breaks at its spaces onto two lines of its own ("(n =" / "2,400)"); a word wider than the band refuses.
        const wrapped = wrapText(suffix, fitted.font, budget, 2, measure);
        if (wrapped.truncated) short = Math.max(short, ...suffix.split(/\s+/).map((word) => measure(word, fitted.font).width - budget), measure(suffix, fitted.font).width / 2 - budget, 1);
        lines.push(...wrapped.lines);
      } else if (maxLines > 1 || modes[index] === 2) lines.push(suffix);
      else lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''} ${suffix}`;
    }
    const mark = marks[index]!;
    if (mark) lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${mark}`;
    if (!mark && !split) return { ...fitted, h: fitted.lines.length * lineH };
    return {
      ...fitted,
      lines,
      w: split ? Math.max(1, ...lines.map((line) => measure(line, fitted.font).width)) : fitted.w + measure(mark, fitted.font).width,
      h: lines.length * lineH,
      ...(fitted.title !== undefined ? { title: rows[index]!.label } : {}),
    };
  });
  return { labels, width: labels.length ? maxOf(labels.map((label) => label.w)) : 0, short: Math.max(0, short) };
}
