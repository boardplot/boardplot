/** Likert comparisons use response shares, independently of their drawing direction. */
import { marginBracketLayout } from '../../annotateLinks';
import { unionRect } from '../../geometry';
import type { BarAnnotationPass } from '../bar/layout';
import type { LikertData, LikertDerived } from './layout';

/** Gap between the plot's right edge and the brackets. */
export const BRACKET_CLEAR = 8;

/** The last layout's brackets: `need().right` is how far they reached right of their start. */
export interface BracketHolder { need?: () => { right: number } }

/**
 * A CAGR or difference sits as a bracket in the room right of
 * the plot, from the middle of one row to the other, and names the response
 * option and the period it measures. `holder` gets the brackets, so the
 * likert can read how far they went, reserve that room and lay out again.
 */
export function likertAnnotationPass(
  data: LikertData, shares: LikertDerived['shares'], net: LikertDerived['net'], format = '0%', holder?: BracketHolder,
): BarAnnotationPass {
  return (input, marks) => {
    const brackets = marginBracketLayout(input.theme, { right: input.plot.x + input.plot.w + BRACKET_CLEAR }, { wrapLead: true });
    if (holder) holder.need = brackets.need;
    return { ...input, format, differenceFormat: format.replace(/%/g, 'pp'),
      comparisonLayout: brackets,
      resolve(ref) {
        const norm = typeof ref === 'string' ? { categoryId: ref } : ref;
        if (!('categoryId' in norm)) return null;
        const item = data.items.find(i => i.id === norm.categoryId);
        if (!item) return null;
        const bars = marks.rows.find(r => r.id === item.id)?.bars ?? [];
        const rowRect = bars.length ? bars.map(b => b.rect).reduce((a, b) => unionRect(a, b)) : undefined;
        const period = { date: item.date, label: item.label ?? item.id, ...(rowRect ? { row: { y: rowRect.y, h: rowRect.h } } : {}) };
        if (!norm.seriesId) {
          const anchor = input.resolve(ref);
          return anchor ? { ...anchor, ...period, value: norm.edge === 'start' ? 0 : net[item.id]! } : null;
        }
        const option = data.scale.find(s => [s.id, `likert:${s.id}`, `likert:${s.id}:neg`, `likert:${s.id}:pos`].includes(norm.seriesId!));
        if (!option) return null;
        const anchor = input.resolve(ref)
          ?? input.resolve({ ...norm, seriesId: `likert:${option.id}` })
          ?? input.resolve({ ...norm, seriesId: `likert:${option.id}:pos` })
          ?? input.resolve({ ...norm, seriesId: `likert:${option.id}:neg` });
        if (!anchor || !bars.some(b => [`likert:${option.id}`, `likert:${option.id}:neg`, `likert:${option.id}:pos`].includes(b.seriesId))) return null;
        return { ...anchor, ...period, value: shares[item.id]![option.id]!,
          series: { id: option.id, label: option.label ?? option.id },
          owner: { categoryId: item.id, seriesId: option.id } };
      },
    };
  };
}
