/**
 * a grid under legend 'none', and a grid with no legend set where a panel draws
 * two or more series, keys only the series no panel names. A titled single-series panel, and a line or combo
 * panel whose end labels or own key row name every series, are keyed already.
 * The grid's key row lists the rest, and the grid draws none when every panel
 * is keyed. The code lives in the grid core (ChartCore.requiredKey), outside
 * the shared legend policy, so the other React entries do not carry it.
 */

import type { FrameInput, LegendItemInput } from '../frame';
import { keysNeedNames, legendIsCovered, normalizedName } from '../legendPolicy';
import { NormalizeError, resolveSize } from '../normalize/shared';
import { getChart } from '../registry';
import { collectSeriesIdentities, identityAppearance, needsSeriesKey } from '../seriesIdentity';
import { prepareFitLayout, type FitLayout } from '../sizing';
import { authoredStrings } from '../strings';
import { panelTypeClass, resolveTheme, typeWidthClass } from '../theme';
import type { TextMeasurer } from '../text';
import type { ChartCore, ChartOptions } from '../registry';
import type { GridOptions, LegendOptions } from '../types/options';
import type { Geometry, LayoutResult, LintWarning } from '../types/scene';

/** Internal grid option: the series ids the grid's key row lists. Authored JSON cannot set it. */
const GRID_KEY_ONLY = Symbol('gridKeyOnly');

/** Whether a grid keeps each line panel's own end names: under legend 'none', or a key row that keys only some series. */
export function gridPanelsKeepEndNames(options: { legend?: unknown }): boolean {
  return options.legend === 'none' || (options as { [GRID_KEY_ONLY]?: unknown })[GRID_KEY_ONLY] !== undefined;
}

/** The grid key's items, kept to the ids GRID_KEY_ONLY names when it is set. */
function gridKeyItems<T extends { id: string }>(items: T[], options: object): T[] {
  const only = (options as { [GRID_KEY_ONLY]?: ReadonlySet<string> })[GRID_KEY_ONLY];
  return only ? items.filter((item) => only.has(item.id)) : items;
}

/** A panel draws its hatches at its own hatchStrength, else at the grid's. */
export function hatchStrengthFor(panel: Record<string, unknown>, grid: { hatchStrength?: number }): { hatchStrength?: number } {
  const strength = (panel.hatchStrength as number | undefined) ?? grid.hatchStrength;
  return strength === undefined ? {} : { hatchStrength: strength };
}

type LegendPanel = { type: string; title?: string; data: unknown; options?: object; annotations?: unknown[] };
type LegendGridOptions = Omit<GridOptions, 'columns'>;

/** Each chart panel's own legend items, once per name and look, for the grid key and legend panels. */
export function collectGridLegendItems(panels: LegendPanel[], options: LegendGridOptions, measure: TextMeasurer): { items: LegendItemInput[]; redundant: boolean } {
  const items: LegendItemInput[] = [];
  const seen = new Map<string, number>();
  let titlesCoverItems = true;
  const appearances = new Set<string>();
  const theme = resolveTheme(options.theme);
  const typeClass = panelTypeClass(options) ?? typeWidthClass(resolveSize(options.size).width);
  for (const panel of panels) {
    if (panel.type === 'text' || panel.type === 'legend') continue;
    const definition = getChart(panel.type);
    if (!definition) continue;
    const panelOptions = (panel.options ?? {}) as Record<string, unknown>;
    const identities = collectSeriesIdentities(definition.layout, panel.data, {
      ...definition.defaults, ...panelOptions,
      ...(panel.annotations ? { annotations: panel.annotations } : {}),
      ...(options.palette !== undefined && panelOptions.palette === undefined ? { palette: options.palette } : {}),
      target: options.target, theme: panelOptions.theme ?? options.theme, locale: panelOptions.locale ?? options.locale,
      ...hatchStrengthFor(panelOptions, options),
      ...(options.strings ? { strings: { ...authoredStrings(options), ...(panelOptions.strings as object) } } : {}),
      size: options.size, measure, typeClass,
    });
    const title = options.sharedAxis === 'category' && panels.length > 1 && panelOptions.title === false
      ? undefined : panel.title ?? panelOptions.title;
    if (identities.length > 0) {
      titlesCoverItems &&= identities.length === 1 && typeof title === 'string' &&
        normalizedName(title) === normalizedName(identities[0]!.label) && identities[0]!.value === undefined;
    }
    for (const item of identities) {
      appearances.add(identityAppearance(item, theme));
      // A tier key names the better/worse rule once across bars and pins.
      // A series keeps one entry when its panels differ only in markers (a dense
      // panel drops them): the dot shows only when every panel draws the same ones.
      const { marker, ...look } = item;
      const key = panel.type === 'variance' && item.id.startsWith('tone:')
        ? JSON.stringify([item.label, item.id])
        : JSON.stringify([item.label, identityAppearance(look, theme)]);
      const at = seen.get(key);
      if (at === undefined) {
        seen.set(key, items.length);
        items.push(item);
      } else if (JSON.stringify(items[at]!.marker) !== JSON.stringify(marker)) {
        const { marker: _dropped, ...plain } = items[at]!;
        items[at] = plain;
      }
    }
  }
  return { items, redundant: titlesCoverItems && appearances.size === 1 };
}

