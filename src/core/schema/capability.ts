/**
 * The option capability tables every chart schema is built from, keys only
 * and without zod: which type reads which key.
 *
 * The schemas (shared.ts refusedBaseOptions and narrowValueAxis) turn these
 * tables into `z.never` keys and answer with the reasons in
 * capabilityReasons.ts, which only the schema side links. The per-type React
 * entries do not link zod or the reasons: `optionRefusals` (refusals.ts)
 * reads these tables through `schemaRefusedKeys` and refuses the same keys
 * with the same code, path and patch and a short sentence of its own.
 * A test sweeps every key the published schemas refuse through
 * both doors.
 */

/**
 * Types whose layout draws nothing for any legend value: the
 * key is refused by name there.
 */
export const LEGEND_REFUSED: readonly string[] = ['box'];

/**
 * Types on which some legend values draw exactly what the default draws:
 * those values are refused by name, and the values that draw a key
 * stay accepted.
 */
export const LEGEND_DRAWS: Readonly<Record<string, readonly string[]>> = {
  slope: ['top', 'bottom'],
};

/**
 * Per-capability narrowing of the shared base.
 *
 * `transpose` above is the degenerate case of this table: a key NO layout reads,
 * refused on the base itself. The general case is a key SOME layouts read; a base schema
 * that admitted every key on all types would let each layout honour the subset
 * it happens to implement, and the rest would be accepted and ignored. The
 * caller — on this product, an agent reporting to a human who is not watching
 * the terminal — would be told `ok: true` every time.
 *
 * `implementedBy` is the set of registered types whose layout READS the key
 * (directly, or by forwarding its options to a host layout that does).
 * It is a literal, allowed only as an allowlist with an assertion
 * that `derived − allowlist` is empty: `tests/option-capability.test.ts`
 * derives, from every registered type's own published JSON Schema, whether
 * each gated key is accepted or refused, and asserts that partition equals
 * this table exactly in both directions. The behavioral direction — an
 * accepting layout actually responding — lives in per-chart tests (the
 * census cannot see a layout ignore a key it accepts).
 *
 * Fail-closed by construction: a newly registered type is refused every key in
 * this table until it is named, which is the opposite of the inheritance that
 * inheriting every key.
 */
