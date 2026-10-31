import type { MetricStackData } from './metricStack';
import { isRecord } from '../../lint/shared';
import { ownedDocumentCopy } from '../../doc/ownedDocumentCopy';
import { NormalizeError } from '../../normalize/shared';
import type { GridOptions } from '../../types/options';

export type GridTrackScope = 'row' | 'column' | 'all';
export type GridRepeatFacet = 'series' | 'category';
type GridTextTone = 'message' | 'muted';

export interface GridPanelPlacement {
  row?: number;
  column?: number;
  span?: { rows?: number; columns?: number; };
  align?: {
    horizontal?: 'stretch' | 'start' | 'center' | 'end';
    vertical?: 'stretch' | 'start' | 'center' | 'end';
    width?: number;
    height?: number;
  };
}

export interface GridTextPanelData {
  title?: string;
  body?: string;
  bullets?: string[];
  tone?: GridTextTone;
}

interface GridLegendPanelData {
  from?: string[];
}

export type GridLayoutOptions = Omit<GridOptions, 'columns'> & {
  columns?: number | number[];
  rows?: number[];
  gutters?: {
    rows?: number | number[];
    columns?: number | number[];
  };
  anchors?: {
    plotEdges?: GridTrackScope;
    baselines?: GridTrackScope;
    categories?: GridTrackScope;
  };
  alignmentRules?: {
    id: string;
    orientation: 'horizontal' | 'vertical';
    at: {
      panelId: string;
      anchor: 'plotLeft' | 'plotRight' | 'baseline' | 'category';
      categoryId?: string;
    };
    fromPanelId?: string;
    toPanelId?: string;
  }[];
};

export interface GridPanelSpec extends GridPanelPlacement {
  id: string;
  type: string;
  title?: string;
  caption?: string;
  data: unknown;
  options?: Record<string, unknown>;
  annotations?: unknown[];
}

export interface ExplicitGridData {
  panels: GridPanelSpec[];
  /**
   * Set by the repeat expansion only: a template caption without the slice
   * placeholder reads the same under every panel, so the grid prints it once
   * above the panels. Authored data cannot set it.
   */
  rowCaption?: string;
  /**
   * Set by the repeat expansion only: `repeat.facet` slices one measure, which
   * is evidence for the grid's default shared y scale. Authored data cannot set it.
   */
  repeatFacet?: true;
}

interface RepeatSliceData {
  bySlice: Record<string, unknown>;
}

interface RepeatFacetSource {
  categories: unknown[];
  series: unknown[];
}

export interface RepeatGridData {
  repeat: { dimension: string; values: string[]; facet?: GridRepeatFacet };
  template: Omit<GridPanelSpec, 'id' | 'data'> & {
    id?: string;
    data: RepeatSliceData | RepeatFacetSource;
  };
  message?: GridTextPanelData;
}

export type GridInput = ExplicitGridData | RepeatGridData | MetricStackData;

export function parseGridTextPanelData(raw: unknown): GridTextPanelData {
  if (!isRecord(raw)) {
    throw new NormalizeError('invalid-text-panel', 'data', 'text panel data must be an object');
  }
  const allowed = new Set(['title', 'body', 'bullets', 'tone']);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) {
    throw new NormalizeError('invalid-text-panel', `data.${unknown}`, `unrecognized key '${unknown}'`);
  }
  const title = raw.title;
  const body = raw.body;
  const bullets = raw.bullets;
  const tone = raw.tone;
  if (title !== undefined && (typeof title !== 'string' || title.length === 0)) {
    throw new NormalizeError('invalid-text-panel', 'data.title', 'expected a non-empty string');
  }
  if (body !== undefined && (typeof body !== 'string' || body.length === 0)) {
    throw new NormalizeError('invalid-text-panel', 'data.body', 'expected a non-empty string');
  }
  if (
    bullets !== undefined &&
    (!Array.isArray(bullets) || bullets.length === 0 || bullets.some((item) => typeof item !== 'string' || item.length === 0))
  ) {
    throw new NormalizeError('invalid-text-panel', 'data.bullets', 'expected one or more non-empty strings');
  }
  if (tone !== undefined && tone !== 'message' && tone !== 'muted') {
    throw new NormalizeError('invalid-text-panel', 'data.tone', "expected 'message' or 'muted'");
  }
  if (title === undefined && body === undefined && bullets === undefined) {
    throw new NormalizeError(
      'invalid-text-panel',
      'data',
      'text panel requires at least one of title, body, or bullets',
    );
  }
  return raw as GridTextPanelData;
}