/** The ordered grid key row, unless identical swatches only repeat panel titles. */
export function gridLegendInput(collected: ReturnType<typeof collectGridLegendItems>, legendOptions: LegendOptions, options: object, warnings: LintWarning[]): FrameInput['legend'] {
  let keyed = gridKeyItems(collected.items, options);
  if (keyed.length === 0) {
    warnings.push({ code: 'grid-legend-empty', severity: 'warn', message: 'grid legend requested but no chart panel contributes legend items — legend omitted' });
    return undefined;
  }
  if (collected.redundant) {
    warnings.push({ code: 'grid-legend-redundant', severity: 'warn', field: ['options', 'legend'],
      message: 'Grid legend omitted because identical swatches repeat every panel title',
      suggest: 'Remove options.legend to use the panel titles.',
      fix: [{ op: 'remove', path: '/options/legend' }],
    });
    return undefined;
  }
  if (legendOptions.order) {
    const rank = new Map(legendOptions.order.map((id, index) => [id, index]));
    keyed = [...keyed].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }
  return { options: legendOptions, items: keyed };
}

/** A grid legend panel already names the keys the grid legend would. */
function hasLegendPanel(data: unknown): boolean {
  const panels = (data as { panels?: { type?: unknown }[] } | undefined)?.panels;
  return Array.isArray(panels) && panels.some((panel) => panel?.type === 'legend');
}

/** Whether a chart panel draws two or more series that only a key can name. */
function panelNeedsKey(data: unknown): boolean {
  const panels = (data as { panels?: { type?: string; data?: unknown; options?: object }[] } | undefined)?.panels;
  return Array.isArray(panels) && panels.some((panel) => typeof panel.type === 'string' && needsSeriesKey(getChart(panel.type)?.type ?? panel.type, panel.data, panel.options));
}

/** The key row text of one candidate key item, as the reader reads it. */
function keyName(candidate: Geometry<object, object>, labelId: string): string {
  const label = candidate.scene.find((node) => node.id === labelId);
  return label?.t === 'text' ? normalizedName(label.lines.join(' ')) : '';
}

/**
 * The grid layout under legend 'none'. The grid tries the key row the theme
 * requires. Each key item that no drawn label names, and no panel's own key
 * row names, stays in it. With none left the 'none' layout stands; with some
 * left the grid is laid out once more with a key row of those series only.
 */
export function gridRequiredKey<D, O extends ChartOptions, M extends object, DV extends object>(
  this: ChartCore<D, O, M, DV>, baseline: Geometry<M, DV>, data: D, options: O, fitKeyed: FitLayout<O, M, DV>,
): LayoutResult<M, DV> {
  // With no legend set, the title of a single-series panel names it, also in other words.
  const hidden = options.legend === 'none';
  if (hasLegendPanel(data) || (!hidden && !panelNeedsKey(this.prepare?.(data) ?? data))) return baseline;
  const candidateOptions = { ...options, legend: resolveTheme(options.theme).legend?.required ?? 'top' } as O;
  // A grid whose panels do not fit beside the key throws; it then keeps
  // the layout it has, without the key.
  let tried: LayoutResult<M, DV>;
  try {
    tried = fitKeyed(candidateOptions);
  } catch (error) {
    if (!(error instanceof NormalizeError)) throw error;
    return baseline;
  }
  if (tried.refused) return baseline;
  const candidate = tried;
  if (!keysNeedNames(baseline, candidate) || legendIsCovered(baseline, candidate, data, options)) return baseline;
  const items = candidate.legend?.items ?? [];
  const uncovered = items.filter((item) => {
    if (legendIsCovered(baseline, { ...candidate, legend: { ...candidate.legend!, items: [item] } }, data, options)) return false;
    // A line panel whose end names moved into its own key row names its series there.
    // Its label adds the latest value ("Web 32%"), so the name is matched as whole words.
    const name = keyName(candidate, item.labelId);
    const fullName = new RegExp(`(?<![\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u');
    return !name || !baseline.scene.some((node) => node.t === 'text' && node.part === 'legendLabel' && node.id.includes('/') &&
      node.owner.seriesId === item.id && fullName.test(normalizedName(node.lines.join(' '))));
  });
  if (uncovered.length === 0) return baseline;
  let keyed: Geometry<M, DV> = candidate;
  if (uncovered.length < items.length) {
    const narrow = prepareFitLayout(this, data);
    try {
      const narrowed = narrow(Object.assign({} as O, candidateOptions, { [GRID_KEY_ONLY]: new Set(uncovered.map((item) => item.id)) }));
      if (!narrowed.refused && narrowed.legend?.items.length) keyed = narrowed;
    } catch (error) {
      if (!(error instanceof NormalizeError)) throw error;
    } finally {
      narrow.finish();
    }
  }
  const names = keyed === candidate ? [] : (keyed.legend?.items ?? []).map((item) => keyName(keyed, item.labelId) || item.id);
  if (hidden) keyed.warnings.push({
    code: 'grid-legend-required',
    severity: 'info',
    message: names.length > 0
      ? `grid legend cannot be hidden: no direct label names ${names.join(', ')}, so the key row lists ${names.length === 1 ? 'that series' : 'those series'} only`
      : 'grid legend cannot be hidden because no direct label names the colours and markers it keys',
  });
  return keyed;
}
