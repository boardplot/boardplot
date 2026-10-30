import type { GridDerived as StackGridDerived } from '../charts/grid/layout';
import { creativeClaims } from '../charts/creative/claims';
import { dimswitchClaims } from '../charts/dimswitch/claims';
import { tableCellNodeId } from '../charts/table/cellKey';
/** Pure claim extraction shared by browser layouts and manifest generation. */

import type { BoxDerived } from '../charts/box/types';
import { AVERAGE_ROW_ID as COHORT_AVERAGE_ROW_ID, missingCohortRate } from '../charts/cohort/retention';
import type { CohortDerived } from '../charts/cohort/types';
import type { HistogramDerived, HistogramMarks } from '../charts/histogram/types';
import type { KpiDerived } from '../charts/kpi/layout';
import type { StatusDerived, StatusMarks } from '../charts/status/layout';
import type { WaffleDerived } from '../charts/waffle/types';
import type { GridMarks } from '../grid/layoutGrid';
import type { OlsFit, OlsMoments } from '../ols';
import type { Geometry, PlacedAnnotation } from '../types/scene';
import type { TableDerived } from '../types/table';
import type { TotalBasis } from '../charts/waterfall/layout';

/**
 * Six kinds, in exactly two groups, and the split is the contract.
 *
 * DERIVATIONS — `derived` | `aggregate` | `reconciliation` | `rounding` —
 * promise: apply `op` to `inputs` and you land on `output.raw`. The test helper
 * tests/helpers/recompute.ts checks that promise.
 *
 * NON-DERIVATIONS — `observed` | `authored` — promise nothing arithmetic, and
 * say so in the record instead of pretending:
 *   `observed`  the value was MEASURED off the source sample (a bin count, a
 *               quartile, a count of points in a quadrant). The operands are
 *               the source rows, which the manifest binds by `sourceSha256`
 *               rather than by copying thousands of numbers into every claim.
 *   `authored`  the value came from the DOCUMENT (an opening waterfall total,
 *               a declared quadrant cut point, a prose callout).
 *
 * The two groups stay apart: an authored opening total and an engine-summed
 * closing total must not both become byte-identical
 * `kind:'derived', inputs: []` records, or `verify` would report "full claim
 * records match" over a comparison of a number with itself.
 */
export const CLAIM_KIND_GROUPS = {
  derivations: ['derived', 'aggregate', 'reconciliation', 'rounding'],
  nonDerivations: ['observed', 'authored'],
} as const;

export const CLAIM_KINDS = [
  ...CLAIM_KIND_GROUPS.derivations,
  ...CLAIM_KIND_GROUPS.nonDerivations,
] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];

export interface ClaimRecordV1 {
  id: string;
  kind: ClaimKind;
  op: string; // versioned: 'sum@1', 'percentDelta@1', 'waterfall-total@1' …
  inputs: { ref: string; value: number | null; state?: string }[];
  output: { raw: number | null; state: string; displayed: string };
  nodeId?: string;
  /** Destination when the displayed value moved from its label into a note. */
  noteLocation?: string;
  /** False when the value is not drawn on the chart: it went into a note. `displayed` is empty when the note only counts it. */
  drawn?: false;
}

/**
 * Claims are emitted where the calculation happened — typed derived
 * fields only, NEVER generic geometry inspection: a generic extractor
 * reconstructs, adapters read what the layout itself computed.
 */
/**
 * Annotations are a TOP-LEVEL chart field, available on every type, so they are
 * appended for all of them rather than living in one more `case`. Without this
 * branch the most quotable number on a chart, such as "+5.6% p.a.", would never
 * enter the manifest, so `verify` would have nothing to compare and would pass
 * a fabricated value with exit 0.
 *
 * `output.displayed` is what the READER sees; the annotation's `computedText`
 * is what the ENGINE derived. When they differ the author overrode the number,
 * and the record says so in `state`, so a reader of the record sees the
 * assertion instead of a certified number.
 */