export function parseGridLegendPanelData(raw: unknown): GridLegendPanelData {
  if (!isRecord(raw)) {
    throw new NormalizeError('invalid-legend-panel', 'data', 'legend panel data must be an object');
  }
  const unknown = Object.keys(raw).find((key) => key !== 'from');
  if (unknown) {
    throw new NormalizeError('invalid-legend-panel', `data.${unknown}`, `unrecognized key '${unknown}'`);
  }
  if (
    raw.from !== undefined &&
    (!Array.isArray(raw.from) || raw.from.length === 0 || raw.from.some((item) => typeof item !== 'string' || item.length === 0))
  ) {
    throw new NormalizeError('invalid-legend-panel', 'data.from', 'expected one or more non-empty strings');
  }
  return raw as GridLegendPanelData;
}

export function normalizeGridData(raw: unknown): ExplicitGridData {
  // Pre-parse ownership check, on the RAW document: zod's required-key
  // presence test reads `key in input`, so a branch key visible only through
  // the prototype chain would let the parse consume inherited data — with a
  // WRITABLE gadget zod even materializes it as own output, indistinguishable
  // afterwards. The exported gridDataSchema carries the same guard as a pipe
  // stage; this copy protects direct callers of normalizeGridData, which
  // parses against the BASE union below and would otherwise run unguarded.
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Object.hasOwn(raw, 'panels') &&
    !Object.hasOwn(raw, 'repeat') &&
    ('panels' in raw || 'repeat' in raw)
  ) {
    throw new NormalizeError(
      'missing-panels',
      'panels',
      "grid data must own 'panels' or 'repeat' — inherited properties do not count",
    );
  }
  // The schema-owning definition parses first. React calls this semantic step
  // on typed data, so the owned copy also protects schema-free callers from
  // inherited optional values.
  const input = ownedDocumentCopy(raw as GridInput);
  // Object.hasOwn, not `in`: see the union discriminator in index.ts.
  // hasOwn does not narrow the union for TypeScript, hence the casts — a
  // parsed object owning 'panels' can only have come from the explicit branch.
  if (Object.hasOwn(input, 'panels')) {
    const explicit = input as ExplicitGridData;
    const panels = lockWrittenOutPanels(explicit.panels);
    return panels === explicit.panels ? explicit : { ...explicit, panels };
  }
  // Owning neither key is reachable: zod's required-key presence check reads
  // `key in input`, so a non-writable prototype gadget satisfies the explicit
  // branch while zod's output drops the assignment. NormalizeError is this
  // function's refusal channel (the schema wrapper refuses the same state
  // before its own call).
  if (!Object.hasOwn(input, 'repeat')) {
    throw new NormalizeError(
      'missing-panels',
      'panels',
      "grid data must own 'panels' or 'repeat' — inherited properties do not count",
    );
  }
  const facet = input as RepeatGridData;
  const panels = expandRepeatPanels(facet);
  const caption = facet.template.caption;
  const rowCaption = typeof caption === 'string' && !caption.includes(`$${facet.repeat.dimension}`) ? caption : undefined;
  // The repeat expansion builds ordinary literals; the same owned copy keeps
  // absent panel keys (align, span) from reading a polluted prototype chain
  // in the layout.
  return ownedDocumentCopy({
    panels: lockPaletteBySeriesId(panels),
    ...(rowCaption ? { rowCaption } : {}),
    ...(facet.repeat.facet ? { repeatFacet: true as const } : {}),
  });
}