export const OPTION_CAPABILITY = {
  animate: {
    implementedBy: [],
  },
  debug: {
    implementedBy: [],
  },
  rowLabels: {
    implementedBy: ['bar', 'bullet', 'box', 'dot', 'likert'],
  },
  categoryAxis: {
    implementedBy: ['line'],
  },
  categoryLabels: {
    implementedBy: ['column', 'combo', 'pareto'],
  },
  secondaryAxis: {
    implementedBy: ['box', 'combo'],
  },
  // `labels` (both `false` and per-kind maps) changes nothing on waterfall:
  // it renders byte-identically — its layout
  // reads only labelDensity/labelPlacements. Across the registry:
  // 21 layouts read `options.labels` directly, and cohort/likert/pareto/
  // pyramid forward it to a reading host (heatmap/bar/combo/butterfly).
  // waterfall and pvm (whose host IS waterfall) never consult it, grid reads
  // it neither for itself nor for panels (panels author their own), and
  // table/diagram have their own display models.
  labels: {
    implementedBy: [
      'bar', 'box', 'bullet', 'butterfly', 'choropleth', 'cohort', 'column',
      'combo', 'dot', 'funnel', 'gantt', 'heatmap', 'histogram', 'kpi',
      'likert', 'line', 'mekko', 'pareto', 'pie', 'pyramid', 'scatter',
      'slope', 'status', 'tilemap', 'variance',
    ],
  },
  colorblindSafe: {
    implementedBy: ['bar', 'choropleth', 'column', 'heatmap', 'status', 'table', 'dimswitch', 'tilemap', 'variance'],
  },
  // the types that draw a forecast, partial-period or no-data hatch
  // the key can strengthen or soften. Per the option census
  // in tests/option-capability.test.ts, variance draws no hatch,
  // and pareto, pvm and pyramid send their hosts no forecast, partial or
  // missing value to hatch and take no band annotation, so no theme or option
  // lets the key change a pixel there. They refuse it. Heatmap keeps it: its
  // no-data stripes sit at the floor in the shipped presets, but a darker
  // color.grid in theme overrides gives them room. Status sets the strength
  // of its grounded hatch (groundedHatchColors).
  hatchStrength: {
    implementedBy: [
      'bar', 'butterfly', 'choropleth', 'cohort', 'column', 'combo', 'funnel', 'grid', 'heatmap', 'line',
      'mekko', 'slope', 'status', 'tilemap', 'waterfall',
    ],
  },
  // sort, topN and bandFraction pass on every
  // type and draw byte-identical SVG on the ones below that are not named.
  // likert, pareto (sort) and pyramid refuse in their own schemas. likert,
  // pareto, pvm and pyramid forward bandFraction to the host layout that draws
  // their bands. Histogram sort and topN, and box
  // topN and bandFraction are read only to warn that they do nothing; they
  // are refused here like every other ignored option.
  sort: {
    implementedBy: ['bar', 'box', 'cohort', 'column', 'dot', 'heatmap', 'mekko', 'pie', 'table', 'dimswitch'],
  },
  topN: {
    implementedBy: ['bar', 'butterfly', 'choropleth', 'column', 'mekko', 'pareto', 'pie', 'table'],
  },
  // A printed whole adds up: these types print computed shares of one whole on their marks
  // (a 100% stack on bar and column).
  rounding: {
    implementedBy: ['bar', 'bartable', 'column', 'combo', 'line', 'mekko', 'pie'],
  },
  bandFraction: {
    implementedBy: [
      'bar', 'bullet', 'butterfly', 'column', 'combo', 'dot', 'funnel', 'gantt',
      'histogram', 'likert', 'pareto', 'pvm', 'pyramid', 'variance', 'waterfall',
    ],
  },
  // Choropleth and tilemap read highlight nowhere
  // and draw the same map with and without it. Creative and diagram
  // refuse it through their strict schemas. This row is the one refusal path.
  highlight: {
    implementedBy: [
      'bar', 'bartable', 'box', 'bullet', 'butterfly', 'cohort', 'column', 'combo', 'dot',
      'funnel', 'gantt', 'grid', 'heatmap', 'histogram', 'kpi', 'likert', 'line', 'mekko', 'pareto', 'pie', 'pvm',
      'pyramid', 'scatter', 'slope', 'sparkline', 'status', 'table', 'dimswitch', 'variance', 'waterfall',
    ],
  },
  // Story stepper: the types that fade marks by data id and keep
  // a plot. Grid panels, the HTML tables and the cards have no story layer.
  // The category records, pie, funnel and mekko read a cell's details into
  // its hover record (a11y/details.ts); every other type keeps cells without them.
  detailFields: {
    implementedBy: ['bar', 'butterfly', 'column', 'combo', 'dot', 'funnel', 'heatmap', 'line', 'mekko', 'pie', 'slope'],
  },
  story: {
    implementedBy: [
      'bar', 'bartable', 'box', 'bullet', 'butterfly', 'cohort', 'column', 'combo', 'dot', 'funnel', 'gantt',
      'heatmap', 'histogram', 'likert', 'line', 'mekko', 'pareto', 'pie', 'pvm', 'pyramid', 'scatter', 'slope',
      'status', 'variance', 'waterfall',
    ],
  },
} as const;