function annotationClaims(geo: Geometry<object, object>): ClaimRecordV1[] {
  const annotations = (geo as { annotations?: PlacedAnnotation[] }).annotations ?? [];
  const labels =
    (geo as { labels?: { id?: string; text?: string; hidden?: boolean }[] }).labels ?? [];
  const drawnById = new Map<string, string>();
  /**
   * Labels the solver could not place. `labelsToNodes` emits no scene node for
   * them, so a claim that names one is naming nothing — and `verify` treats an
   * unresolvable nodeId as SEMANTIC_FAIL. A gantt `today` line whose date label
   * lost its placement (the plot was full — the solver says so with its own
   * `label-hidden` lint) rendered a perfectly good chart and then had its
   * document called tampered.
   *
   * A hidden label does not invalidate the annotation's ARITHMETIC, so the
   * receipt stays and stays checkable. What it invalidates is the pointer to
   * where the number is printed, because it is not printed. So the pointer is
   * dropped and the solver's existing lint carries the "why". A label
   * moved into a note is rebound to that note by `claimsForChart` below.
   */
  const hiddenLabelIds = new Set<string>();
  for (const label of labels) {
    if (typeof label?.id !== 'string') continue;
    if (typeof label.text === 'string') drawnById.set(label.id, label.text);
    if (label.hidden) hiddenLabelIds.add(label.id);
  }
  return annotations.map((annotation) => {
    const computed = annotation.computedText;
    const drawn = (annotation.labelId ? drawnById.get(annotation.labelId) : undefined) ?? computed;
    const overridden = drawn.trim() !== computed.trim();
    // `callout` and `note` carry authored prose. Their text is never something
    // the engine derived, so recording it as state 'value' — engine-derived —
    // is false on its face: a callout reading "EBIT is 999" on a chart whose
    // engine value is 167 would be claimed as derived, warn about nothing,
    // and collect the full-verification sentence. The `${value}` token is substituted from the engine, but the
    // sentence built around it is still the author's claim, so a prose
    // annotation carrying ANY digit is an assertion, not a derivation.
    // (The rule for narrative numbers, applied one layer down: engine-derived
    // or visibly an assertion, with no third category.)
    const prose = annotation.kind === 'callout' || annotation.kind === 'note';
    const asserts = prose && /\d/.test(drawn);
    // The layout hands over the arithmetic it actually did. `+5.6% p.a.`
    // carries the two endpoint values AND the year span, and the gate in
    // tests/helpers/recompute.ts re-derives 5.6 from them. Without the
    // arithmetic the record would be `raw: null, inputs: []` and restate the
    // headline instead of standing behind it.
    const derivation = annotation.derivation;
    const basis = derivation?.basis ?? 'authored';
    // An OVERRIDDEN annotation is never a derivation, whatever the engine
    // computed: the number on the page is not the number in the operands, and
    // stamping it `derived` would certify the override. The engine's own answer
    // rides along as an operand so the receipt shows both.
    const kind = overridden ? ('authored' as const)
      : basis === 'derived' ? ('derived' as const)
        : basis === 'observed' ? ('observed' as const)
          : ('authored' as const);
    return {
      id: `annotation:${annotation.id}`,
      kind,
      op: derivation?.op ?? `annotation-${annotation.kind}@1`,
      inputs: overridden
        ? [
            { ref: `computed:${computed}`, value: derivation?.raw ?? null, state: 'engine' },
            ...(derivation?.inputs ?? []),
          ]
        : (derivation?.inputs ?? []),
      output: {
        // The engine's own number, present in the record for the first time.
        // On an override it stays the ENGINE's value while `displayed` carries
        // what was published, so the two are side by side and the divergence
        // is stated rather than certified.
        raw: derivation?.raw ?? null,
        state: overridden ? 'authored-override' : asserts ? 'authored-assertion' : 'value',
        displayed: drawn,
      },
      // Scene label nodes are namespaced `label:<labelId>` — the bare labelId
      // does not resolve, and verify treats an unresolvable nodeId as a
      // SEMANTIC_FAIL. That namespacing is only re-derivable by concatenation
      // while nothing else rewrites the id: the grid composer prefixes panel
      // scene nodes with `<panel>/`, and `label:` + the prefixed labelId then
      // names a node that exists in no scene. Where a composer knows the real
      // node it says so on `labelNodeId`, and that wins.
      nodeId:
        !annotation.labelId || hiddenLabelIds.has(annotation.labelId)
          ? undefined
          : (annotation.labelNodeId ?? `label:${annotation.labelId}`),
    };
  });
}

/**
 * Scatter outliers. A clipped point is drawn somewhere its value is not,
 * so the record carries the value: `output.raw` is the real coordinate,
 * `inputs` names the bound that moved the mark, and `nodeId` points at the open
 * marker on the page. MEASURED, not derived: the coordinate was read off the
 * source row, and no arithmetic over the bound reproduces it.
 *
 * The per-bound count claim carries the footnote in `displayed`, so a published
 * "12 points clipped at 25,000" is checkable against the number the engine
 * counted instead of being taken on trust.
 */
function scatterOutlierClaims(geo: Geometry<object, object>): ClaimRecordV1[] {
  const derived = geo.derived as {
    clipped?: {
      axis: 'x' | 'y';
      bound: 'min' | 'max';
      limit: number;
      count: number;
      note: string;
      points: { id: string; value: number }[];
    }[];
    dropped?: { minCount: number; count: number; note: string };
  };
  const marks = geo.marks as { points?: { id: string; nodeId?: string }[] } | undefined;
  const nodeIdOf = new Map((marks?.points ?? []).map((point) => [point.id, point.nodeId]));
  const claims: ClaimRecordV1[] = [];
  for (const record of derived.clipped ?? []) {
    const bound = { ref: `clamp.${record.axis}.${record.bound}`, value: record.limit, state: 'applied' };
    claims.push({
      id: `scatter:clipped:${record.axis}:${record.bound}`,
      kind: 'observed',
      op: 'scatter-clip-count@1',
      inputs: [bound, { ref: `plotted.${record.axis}`, value: null, state: `n=${record.points.length}` }],
      output: { raw: record.count, state: 'value', displayed: record.note },
    });
    for (const point of record.points) {
      const nodeId = nodeIdOf.get(point.id);
      claims.push({
        id: `scatter:clipped:${record.axis}:${record.bound}:${point.id}`,
        kind: 'observed',
        op: 'scatter-clip-value@1',
        inputs: [bound],
        output: { raw: point.value, state: 'clipped', displayed: '' },
        ...(nodeId ? { nodeId } : {}),
      });
    }
  }
  if (derived.dropped) {
    claims.push({
      id: 'scatter:dropped',
      kind: 'observed',
      op: 'scatter-min-count@1',
      inputs: [{ ref: 'options.minCount', value: derived.dropped.minCount, state: 'threshold' }],
      output: { raw: derived.dropped.count, state: 'value', displayed: derived.dropped.note },
    });
  }
  return claims;
}

/**
 * Trend lines. Slope, intercept and r² are DERIVED from the six
 * moments the fit ran on (n, the means, the centred Sxx, Syy, Sxy), and the
 * moments ride along as the operands, so the receipt gate recomputes each
 * number from the record alone (src/core/ols.ts).
 */
function trendClaims(geo: Geometry<object, object>): ClaimRecordV1[] {
  const trends = (geo.derived as { trends?: (OlsMoments & OlsFit & { id: string })[] }).trends ?? [];
  return trends.flatMap((fit) => {
    const inputs = (['n', 'meanX', 'meanY', 'sxx', 'syy', 'sxy'] as const).map((key) => ({ ref: `trend.${fit.id}.${key}`, value: fit[key] }));
    return (['slope', 'intercept', 'r2'] as const).map((part) => ({
      id: `${geo.type}:trend:${fit.id}:${part}`,
      kind: 'derived' as const,
      op: `ols-${part}@2`,
      inputs,
      ...(geo.type === 'line' && part !== 'intercept' ? { nodeId: geo.legend?.items.find(item => item.id === `trend:${fit.id}`)?.labelId } : {}),
      output: { raw: fit[part], state: fit[part] === null ? 'undefined' : 'value', displayed: '' },
    }));
  });
}