function expandRepeatPanels(facet: RepeatGridData): GridPanelSpec[] {
  const { dimension, values, facet: by } = facet.repeat;
  const placeholder = `$${dimension}`;
  const template = facet.template;
  const panels = values.map((value): GridPanelSpec => {
    const data = by
      ? substitute(sliceFacetSource(template.data, by, value), placeholder, value)
      : substitute((template.data as RepeatSliceData).bySlice[value], placeholder, value);
    const existingOptions = substitute(template.options ?? {}, placeholder, value) as Record<string, unknown>;
    const authoredGroup = isRecord(existingOptions.scaleGroup) ? existingOptions.scaleGroup : {};
    const options = by
      ? existingOptions
      : {
          ...existingOptions,
          scaleGroup: {
            ...authoredGroup,
            y: typeof authoredGroup.y === 'string' ? authoredGroup.y : `repeat:${dimension}:y`,
          },
        };
    return {
      id: substitute(template.id ?? value, placeholder, value) as string,
      type: template.type,
      // A heading reads the facet's display label (AMER), never its id (amer).
      ...(template.title ? { title: substitute(template.title, placeholder, facetLabel(template.data, by, value)) as string } : {}),
      // A caption without the placeholder is the grid's row caption (rowCaption), printed once.
      ...(template.caption && template.caption.includes(placeholder) ? { caption: substitute(template.caption, placeholder, facetLabel(template.data, by, value)) as string } : {}),
      data,
      options,
      ...(template.annotations
        ? { annotations: substitute(template.annotations, placeholder, value) as unknown[] }
        : {}),
    };
  });
  if (!Object.hasOwn(facet, 'message') || facet.message === undefined) return panels;
  const message = facet.message;
  return [
    ...panels,
    {
      id: 'message',
      type: 'text',
      data: { ...message, tone: message.tone ?? 'message' },
    },
  ];
}

function sliceFacetSource(
  raw: RepeatSliceData | RepeatFacetSource,
  by: GridRepeatFacet,
  value: string,
): RepeatFacetSource {
  if (!isRecord(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.series)) {
    throw new NormalizeError(
      'invalid-facet-source',
      'template.data',
      `repeat.facet '${by}' needs template.data.categories and template.data.series`,
    );
  }
  const source = raw as RepeatFacetSource;
  if (by === 'series') return sliceBySeries(source, value);
  return sliceByCategory(source, value);
}

function sliceBySeries(source: RepeatFacetSource, value: string): RepeatFacetSource {
  const series = source.series.filter(isRecord);
  const match = series.find((entry) => entry.id === value);
  if (!match) {
    throw new NormalizeError(
      'missing-facet-value',
      `template.data.series`,
      `missing series '${value}' for repeat.facet 'series'`,
    );
  }
  if (match.role === 'reference') {
    throw new NormalizeError(
      'invalid-facet-value',
      'repeat.values',
      `reference series '${value}' cannot be a series facet — pick a plotted series`,
    );
  }
  const references = series.filter((entry) => entry.role === 'reference' && entry.id !== value);
  return { ...source, series: [match, ...references] };
}

function sliceByCategory(source: RepeatFacetSource, value: string): RepeatFacetSource {
  const categories = source.categories;
  const index = categories.findIndex((entry) =>
    (typeof entry === 'string' ? entry : isRecord(entry) ? entry.id : undefined) === value);
  if (index < 0) {
    throw new NormalizeError(
      'missing-facet-value',
      'template.data.categories',
      `missing category '${value}' for repeat.facet 'category'`,
    );
  }
  return {
    ...source,
    categories: [categories[index]!],
    series: source.series.map((entry) => sliceSeriesAt(entry, index, value)),
  };
}

function sliceSeriesAt(entry: unknown, index: number, categoryId: string): unknown {
  if (!isRecord(entry)) return entry;
  const keyed = Array.isArray(entry.values) && entry.values.every(cell => isRecord(cell) && 'categoryId' in cell);
  const values = Array.isArray(entry.values)
    ? [(keyed ? entry.values.find(cell => cell.categoryId === categoryId) : entry.values[index]) ?? null]
    : entry.values;
  const targets = Array.isArray(entry.targets)
    ? entry.targets.filter((target) => isRecord(target) && target.at === categoryId)
    : entry.targets;
  return {
    ...entry,
    values,
    ...(targets === undefined ? {} : { targets }),
  };
}

