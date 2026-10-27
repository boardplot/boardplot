import type { Category } from '../../types/data';
import type { BumpDerived } from './layout';
import type { FanResolved } from './fan';
import type { LinePhaseResolved } from './marks';

/** Project preset metadata using the same source indexes as the painted values. */
export function projectLineViewport(input: {
  indexes: number[]; categories: Category[]; bump?: BumpDerived; fan: FanResolved | null; phases: LinePhaseResolved | null;
}): void {
  const { indexes, categories, bump, fan, phases } = input;
  const visible = new Set(indexes.map(index => categories[index]!.id));
  if (bump) {
    for (const [id, row] of Object.entries(bump.ranks)) bump.ranks[id] = indexes.map(index => row[index]!);
    bump.ties = bump.ties.filter(tie => visible.has(tie.categoryId));
    bump.participants = Object.fromEntries(Object.entries(bump.participants).filter(([id]) => visible.has(id)));
  }
  if (fan) {
    for (const band of fan.bands) band.widths = indexes.map(index => band.widths[index]!);
    fan.undeclaredAt = fan.undeclaredAt.filter(id => visible.has(id));
  }
  if (phases) {
    const sourceIndex = new Map(categories.map((category, index) => [category.id, index]));
    phases.authored = phases.phases;
    phases.phases = phases.phases.flatMap((phase, index) => {
      const from = sourceIndex.get(phase.from)!, to = sourceIndex.get(phase.to)!;
      const kept = indexes.filter(at => at >= from && at <= to);
      return kept.length ? [{ ...phase, rank: phase.rank ?? index + 1,
        from: categories[kept[0]!]!.id, to: categories[kept[kept.length - 1]!]!.id }] : [];
    });
  }
}

/** Sampling keeps the original spacing, so omitted periods never shorten time. */
export function liveCategoryX(ci: number, count: number, between: boolean, plot: { x: number; w: number },
  window?: { positions: number[]; span: number }): number {
  const n = window?.span ?? count, at = window?.positions[ci] ?? ci;
  const step = between ? plot.w / n : n > 1 ? plot.w / (n - 1) : plot.w;
  return between ? plot.x + (at + 0.5) * step : n > 1 ? plot.x + at * step : plot.x + plot.w / 2;
}