/**
 * Scatter: the quadrant disclosure (cut points and box counts) and the outlier
 * records above. Both are CONDITIONAL, and the conditionality is load-bearing:
 * every scatter manifest written before a preset existed carries `claims: []`.
 * An unconditional case would change all of them and force an ENGINE_REV bump.
 */
function scatterClaims(geo: Geometry<object, object>): ClaimRecordV1[] {
  const derived = geo.derived as {
    quadrants?: {
      x: number;
      y: number;
      xText: string;
      yText: string;
      xSource: string;
      ySource: string;
      counts: Record<string, number>;
      assignment: Record<string, string>;
    };
  };
  const outliers = [...scatterOutlierClaims(geo), ...trendClaims(geo)];
  const quadrants = derived.quadrants;
  if (!quadrants) return outliers;
  const support = Object.keys(quadrants.assignment).length;
  const cutClaim = (axis: 'x' | 'y'): ClaimRecordV1 => {
    const source = axis === 'x' ? quadrants.xSource : quadrants.ySource;
    return {
      // A DECLARED cut point is a number the document typed; a computed one
      // is a statistic measured over the plotted points. Neither is a
      // derivation over recorded operands, and calling both `derived` put
      // an authored threshold and a measured median in the same shape.
      id: `scatter:quadrant:${axis}`,
      kind: source === 'declared' ? ('authored' as const) : ('observed' as const),
      op: `${source}@1`,
      // A declared cut point has no inputs — it IS the input. A computed one
      // names the support it was computed over, so a reader can see that the
      // statistic ran on the plotted points and on how many of them.
      inputs:
        source === 'declared'
          ? []
          : [{ ref: `plotted.${axis}`, value: null, state: `n=${support}` }],
      // `displayed` is the string the exhibit actually prints for this cut
      // point (divider tag and method footnote read the same field). Filing
      // it here makes the receipt carry both halves of the disclosure, so a
      // printed threshold that drifts from the applied one is a claim
      // mismatch at verify time, not a discrepancy only a reader would spot.
      output: {
        raw: axis === 'x' ? quadrants.x : quadrants.y,
        state: 'value',
        displayed: axis === 'x' ? quadrants.xText : quadrants.yText,
      },
    };
  };
  return [
    cutClaim('x'),
    cutClaim('y'),
    ...(['tl', 'tr', 'bl', 'br'] as const).map((box) => ({
      id: `scatter:quadrant:count:${box}`,
      // A count of plotted points is MEASURED. The two cut points are
      // necessary but nowhere near sufficient — no count can be re-derived
      // from two thresholds without the points themselves — so filing it as
      // an aggregate over those two operands would be a receipt that names the
      // wrong inputs. The cut points stay in the record because they are
      // what a reader needs to reproduce the count against the source; the
      // KIND carries the distinction, and it is the part `verify` reads.
      kind: 'observed' as const,
      op: 'quadrant-count@1',
      // The half-open rule (x >= cut is right, y >= cut is top) is pinned by
      // the op version; `support` says how many points were classified.
      inputs: [
        { ref: 'plotted.points', value: null, state: `n=${support}` },
        { ref: 'quadrant.x', value: quadrants.x },
        { ref: 'quadrant.y', value: quadrants.y },
      ],
      output: { raw: quadrants.counts[box] ?? 0, state: 'value', displayed: '' },
    })),
    ...outliers,
  ];
}

export function claimsForChart(type: string, geo: Geometry<object, object>): ClaimRecordV1[] {
  if (type === 'grid') {
    const stack = (geo.derived as StackGridDerived).metricStack;
    if (stack) return bindClaimLabels(type, geo, stack.readouts.flatMap(readout => readout.claims));
    const panels = (geo.marks as GridMarks).panels.filter(panel => panel.chart);
    const claims = panels.flatMap(panel => claimsForChart(panel.type, panel.chart!.geometry).map(claim => ({
      ...claim,
      id: `${panel.id}/${claim.id}`,
      inputs: claim.inputs.map(input => ({ ...input, ref: `${panel.id}/${input.ref}` })),
      ...(claim.nodeId ? { nodeId: `${panel.id}/${claim.nodeId}` } : {}),
      ...(claim.noteLocation && claim.nodeId
        ? { noteLocation: claim.noteLocation.replace(`(${claim.nodeId})`, `(${panel.id}/${claim.nodeId})`) } : {}),
    })));
    // Child annotations are also flattened into the grid for rendering. Read
    // them from their own geometry once, where label and note ids still agree.
    const ownAnnotations = geo.annotations.filter(annotation => !panels.some(panel => annotation.id.startsWith(`${panel.id}/`)));
    return bindClaimLabels(type, geo, [...claims, ...annotationClaims({ ...geo, annotations: ownAnnotations })]);
  }
  return bindClaimLabels(type, geo, [...(type === 'creative' ? creativeClaims(geo) : claimsForChartType(type, geo)), ...stackTotalClaims(geo), ...annotationClaims(geo)]);
}

/** The key of a printed total label: `grandTotal:<category>` (column, bar, combo) or `total:<id>` (mekko column, pie centre). */
const totalKey = (label: { id: string; kind: string }): string | undefined =>
  label.kind === 'grandTotal' || label.kind === 'total' ? /^(?:grandTotal|total):(.+)$/.exec(label.id)?.[1] : undefined;

/** A printed total the engine added up (column, bar, combo, mekko, pie) is the sum of its parts. */
function stackTotalClaims(geo: Geometry<object, object>): ClaimRecordV1[] {
  const derived = geo.derived as { stackTotals?: Record<string, number>; totals?: Record<string, number>; columnTotals?: Record<string, number>;
    total?: number; stackParts?: Record<string, Record<string, number>> };
  if (!derived.stackParts) return [];
  // The layout's total says the label prints one; a pie has one total, keyed by its series.
  const hasTotal = (id: string) => (derived.stackTotals ?? derived.totals ?? derived.columnTotals)?.[id] !== undefined || derived.total !== undefined;
  return geo.labels.flatMap(label => {
    const id = totalKey(label);
    if (id === undefined) return [];
    const parts = Object.entries(derived.stackParts![id] ?? {});
    if (!hasTotal(id) || parts.length === 0) return [];
    return [{ id: `stack:total:${id}`, kind: 'aggregate' as const, op: 'sum@1',
      inputs: parts.map(([seriesId, value]) => ({ ref: `${id}:${seriesId}`, value })),
      // The raw sum of the parts: mekko and pie keep their totals rounded to two decimals.
      output: { raw: parts.reduce((sum, [, value]) => sum + value, 0), state: 'value', displayed: '' } }];
  });
}