/**
 * The nested twin of OPTION_CAPABILITY for the shared `valueAxis` object,
 * whose sub-keys every type would inherit whether its layout reads them or not
 * (tickStep and reverse draw byte-identical SVG on
 * column, bar, combo, mekko, pareto and variance; waterfall and pvm read no
 * sub-key but break). Two shapes, both enforced by `narrowValueAxis`:
 *
 * - `VALUE_AXIS_CAPABILITY`: a sub-key only some types read, fail-closed like
 *   the table above. box reads tickStep and reverse only to warn that it
 *   ignores them. break is refused wherever no glyph is drawn.
 * - `VALUE_AXIS_ONLY`: a type whose layout reads just the listed sub-keys;
 *   every other sub-key is refused there, and with no sub-key listed the
 *   whole object is.
 *
 * `tests/option-capability.test.ts` checks both against every published
 * schema, as it does the table above.
 */
export const VALUE_AXIS_CAPABILITY = {
  tickStep: {
    implementedBy: ['box', 'column', 'line'],
  },
  reverse: {
    implementedBy: ['box', 'line', 'scatter'],
  },
  // Every other type would accept break, draw no glyph and
  // only warn axis-break-unsupported. A bar variant that draws none
  // (football-field, tornado) still warns, because the type draws it elsewhere.
  break: {
    implementedBy: ['bar', 'column', 'histogram', 'pvm', 'waterfall'],
  },
  // Line, column, combo, mekko and variance would accept
  // log, warn log-refused and draw linear. Scatter is the one log scale.
  log: {
    implementedBy: ['scatter'],
  },
} as const;

export const VALUE_AXIS_ONLY = {
  waterfall: {
    keys: ['break'],
  },
  // The waterfall host draws authored breaks and explicit break: 'auto'.
  // False keeps a pvm bridge whole; absent resolves to 'auto' when the base swamps the steps.
  pvm: {
    keys: ['break'],
  },
  slope: {
    keys: ['min', 'max'],
  },
  sparkline: {
    keys: [],
  },
  dimswitch: {
    keys: [],
  },
  table: {
    keys: [],
  },
  bartable: {
    keys: [],
  },
  diagram: {
    keys: [],
  },
  creative: {
    keys: [],
  },
  // On these nine, valueAxis.show true and false draw the same
  // SVG, and likert accepts show only to suppress it.
  pie: {
    keys: [],
  },
  funnel: {
    keys: [],
  },
  heatmap: {
    keys: [],
  },
  kpi: {
    keys: [],
  },
  status: {
    keys: [],
  },
  gantt: {
    keys: [],
  },
  tilemap: {
    keys: [],
  },
  choropleth: {
    keys: [],
  },
  cohort: {
    keys: [],
  },
  likert: {
    keys: [],
  },
  // Show, gridlines, min and max draw
  // byte-identical SVG on both mirrored types.
  butterfly: {
    keys: [],
  },
  pyramid: {
    keys: [],
  },
  // A sankey has no value axis: node heights share one scale that no axis shows.
  sankey: {
    keys: [],
  },
} as const satisfies Readonly<Record<string, { keys: readonly string[] }>>;

/** VALUE_AXIS_ONLY's entry for `type`, or undefined when the type reads every sub-key. */
export function valueAxisOnly(type: string): { keys: readonly string[] } | undefined {
  return Object.hasOwn(VALUE_AXIS_ONLY, type) ? VALUE_AXIS_ONLY[type as keyof typeof VALUE_AXIS_ONLY] : undefined;
}

/** Keys one type's own schema refuses beside the shared tables (slope's two label modes, bar's ribbons). */
const TYPE_REFUSED: Readonly<Record<string, readonly string[]>> = {
  slope: ['seriesLabels', 'valueLabels'],
  bar: ['ribbons'],
};

/** The sub-keys of the shared valueAxis object (valueAxisSchema's shape). */
const VALUE_AXIS_KEYS = ['show', 'min', 'max', 'tickStep', 'includeZero', 'percent', 'log', 'reverse', 'gridlines', 'break'] as const;

/** A legend value that draws nothing on `type`. */
export function legendDrawsNothing(type: string, value: unknown): boolean {
  return Object.hasOwn(LEGEND_DRAWS, type) && typeof value === 'string' && !LEGEND_DRAWS[type]!.includes(value);
}

