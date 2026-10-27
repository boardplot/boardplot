/** Sign colour for bar and column: one paint rule and one disclosure of the overrides. */

import { colorblindPaint, signedFillPaint } from '../../theme';
import type { Direction, Id } from '../../types/cell';
import type { LintWarning, Paint } from '../../types/scene';

/**
 * good / bad / neutral by sign × series.direction. Zero is neutral (no
 * direction to judge); null draws nothing at all. Under colorblindSafe the
 * good/bad pair comes from theme.color.colorblind — neutral has no entry
 * there and needs none, it is the same token in both modes. A bar is a
 * large fill: it takes the signed fill role, which falls back to good / bad,
 * and its legend swatch follows it.
 */
export function signPaint(s: { direction?: Direction }, v: number | null, colorblindSafe: boolean | undefined): Paint {
  if (v === null || v === 0) return { token: 'neutralMark' };
  const tone = v > 0 === (s.direction !== 'lowerIsBetter') ? 'good' : 'bad';
  return colorblindSafe ? colorblindPaint(tone, true) : signedFillPaint(tone);
}

interface SignSeries { id: Id; fill?: string; colorRole?: unknown }

/**
 * Sign colour loses to the three authored overrides (cell fill, the Others
 * bucket, a highlight); each override that wins is disclosed through
 * 'sign-color-overridden' so the agent never reports an exhibit as
 * sign-coloured while one bar silently is not.
 */
export function signColorOverrides<S extends SignSeries>(
  cats: readonly { id: Id }[],
  dataSeries: readonly S[],
  highlights: ReadonlySet<Id>,
  othersId: Id | null,
  cellOf: (s: S, ci: number) => { v: number | null; fill?: string },
  warnings: LintWarning[],
): void {
  for (const s of dataSeries) {
    cats.forEach((c, ci) => {
      const cell = cellOf(s, ci);
      if (cell.v === null) return;
      const reason = cell.fill
        ? 'an explicit cell fill'
        : othersId !== null && c.id === othersId
          ? "the aggregated 'Others' bucket"
          : highlights.has(c.id) || highlights.has(s.id)
            ? (s.fill || s.colorRole ? 'an authored series paint' : 'a highlight')
            : null;
      if (!reason) return;
      warnings.push({
        code: 'sign-color-overridden',
        severity: 'info',
        message: `category '${c.id}' is painted by ${reason}, not by sign, so the exhibit is not sign-coloured throughout`,
        owner: { categoryId: c.id, seriesId: s.id },
      });
    });
  }
}