/** Bind to the final scene, after a grid or the note pass changes placement. */
function bindClaimLabels(type: string, geo: Geometry<object, object>, claims: ClaimRecordV1[]): ClaimRecordV1[] {
  const ids = claimLabelIds(type, geo);
  const labels = new Map(geo.labels.map(label => [label.id, label]));
  // DimSwitch can supply thousands of cells, also inside a grid.
  const textNodes = type==='dimswitch' || (type==='grid' && claims.some(claim=>/(^|\/)dimswitch:\[/.test(claim.id)))
    ? new Map(geo.scene.filter(node=>node.t==='text').map(node=>[node.id,node])) : undefined;
  return claims.map(claim => {
    const label = labels.get(ids.get(claim.id) ?? '');
    const nodeId = label?.nodeId ?? claim.nodeId ?? (label ? `label:${label.id}` : undefined);
    const node = textNodes && !label?.noted ? textNodes.get(nodeId ?? '') : geo.scene.find(node => node.t === 'text' && (label?.noted
      ? label.noteLocation
        ? label.noteLocation.endsWith(`(${node.id})`)
        : geo.frame.footnoteNodeIds?.includes(node.id) && node.lines.join(' ').replace(/\s+/g, ' ').includes(label.text.replace(/\s+/g, ' '))
      : node.id === nodeId));
    const noteLocation = label?.noted ? label.noteLocation ?? (node ? `Footnote (${node.id})` : undefined) : undefined;
    // A note that only counts the value ("and 236 more") does not display it: the record says so and where it went.
    const displayed = noteLocation ? (label!.noteCounted ? '' : label!.text) : label?.hidden ? '' : node?.t === 'text' ? node.lines.join(' ') : undefined;
    if (displayed !== undefined) {
      claim = { ...claim, nodeId: node?.id, noteLocation, ...(noteLocation ? { drawn: false as const } : {}), output: { ...claim.output, displayed,
        ...(label?.claimText !== undefined && label.text !== label.claimText ? { state: 'authored-override' } : {}),
      } };
    }
    return /(^|\/)dimswitch:\[/.test(claim.id) ? claim : withoutResidue(claim);
  });
}

/** Adapters without claimId use the same label map, including through grids. */
function claimLabelIds(type: string, geo: Geometry<object, object>): Map<string, string> {
  const ids = new Map(geo.labels.filter(label => label.claimId).map(label => [label.claimId!, label.id]));
  for (const annotation of geo.annotations ?? []) {
    if (annotation.labelId) ids.set(`annotation:${annotation.id}`, annotation.labelId);
  }
  if (type === 'waterfall') {
    for (const label of geo.labels) if (label.id.startsWith('total:')) ids.set(`wf:${label.id}`, label.id);
  }
  for (const label of geo.labels) {
    const id = totalKey(label);
    if (id !== undefined && !ids.has(`stack:total:${id}`)) ids.set(`stack:total:${id}`, label.id);
  }
  if (type === 'grid') {
    for (const panel of (geo.marks as GridMarks).panels) if (panel.chart) {
      for (const [claim, label] of claimLabelIds(panel.type, panel.chart.geometry)) ids.set(`${panel.id}/${claim}`, `${panel.id}/${label}`);
    }
  }
  return ids;
}

const QUOTIENT_OPS: ReadonlySet<string> = new Set(['cohort-retention@1', 'cohort-average@1', 'funnel-conversion@1', 'pareto-cumshare@1', 'pareto-vital-few-share@1', 'percentOf@1', 'ratio@1', 'share@1']);

/**
 * A derived value without float residue: 12 significant digits at the
 * scale of its largest operand, so a PVM residual of 5.7e-14 beside effects in
 * the hundreds records 0 and a CAGR records 10, not 10.000000000000009. The
 * change stays far inside the receipt tolerance (1e-9 of the same scale).
 */
function withoutResidue(claim: ClaimRecordV1): ClaimRecordV1 {
  const raw = claim.output.raw;
  if (claim.kind === 'observed' || claim.kind === 'authored' || raw === null || !Number.isFinite(raw) || raw === 0) return claim;
  let scale = Math.abs(raw);
  // A quotient leaves its operands' scale: 1 of 100,000,000 is a true 1e-8, not residue.
  for (const input of QUOTIENT_OPS.has(claim.op) ? [] : claim.inputs) {
    if (input.value !== null && Number.isFinite(input.value)) scale = Math.max(scale, Math.abs(input.value));
  }
  const digits = 12 - (Math.floor(Math.log10(scale)) - Math.floor(Math.log10(Math.abs(raw))));
  const clean = digits < 1 ? 0 : Number(raw.toPrecision(Math.min(digits, 21)));
  return clean === raw ? claim : { ...claim, output: { ...claim.output, raw: clean } };
}

function claimsForChartType(type: string, geo: Geometry<object, object>): ClaimRecordV1[] {
  switch (type) {
    case 'dimswitch': return dimswitchClaims(geo);
    case 'table': {
      const derived = geo.derived as TableDerived;
      return derived.computedCells.map((c) => ({
        id: `table:${c.rowId}:${c.colId}${c.kind === 'calc' || c.kind === 'aggregate' ? '' : `:${c.kind}`}`,
        kind:
          c.kind === 'calc'
            ? ('derived' as const)
            : c.kind === 'aggregate'
              ? ('aggregate' as const)
              : c.kind === 'reconciliation'
                ? ('reconciliation' as const)
                : c.kind === 'rounding-adjustment'
                  ? ('rounding' as const)
                  : // 'unaudited': the engine derived nothing and says so. It
                    // carries no arithmetic promise, so it must not be stamped
                    // with a derivation kind — that is precisely how a receipt
                    // over no operands gets to look checked.
                    ('observed' as const),
        op: `${c.op}@1`,
        inputs: c.inputs.map((i) => ({
          ref: `${i.rowId}:${i.colId}${i.role ? `#${i.role}` : ''}`,
          value: i.value,
          ...(i.state ? { state: i.state } : {}),
        })),
        output: { raw: c.raw, state: c.state, displayed: c.displayed },
        nodeId: c.kind === 'calc' || c.kind === 'aggregate' ? tableCellNodeId('cell', c.rowId, c.colId) : undefined,
      }));
    }
    case 'box': {
      // MEASURED, not derived. A quartile is a statistic over the raw
      // observation vector; there is no pair of operands it follows from, and
      // copying every observation into every one of the four claims per group
      // would inflate the manifest without making the number checkable by
      // anything the manifest does not already bind (`sourceSha256` covers the
      // observations exactly).
      //
      // So the record says `observed` and stops. That is an HONEST absence:
      // `kind:'derived'` with a single null-valued operand would read to
      // `verify` — and to any consumer — as a checked derivation. The support
      // `n` rides along in `state` so a reader can at least see what the
      // statistic ran on.
      const derived = geo.derived as BoxDerived;
      return derived.groups.flatMap((group) => [
        ...(['q1', 'median', 'q3'] as const).map((part) => ({
          id: `box:${part}:${group.id}`,
          kind: 'observed' as const,
          op: 'box-quartile@1',
          inputs: [
            { ref: `${group.id}.observations`, value: null, state: `${derived.method} n=${group.n}` },
          ],
          output: {
            raw: group[part],
            state: group[part] === null ? group.state : 'measured',
            displayed: '',
          },
        })),
        {
          id: `box:n:${group.id}`,
          kind: 'observed' as const,
          op: 'box-count@1',
          inputs: [{ ref: `${group.id}.observations`, value: null, state: 'cardinality' }],
          output: { raw: group.n, state: group.state, displayed: '' },
        },
      ]);
    }
    case 'histogram': {
      // The receipt for "how did you get these bars": one claim per bin,
      // carrying the interval it counted over, plus the three quantiles the
      // Freedman-Diaconis width was derived from. `inputs: []` is literal —
      // a bin count has no upstream cells, only the sample and the edges — but
      // `kind:'aggregate'` on an empty operand list is a derivation claim with
      // nothing behind it. These are MEASUREMENTS over the sample, and the
      // record says so; the interval stays in `displayed`, which is the
      // half of the statement a reader can actually act on.
      const derived = geo.derived as HistogramDerived;
      const marks = geo.marks as HistogramMarks;
      const binClaims: ClaimRecordV1[] = derived.counts.map((count, index) => ({
        id: `histogram:bin:${index}`,
        kind: 'observed' as const,
        op: 'histogram-bin-count@1',
        inputs: [
          { ref: 'observations', value: null, state: 'sample' },
          { ref: `edge:${index}`, value: derived.binning.edges[index] ?? null },
          { ref: `edge:${index + 1}`, value: derived.binning.edges[index + 1] ?? null },
        ],
        output: {
          raw: count,
          state: 'value',
          displayed: `[${derived.binning.edges[index]}, ${derived.binning.edges[index + 1]})`,
        },
        ...(marks.bins?.[index]?.nodeId ? { nodeId: marks.bins[index]!.nodeId } : {}),
      }));
      const quantileClaims: ClaimRecordV1[] = (
        [
          ['q1', 0.25],
          ['median', 0.5],
          ['q3', 0.75],
        ] as const
      ).map(([part, p]) => ({
        id: `histogram:${part}`,
        kind: 'observed' as const,
        op: 'histogram-quantile@1',
        inputs: [{ ref: 'observations', value: p, state: 'type-7' }],
        output: { raw: derived[part], state: 'value', displayed: '' },
      }));
      return [...binClaims, ...quantileClaims];
    }
    case 'cohort': {
      // "Where does 60% come from" has exactly one honest answer: the two
      // counts it was divided from. The displayed string is read back off the
      // cell node so the receipt quotes what the READER sees, never a second
      // rounding of the same ratio.
      const derived = geo.derived as CohortDerived;
      const displayed = new Map<string, string>();
      for (const node of geo.scene) {
        const value = node.display && 'value' in node.display ? node.display.value : undefined;
        if (node.part === 'cell' && value !== undefined) displayed.set(node.id, value);
      }
      const claims: ClaimRecordV1[] = [];
      for (const row of derived.cohorts) {
        for (let t = 0; t < row.observedPeriods; t++) {
          const nodeId = `cell:${row.id}:t${t}`;
          const ratio = row.retention[t] ?? null;
          const previous = derived.basis === 'previous' && t > 0;
          claims.push({
            id: `cohort:${row.id}:t${t}`,
            kind: 'derived',
            op: 'cohort-retention@1',
            inputs: [
              { ref: `${row.id}:active:t${t}`, value: row.active[t] ?? null },
              {
                ref: previous ? `${row.id}:active:t${t - 1}` : `${row.id}:base`,
                value: previous ? (row.active[t - 1] ?? null) : row.base,
              },
            ],
            output: {
              raw: ratio,
              state: ratio === null ? missingCohortRate(row, t, derived.basis) ? 'missing' : 'n.m.' : 'value',
              displayed: displayed.get(nodeId) ?? '',
            },
            nodeId,
          });
        }
      }
      (derived.averages ?? []).forEach((average, t) => {
        const nodeId = `cell:${COHORT_AVERAGE_ROW_ID}:t${t}`;
        claims.push({
          id: `cohort:average:t${t}`,
          kind: 'aggregate',
          op: 'cohort-average@1',
          // A receipt that cannot be re-derived from its own inputs is not a
          // receipt. The average is sum(numerator)/sum(denominator), so BOTH
          // halves of every contributing cohort's fraction are listed, in
          // numerator/denominator pairs, and only for the cohorts that actually
          // contributed — the support set, never every cohort in the column.
          inputs: [...average.contributors, ...derived.cohorts.filter(row => missingCohortRate(row, t, derived.basis)).map(row => row.id)].flatMap((id) => {
            const row = derived.cohorts.find((candidate) => candidate.id === id)!;
            const previous = derived.basis === 'previous' && t > 0;
            return [
              { ref: `${id}:active:t${t}`, value: row.active[t] ?? null },
              {
                ref: previous ? `${id}:active:t${t - 1}` : `${id}:base`,
                value: previous ? (row.active[t - 1] ?? null) : row.base,
              },
            ];
          }),
          output: {
            raw: average.value,
            state: average.value === null && derived.cohorts.some(row => missingCohortRate(row, t, derived.basis)) ? 'missing' : `support:${average.support}`,
            displayed: displayed.get(nodeId) ?? '',
          },
          nodeId,
        });
      });
      return claims;
    }
    case 'scatter':
      return scatterClaims(geo);
    case 'line':
      return trendClaims(geo);
    case 'waterfall': {
      // The flagship type, and the one where the two categories are easiest to
      // confuse by eye: an opening total and a closing total draw the same bar.
      // `totalBasis` is the layout telling the receipt which is which — the
      // opening total is `items[0].value`, typed by the author, and the closing
      // total is the running sum whose addends are all in the record.
      const derived = geo.derived as {
        totals: Record<string, number>;
        totalBasis: Record<string, TotalBasis>;
      };
      // `displayed` carries the string the READER sees on the total label —
      // unit prefix included. The unit is a verify-grade property of the
      // number, not a theme decision: a build that
      // drops the currency from a bridge total moves the claim record
      // instead of shipping a silent integrity break. Empty when the solver hid the
      // label without a note — `claimsForChart` binds noted labels below.
      const totalLabels = (geo as { labels?: { id?: string; text?: string; hidden?: unknown }[] })
        .labels ?? [];
      const displayedByItem = new Map<string, string>();
      for (const label of totalLabels) {
        if (typeof label?.id !== 'string' || !label.id.startsWith('total:')) continue;
        if (label.hidden || typeof label.text !== 'string') continue;
        displayedByItem.set(label.id.slice('total:'.length), label.text);
      }
      return Object.entries(derived.totals).map(([id, raw]) => {
        const basis = derived.totalBasis?.[id];
        const displayed = displayedByItem.get(id) ?? '';
        if (basis && basis.authored === false) {
          return {
            id: `wf:total:${id}`,
            kind: 'derived' as const,
            op: 'waterfall-total@1',
            inputs: basis.inputs.map((input) => ({ ref: input.ref, value: input.value })),
            output: { raw, state: 'value', displayed },
          };
        }
        return {
          id: `wf:total:${id}`,
          kind: 'authored' as const,
          op: 'waterfall-opening@1',
          // The one operand is the document field the number was read from —
          // named, so a reader can go and look, and NOT presented as something
          // the engine computed.
          inputs: [{ ref: basis?.ref ?? `${id}.value`, value: raw, state: 'authored' }],
          output: { raw, state: 'authored', displayed },
        };
      });
    }
    case 'pvm': {
      // The arithmetic IS the product here: a wrong decomposition is invisible
      // to a reader because every bar still adds up. The receipt therefore
      // carries each effect against the two endpoints it bridges, plus the
      // reconciliation itself.
      // The two endpoints are NOT the operands of an effect. Listing them as
      // such said "price = f(priorRevenue, currentRevenue)", from which no
      // single effect can be re-derived — five effects shared one identical
      // pair of inputs and each claimed a different answer from them. The real
      // operands are the per-ITEM contributions the decomposition sums, and
      // they were already computed and carried in `derived.contributions`.
      const derived = geo.derived as {
        priorRevenue: number;
        currentRevenue: number;
        delta: number;
        effects: { id: string; value: number }[];
        residual: number;
        contributions?: {
          id: string;
          price: number;
          priceLaspeyres: number;
          joint: number;
          volume: number;
          mix: number;
          new: number;
          lost: number;
        }[];
      };
      const contributions = derived.contributions ?? [];
      /** Per-item term of each effect, keyed exactly as `pushEffect` builds it. */
      const term = (
        effectId: string,
        item: NonNullable<typeof derived.contributions>[number],
      ): number | null => {
        switch (effectId) {
          case 'volume':
            return item.volume;
          case 'mix':
            return item.mix;
          case 'volume-mix':
            return item.volume + item.mix;
          case 'price':
            return item.price;
          case 'price-laspeyres':
            return item.priceLaspeyres;
          case 'joint':
            return item.joint;
          case 'new':
            return item.new;
          case 'lost':
            return item.lost;
          default:
            return null;
        }
      };
      return [
        ...derived.effects.map((effect) => ({
          id: `pvm:effect:${effect.id}`,
          kind: 'aggregate' as const,
          op: 'pvm-effect@1',
          inputs: contributions.map((item) => ({
            ref: `${item.id}:${effect.id}`,
            value: term(effect.id, item),
          })),
          output: { raw: effect.value, state: 'value', displayed: '' },
        })),
        {
          id: 'pvm:delta',
          kind: 'derived' as const,
          op: 'difference@1',
          inputs: [
            { ref: 'currentRevenue', value: derived.currentRevenue },
            { ref: 'priorRevenue', value: derived.priorRevenue },
          ],
          output: { raw: derived.delta, state: 'value', displayed: '' },
        },
        {
          id: 'pvm:reconciliation',
          kind: 'reconciliation' as const,
          op: 'pvm-reconciliation@1',
          // residual = delta − Σ effects. The record lists the effects whose
          // residual this is, so the number it reports can be checked against
          // the bars it reconciles.
          inputs: [
            { ref: 'delta', value: derived.delta },
            ...derived.effects.map((effect) => ({ ref: `effect:${effect.id}`, value: effect.value })),
          ],
          output: { raw: derived.residual, state: 'value', displayed: '' },
        },
      ];
    }
    case 'likert': {
      // Two questions a Likert reader cannot check by eye: "why is this row
      // net-negative" and "what is 24% a share of". Both operands of each are
      // in the inputs, so the receipt recomputes without trusting the chart —
      // and the share claim carries the COUNT and the BASE, which is what
      // makes the denominator auditable.
      //
      // A SHARE CLAIM IS EMITTED ONLY WHERE BOTH OPERANDS WERE MEASURED.
      // Two ways that fails, and both behave the same way:
      //   - percent input without `n`: the DENOMINATOR was never declared;
      //   - percent input, with or without `n`: no per-option count exists.
      // A receipt that manufactures the "count" with `?? (share / 100) * base`
      // out of the very share it is supposed to audit would be an identity —
      // it would validate any number an author typed — and it would assert
      // fractional respondents (9.5 of 95 people) into the manifest of a
      // product whose whole promise is that a chart cannot claim what its
      // numbers do not support. A row whose numerator was never counted emits
      // no share claim, exactly as a row whose denominator was never declared
      // emits none; the layout says so on the exhibit
      // (`likert-percent-no-share-receipt`).
      //
      // Percent rows are NOT left without a receipt: `likert-net@1` is a real
      // derivation over real operands and can fail — its inputs are the two
      // side sums and its output is their difference.
      const derived = geo.derived as {
        order: string[];
        base: Record<string, number>;
        shares: Record<string, Record<string, number>>;
        counts?: Record<string, Record<string, number>>;
        pctNegative: Record<string, number>;
        pctPositive: Record<string, number>;
        net: Record<string, number>;
      };
      return derived.order.flatMap((itemId) => {
        const base = derived.base[itemId];
        const rowShares = derived.shares[itemId] ?? {};
        return [
          {
            id: `likert:net:${itemId}`,
            kind: 'derived' as const,
            op: 'likert-net@1',
            inputs: [
              { ref: 'pctPositive', value: derived.pctPositive[itemId] ?? null },
              { ref: 'pctNegative', value: derived.pctNegative[itemId] ?? null },
            ],
            output: { raw: derived.net[itemId] ?? null, state: 'value' as const, displayed: '' },
          },
          ...(base === undefined
            ? []
            : Object.entries(rowShares).flatMap(([optionId, share]) => {
                const count = derived.counts?.[itemId]?.[optionId];
                if (count === undefined) return [];
                return [
                  {
                    id: `likert:share:${itemId}:${optionId}`,
                    kind: 'derived' as const,
                    op: 'share@1',
                    inputs: [
                      { ref: optionId, value: count },
                      { ref: 'base', value: base },
                    ],
                    output: { raw: share, state: 'value' as const, displayed: '' },
                  },
                ];
              })),
        ];
      });
    }
    case 'status': {
      // The cells per state the accessible description prints. Each
      // operand is one drawn cell in that state, so the count is a sum of ones
      // a reader can check cell by cell.
      const derived = geo.derived as StatusDerived;
      const cells = (geo.marks as StatusMarks).cells;
      return derived.stateCounts.map(({ state, count, displayed }) => ({
        id: `status:count:${state}`,
        kind: 'aggregate' as const,
        op: 'sum@1',
        inputs: cells.filter((cell) => cell.state === state).map((cell) => ({ ref: `${cell.row}:${cell.col}`, value: 1, state })),
        output: { raw: count, state: 'value', displayed },
      }));
    }
    case 'waffle': {
      // The cells drawn per segment, as status counts its cells: each operand is one drawn cell, so the count is a sum of ones.
      const derived = geo.derived as WaffleDerived;
      return derived.panels.flatMap((panel) => panel.segments.filter((segment) => segment.cells > 0).map((segment) => ({
        id: `waffle:cells:${panel.categoryId}:${segment.seriesId}`,
        kind: 'aggregate' as const,
        op: 'sum@1',
        inputs: Array.from({ length: segment.cells }, (_, cell) => ({ ref: `${panel.categoryId}:${segment.seriesId}:${cell + 1}`, value: 1 })),
        output: { raw: segment.cells, state: 'value', displayed: segment.reading },
      })));
    }
    case 'pareto': {
      // "Where does 62% come from" has one answer: this item's cumulative
      // total over the grand total. Both operands are in the inputs, so the
      // receipt recomputes without trusting the chart.
      const derived = geo.derived as {
        order: string[];
        total: number;
        cumulative: Record<string, number>;
        cumulativeShare: Record<string, number>;
        populationShare: Record<string, number>;
        populationValue: Record<string, number>;
        vitalFew: string[];
        crossingId?: string;
      };
      return [
        ...derived.order.map((id) => ({
          id: `pareto:cumshare:${id}`,
          kind: 'derived' as const,
          op: 'pareto-cumshare@1',
          inputs: [
            { ref: id, value: derived.cumulative[id] ?? null },
            { ref: 'total', value: derived.total },
          ],
          output: { raw: derived.cumulativeShare[id] ?? null, state: 'value', displayed: '' },
        })),
        // `threshold: false` names no vital few, so there is no share to claim.
        ...(derived.crossingId === undefined ? [] : [{
          id: 'pareto:vitalFew',
          kind: 'aggregate' as const,
          // An output of `vitalFew.length` over `inputs = vitalFew.map(...)`
          // would equal the operand count for every possible dataset, so the
          // record would be an identity that could not fail — and `verify`
          // would report it as a checked claim.
          //
          // The claim the exhibit actually makes is "these causes together
          // reach X% of the total", and that one CAN fail: the operands are the
          // vital few's own values and the grand total, and the output is the
          // cumulative share printed on the canvas.
          op: 'pareto-vital-few-share@1',
          // POPULATION values, not the plotted curve: a vital-few cause can be
          // inside a collapsed rest column and have no plotted entry at all.
          inputs: [
            ...derived.vitalFew.map((id) => ({
              ref: id,
              value: derived.populationValue?.[id] ?? null,
            })),
            { ref: 'total', value: derived.total },
          ],
          output: {
            raw: derived.populationShare?.[derived.crossingId] ?? null,
            state: 'value' as const,
            displayed: '',
          },
        }]),
      ];
    }
    case 'pyramid': {
      // Two receipts, both recomputable without trusting the chart. The share
      // denominator is the GRAND total across both groups, so a reader who
      // re-derives it cannot land on the per-group 100% the type refuses to
      // draw. The ratio is emitted with state 'missing' when the denominator
      // is 0: Infinity is not a ratio, and printing one would be a claim.
      const derived = geo.derived as {
        order: string[];
        groupIds: [string, string];
        values: Record<string, Record<string, number>>;
        grandTotal: number;
        basis: 'count' | 'shareOfTotal';
        shares?: Record<string, Record<string, number>>;
        ratio: Record<string, number | null>;
      };
      const [ga, gb] = derived.groupIds;
      const shareClaims =
        derived.basis === 'shareOfTotal' && derived.shares
          ? derived.order.flatMap((bandId) =>
              derived.groupIds.map((groupId) => ({
                id: `pyramid:share:${bandId}:${groupId}`,
                kind: 'derived' as const,
                op: 'share@1',
                inputs: [
                  { ref: `${bandId}:${groupId}`, value: derived.values[bandId]?.[groupId] ?? null },
                  { ref: 'grandTotal', value: derived.grandTotal },
                ],
                output: {
                  raw: derived.shares![bandId]?.[groupId] ?? null,
                  state: 'value',
                  displayed: '',
                },
              })),
            )
          : [];
      return [
        ...shareClaims,
        ...derived.order.map((bandId) => {
          const value = derived.ratio[bandId] ?? null;
          return {
            id: `pyramid:ratio:${bandId}`,
            kind: 'derived' as const,
            op: 'ratio@1',
            inputs: [
              { ref: `${bandId}:${ga}`, value: derived.values[bandId]?.[ga] ?? null },
              { ref: `${bandId}:${gb}`, value: derived.values[bandId]?.[gb] ?? null },
            ],
            output: { raw: value, state: value === null ? 'missing' : 'value', displayed: '' },
          };
        }),
      ];
    }
    case 'funnel': {
      // The operands were present and both were written as `null` — a receipt
      // shaped like a receipt with nothing in it. `stageTotals` is right there
      // in the same `derived` object the rate was read from.
      const derived = geo.derived as {
        stageTotals: Record<string, number>;
        conversions: { fromId: string; toId: string; rate: number }[];
        cumulativeCvrs?: { stageId: string; rate: number | null }[];
      };
      const firstStage = derived.cumulativeCvrs?.[0]?.stageId;
      return [...derived.conversions.map((c) => ({
        id: `funnel:conv:${c.fromId}:${c.toId}`,
        kind: 'derived' as const,
        op: 'funnel-conversion@1',
        inputs: [
          { ref: c.fromId, value: derived.stageTotals?.[c.fromId] ?? null },
          { ref: c.toId, value: derived.stageTotals?.[c.toId] ?? null },
        ],
        output: { raw: c.rate, state: 'value', displayed: '' },
      })), ...(derived.cumulativeCvrs ?? []).filter(c => c.rate !== null).map(c => ({
        id: `funnel:total-cvr:${c.stageId}`,
        kind: 'derived' as const,
        op: 'funnel-conversion@1',
        inputs: [
          { ref: firstStage!, value: derived.stageTotals[firstStage!] ?? null },
          { ref: c.stageId, value: derived.stageTotals[c.stageId] ?? null },
        ],
        output: { raw: c.rate, state: 'value', displayed: '' },
      }))];
    }
    case 'variance': {
      // A variance chart IS its deltas — there is no other number on it. Both
      // operands of every delta were already in `derived` (`ac` and `ref`, the
      // two bars the reader compares by eye) and neither reached the receipt:
      // 84 claims across 8 fixtures, every one of them `inputs: []`.
      //
      // The rounding is part of the op, not a tolerance: `variance-delta@1` is
      // defined as round2(ac − ref), because that is what the engine files and
      // what the exhibit prints. Recording the unrounded operands and an op
      // that ignores the rounding would need a fudge factor at verify time,
      // and a fudge factor is where a real defect hides.
      const derived = geo.derived as {
        ac: Record<string, number | null>;
        ref: Record<string, number | null>;
        deltaAbs: Record<string, number | null>;
        deltaPct: Record<string, number | null>;
      };
      const operands = (id: string) => [
        { ref: `ac:${id}`, value: derived.ac?.[id] ?? null },
        { ref: `ref:${id}`, value: derived.ref?.[id] ?? null },
      ];
      return [
        ...Object.entries(derived.deltaAbs).map(([id, raw]) => ({
          id: `var:abs:${id}`,
          ...(geo.scene.some(node => node.id === `nm:${id}`) ? { nodeId: `nm:${id}` } : {}),
          kind: 'derived' as const,
          op: 'variance-delta@1',
          inputs: operands(id),
          output: { raw, state: raw === null ? 'missing' : 'value', displayed: '' },
        })),
        ...Object.entries(derived.deltaPct).map(([id, raw]) => ({
          id: `var:pct:${id}`,
          kind: 'derived' as const,
          op: 'variance-delta-pct@1',
          inputs: operands(id),
          output: { raw, state: raw === null ? 'missing' : 'value', displayed: '' },
        })),
      ];
    }
    case 'kpi': {
      const derived = geo.derived as KpiDerived;
      const comparisons = derived.comparisons ?? [];
      const deltaClaims: ClaimRecordV1[] = comparisons.map((comparison, index) => ({
        id: `kpi:delta:${index}`,
        kind: 'derived',
        op: `${comparison.mode === 'absolute' ? 'difference' : 'percentDelta'}@1`,
        inputs: [
          { ref: 'value', value: comparison.value },
          { ref: `${comparison.source === 'delta' ? 'delta' : `compare[${index}]`}.vs`, value: comparison.vs },
        ],
        output: {
          // A refused relative change is recorded as the absolute change the
          // card shows (mode 'absolute', state 'ref-nonpositive').
          raw: comparison.mode === 'absolute' ? comparison.deltaAbs : comparison.deltaPct,
          state: comparison.state,
          displayed: comparison.displayed,
        },
        nodeId: comparison.nodeId,
      }));
      const attainment = derived.attainment;
      if (!attainment) return deltaClaims;
      return [
        ...deltaClaims,
        {
          id: 'kpi:attainment',
          kind: 'derived',
          op: 'percentOf@1',
          inputs: [
            { ref: 'value', value: attainment.value },
            { ref: 'attainment.vs', value: attainment.vs },
          ],
          output: { raw: attainment.pct, state: attainment.state, displayed: attainment.displayed },
          nodeId: attainment.nodeId,
        },
      ];
    }
    default:
      return []; // artifact + source binding still applies
  }
}