/**
 * Why the valueAxis sub-key `key` is refused on `type`: the type reads only
 * other sub-keys ('only'), or the sub-key's capability omits the type; else
 * undefined.
 */
export function valueAxisRefusal(type: string, key: string): 'only' | 'capability' | undefined {
  const only = valueAxisOnly(type);
  if (only && !only.keys.includes(key)) return 'only';
  const capability = (VALUE_AXIS_CAPABILITY as Record<string, { implementedBy: readonly string[] }>)[key];
  return capability && !capability.implementedBy.includes(type) ? 'capability' : undefined;
}

/** Every option key the schemas refuse on `type` by name: the top-level keys, and the valueAxis sub-keys where the object itself is accepted. */
export function schemaRefusedKeys(type: string): { options: string[]; valueAxis: string[] } {
  const options = ['transpose'];
  for (const [key, capability] of Object.entries(OPTION_CAPABILITY)) {
    if ((capability.implementedBy as readonly string[]).includes(type)) continue;
    if ('unsupportedSeverity' in capability && capability.unsupportedSeverity === 'warn') continue;
    options.push(key);
  }
  if (LEGEND_REFUSED.includes(type)) options.push('legend');
  options.push(...(TYPE_REFUSED[type] ?? []));
  const only = valueAxisOnly(type);
  if (only?.keys.length === 0) return { options: [...options, 'valueAxis'], valueAxis: [] };
  return { options, valueAxis: VALUE_AXIS_KEYS.filter((key) => valueAxisRefusal(type, key) !== undefined) };
}

/**
 * The label kinds each type's `labels` map takes: the kinds its
 * layout, or the host layout it forwards to, reads on a path the type can
 * take. A key outside its list is refused as an unknown option with the
 * nearest kind, so `labels: { totla: true }` never passes silently.
 * Each kind listed changes some fixture when set,
 * which the option census in tests/option-capability.test.ts holds; a kind
 * the code never reads for the type, or reads only on a host path the type
 * never takes, is left out: histogram and pareto send their hosts one column
 * series and no reference, likert always stacks and hides the value axis.
 * scatter adds its own `value`;
 * choropleth publishes its own labels shape; the other types refuse labels
 * (OPTION_CAPABILITY.labels).
 */
export const LABEL_KINDS: Readonly<Record<string, readonly string[]>> = {
  bar: ['category', 'segment', 'restSeries', 'point', 'grandTotal', 'percentIndicator', 'tick', 'axisTitle', 'valueLine'],
  box: ['category', 'point', 'axisTitle'],
  bullet: ['category', 'point', 'axisTitle', 'annotation'],
  butterfly: ['category', 'series', 'point'],
  cohort: ['category', 'series', 'point'],
  column: ['category', 'segment', 'restSeries', 'point', 'grandTotal', 'percentIndicator', 'tick', 'axisTitle', 'valueLine', 'annotation', 'growth'],
  combo: ['category', 'segment', 'point', 'grandTotal', 'tick', 'axisTitle'],
  dot: ['category', 'point'],
  funnel: ['category', 'segment', 'point', 'total', 'annotation'],
  gantt: ['valueLine', 'annotation', 'activity', 'item'],
  heatmap: ['category', 'series', 'point'],
  histogram: ['category', 'point', 'axisTitle'],
  kpi: ['category', 'point', 'total'],
  likert: ['category', 'segment', 'grandTotal'],
  line: ['category', 'series', 'point', 'restSeries', 'percentIndicator', 'axisTitle'],
  mekko: ['category', 'segment', 'total', 'axisTitle'],
  pareto: ['category', 'point', 'grandTotal', 'axisTitle'],
  pie: ['category', 'total', 'insidePie', 'outsidePie'],
  pyramid: ['category', 'series', 'point'],
  scatter: ['point', 'value'],
  slope: ['category', 'series'],
  status: ['category', 'series'],
  tilemap: ['category'],
  variance: ['category', 'point', 'total', 'axisTitle'],
};