/** The label of the series or category a facet panel shows; its id where it has none. */
function facetLabel(raw: unknown, by: GridRepeatFacet | undefined, value: string): string {
  if (!by || !isRecord(raw)) return value;
  const list = by === 'series' ? raw.series : raw.categories;
  const entry = Array.isArray(list) ? list.find((item) => isRecord(item) && item.id === value) : undefined;
  return isRecord(entry) && typeof entry.label === 'string' ? entry.label : value;
}

function substitute(value: unknown, placeholder: string, replacement: string): unknown {
  if (typeof value === 'string') return value.split(placeholder).join(replacement);
  if (Array.isArray(value)) return value.map((item) => substitute(item, placeholder, replacement));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, placeholder, replacement)]));
  }
  return value;
}

/**
 * A panel that names its focus series with `highlight` or `emphasis` colours
 * its series by id itself. A colorRole on every series would override that
 * focus, so such a panel keeps its series as written.
 */
function stylesSeriesById(panel: GridPanelSpec): boolean {
  const options = isRecord(panel.options) ? panel.options : {};
  return options.highlight !== undefined || options.emphasis !== undefined;
}

/**
 * Locks the colours of a written-out grid by series id, over the panels that
 * do not style their series by id. Returns the same array when nothing changes.
 */
function lockWrittenOutPanels(panels: GridPanelSpec[]): GridPanelSpec[] {
  const plain = panels.filter((panel) => !stylesSeriesById(panel));
  if (!seriesIdsDisagree(plain)) return panels;
  const locked = lockPaletteBySeriesId(plain, false);
  const lockedQueue = [...locked];
  return panels.map((panel) => (stylesSeriesById(panel) ? panel : (lockedQueue.shift() ?? panel)));
}

/** The non-reference series ids a panel lists, in order. */
function panelSeriesIds(panel: GridPanelSpec): string[] {
  const series = isRecord(panel.data) && Array.isArray(panel.data.series) ? panel.data.series : [];
  return series.flatMap((item) => (isRecord(item) && typeof item.id === 'string' && item.role !== 'reference' ? [item.id] : []));
}

/**
 * True when a written-out grid shares a series id between panels and the panels
 * do not already list the same ids in the same order. Panels that agree by
 * position, or that share no id, keep the colours they have.
 */
function seriesIdsDisagree(panels: GridPanelSpec[]): boolean {
  const lists = panels.map(panelSeriesIds).filter((ids) => ids.length > 0);
  const panelsOfId = new Map<string, number>();
  for (const ids of lists) for (const id of new Set(ids)) panelsOfId.set(id, (panelsOfId.get(id) ?? 0) + 1);
  const shared = [...panelsOfId.values()].some((count) => count > 1);
  const first = lists[0] ?? [];
  return shared && lists.some((ids) => ids.length !== first.length || ids.some((id, index) => id !== first[index]));
}

function lockPaletteBySeriesId(panels: GridPanelSpec[], reorder = true): GridPanelSpec[] {
  const roleBySeries = new Map<string, string>();
  for (const panel of panels) {
    const series = isRecord(panel.data) && Array.isArray(panel.data.series) ? panel.data.series : [];
    for (const item of series) {
      if (!isRecord(item) || typeof item.id !== 'string' || item.role === 'reference') continue;
      if (!roleBySeries.has(item.id)) roleBySeries.set(item.id, `series-${roleBySeries.size + 1}`);
    }
  }

  // One series order across the repeated panels, the order the series first
  // appear in: otherwise a slice that lists its pair the other way round
  // would draw the pair reversed in its panel alone.
  const rank = [...roleBySeries.keys()];
  const at = (item: unknown): number => {
    const index = isRecord(item) && typeof item.id === 'string' ? rank.indexOf(item.id) : -1;
    return index < 0 ? rank.length : index;
  };
  return panels.map((panel) => {
    if (!isRecord(panel.data) || !Array.isArray(panel.data.series)) return panel;
    const series = (reorder ? [...panel.data.series].sort((a, b) => at(a) - at(b)) : panel.data.series).map((item) => {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        item.role === 'reference' ||
        item.fill !== undefined ||
        item.colorRole !== undefined ||
        item.scenario !== undefined
      ) {
        return item;
      }
      return { ...item, colorRole: roleBySeries.get(item.id) };
    });
    return { ...panel, data: { ...panel.data, series } };
  });
}

