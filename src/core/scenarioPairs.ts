/**
 * Notation rule shared by column and bar: a scenario series is a view of an actual, so it takes
 * that actual's colour and its scenario draws the difference (PY a wash, FC a hatch, PL an
 * outline). The k-th PY, PL or FC series pairs with the k-th actual (no scenario or AC), in
 * authored order, so series order never changes the look.
 */

import { seriesPaint } from './theme';
import type { Scenario } from './types/cell';
import type { Paint } from './types/scene';

/** A series' scenario: its own, or the one scenario that all its plotted cells carry. */
export function seriesScenarioRole(own: Scenario | undefined, plotted: readonly (Scenario | undefined)[]): Scenario | undefined {
  if (own) return own;
  return plotted.length > 0 && plotted.every((sc) => sc === plotted[0]) ? plotted[0] : undefined;
}

/**
 * The actual each scenario series takes its colour from, by series id. A stack keeps its stack
 * colours: there only a plan pairs. A prior year draws its actual's colour as a wash, which needs
 * the theme's series colour, so beside an actual in an authored colour or role it keeps a washed
 * step of its own.
 */
export function scenarioPartners<S extends { id: string }>(
  series: readonly S[],
  roleOf: (s: S) => Scenario | undefined,
  ownPaint: (s: S) => boolean,
  stacked: boolean,
): Map<string, S> {
  const actuals = series.filter((x) => { const role = roleOf(x); return role === undefined || role === 'AC'; });
  const partners = new Map<string, S>();
  for (const sc of stacked ? (['PL'] as const) : (['PY', 'PL', 'FC'] as const)) {
    series.filter((x) => roleOf(x) === sc).forEach((x, k) => {
      const actual = actuals[k];
      if (actual && (sc !== 'PY' || !ownPaint(actual))) partners.set(x.id, actual);
    });
  }
  return partners;
}

/**
 * The theme colour of a grouped series in its scenario. A prior year draws the wash, apart from
 * the actual it shares the colour with. A forecast keeps its key colour where its hatch reads on
 * the page; scenarioSeriesColor lifts only a colour whose hatch would fade into the page (an
 * actual near a dark page's floor).
 */
export function scenarioSlotPaint(slot: number, palette: string | undefined, scenario: Scenario | undefined): Paint {
  return scenario === 'PY' || scenario === 'FC' ? seriesPaint(slot, palette, scenario, true, false, true) : seriesPaint(slot, palette);
}
