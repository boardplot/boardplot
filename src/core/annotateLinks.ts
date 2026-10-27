import { emphasisWeight, strokeToken } from './theme';
import type { Theme } from './types/theme';
/**
 * Comparisons on charts without a shared value axis: a margin bracket beside
 * the rows it compares. Its length carries no value.
 */
import type { AnchorResolution } from './annotate';
import type { ArmDrawPass } from './annotateArms';
import { PRIORITY } from './label/solver';
import { arrowHeadPath, arrowShaftEnd } from './svgPath';
import { computedTextRole } from './textRole';
import type { AnnotationDerivation, PlacedAnnotation, PlacedLabel, SceneNode } from './types/scene';
import { maxOf } from './arrays';

/**
 * A chart's own drawing of CAGR and difference furniture, in place of the
 * value-axis arms. The pass hands it the computed text; it places the label
 * through the solver and returns its nodes once the labels are solved.
 */
export interface ComparisonLayout {
  draw(
    pass: ArmDrawPass, a: AnchorResolution, b: AnchorResolution, text: string,
    id: string, kind: 'cagr' | 'diff', computed: string, derivation?: AnnotationDerivation,
  ): void;
  emit(labels: PlacedLabel[]): SceneNode[];
  /**
   * The label sits away from its marks, so it names what it measures: the
   * series it reads and, when the two ends differ, the period.
   */
  namesSpan?: boolean;
}

/**
 * Tick from the spine toward the data, label gap, and the gap between lanes.
 * The tick is 16 px at both ends: the arrow end keeps a visible shaft before
 * its head (the minimum arm, as on a CAGR arm), and the plain end matches it.
 */
const BRACKET_TICK = 16;
const BRACKET_LABEL_GAP = 6;
const BRACKET_LANE_GAP = 10;
const BRACKET_ARROW = 5;
/** Half height of a one-row bracket whose anchor names no row. */
const BRACKET_HALF_ROW = 8;

/** Where each side's strip begins: the x of the tick ends nearest the data. */
interface BracketMargins {
  left?: number;
  right?: number;
}

interface MarginBracket {
  side: 1 | -1;
  tickEnd: number;
  spine: number;
  from: number;
  to: number;
  /** Two rows: an arrowhead at the `to` end. One row: a plain bracket spanning it. */
  arrow: boolean;
  annotation: PlacedAnnotation;
  lo: number;
  hi: number;
  outer: number;
}

const rowMiddle = (anchor: AnchorResolution): number => (anchor.row ? anchor.row.y + anchor.row.h / 2 : anchor.y);

/**
 * A CAGR or difference between marks without a shared value axis sits
 * as a bracket in a side margin, never across the data. Its ends sit at the
 * middles of the two anchored rows, the arrowhead at the `to` row; two
 * anchors in one row get a bracket spanning that row. Brackets whose spans
 * overlap take lanes outward, and each label sits beside its spine.
 *
 * The chart keeps the margins clear of marks and labels. `need()` reports
 * how far the brackets reach beyond each margin's start, so a chart that
 * reserved too little lays out once more with that much.
 */
export function marginBracketLayout(theme: Theme, margins: BracketMargins, options: { wrapLead?: boolean } = {}) {
  const brackets: MarginBracket[] = [];
  const need = { left: 0, right: 0 };
  const sideFor = (x: number): 1 | -1 => {
    if (margins.right === undefined) return -1;
    if (margins.left === undefined) return 1;
    return Math.abs(x - margins.right) <= Math.abs(x - margins.left) ? 1 : -1;
  };
  const layout: ComparisonLayout & { need: () => { left: number; right: number } } = {
    namesSpan: true,
    need: () => ({ ...need }),
    draw(pass, a, b, text, id, kind, computed, derivation) {
      const { input } = pass;
      const font = { family: input.theme.type.family, ...input.theme.type.label, weight: emphasisWeight(input.theme) };
      // `wrapLead` puts the named span on its own line over the
      // figure ("Agree FY21–FY23:" / "+20.0% p.a."), so a bracket needs the
      // width of its longer line only.
      const cut = options.wrapLead ? text.indexOf(': ') : -1;
      const lines = cut > 0 ? [text.slice(0, cut + 1), text.slice(cut + 2)] : [text];
      const lineSizes = lines.map((line) => input.measure(line, font));
      const size = { width: Math.max(...lineSizes.map((line) => line.width)), height: lineSizes.reduce((sum, line) => sum + line.height, 0) };
      const side = sideFor(b.x);
      const inner = (side === 1 ? margins.right : margins.left)!;
      const oneRow = Math.abs(rowMiddle(a) - rowMiddle(b)) < 1;
      const row = a.row ?? b.row;
      const [from, to] = !oneRow ? [rowMiddle(a), rowMiddle(b)]
        : row ? [row.y + 2, row.y + row.h - 2] : [a.y - BRACKET_HALF_ROW, a.y + BRACKET_HALF_ROW];
      const mid = (from + to) / 2;
      const lo = Math.min(from, to, mid - size.height / 2);
      const hi = Math.max(from, to, mid + size.height / 2);
      const offset = Math.max(0, maxOf(brackets
        .filter((other) => other.side === side && other.hi > lo - 2 && other.lo < hi + 2)
        .map((other) => other.outer + BRACKET_LANE_GAP)));
      const tickEnd = inner + side * offset;
      const spine = tickEnd + side * BRACKET_TICK;
      const outer = offset + BRACKET_TICK + BRACKET_LABEL_GAP + size.width;
      need[side === 1 ? 'right' : 'left'] = Math.max(need[side === 1 ? 'right' : 'left'], outer);
      const labelX = side === 1 ? spine + BRACKET_LABEL_GAP : spine - BRACKET_LABEL_GAP - size.width;
      pass.labelRequests.push({
        id: `annotation:${id}`, kind: 'annotation', role: computedTextRole(text, computed), owner: { annotationId: id },
        text, lines, typeRole: 'label', font, priority: pass.priority ?? PRIORITY.valueLine,
        candidates: [{ slot: 'bracket', rect: { x: labelX, y: mid - size.height / 2, w: size.width, h: size.height }, penalty: 0 }],
      });
      const annotation: PlacedAnnotation = { id, kind, computedText: computed, nodeIds: [], labelId: `annotation:${id}`, ...(derivation ? { derivation } : {}) };
      pass.placed.push(annotation);
      const owner = { annotationId: id };
      const x0 = Math.min(tickEnd, spine);
      input.occupied.claim({ x: x0 - 1, y: Math.min(from, to) - 1, w: BRACKET_TICK + 2, h: Math.abs(to - from) + 2 }, 'annotation', owner, 'bracket');
      brackets.push({ side, tickEnd, spine, from, to, arrow: !oneRow, annotation, lo, hi, outer });
    },
    emit(labels) {
      const nodes: SceneNode[] = [];
      for (const bracket of brackets) {
        const { annotation, side, tickEnd, spine, from, to, arrow } = bracket;
        const label = labels.find((l) => l.id === annotation.labelId);
        if (!label || label.hidden) continue;
        const owner = { annotationId: annotation.id };
        const pathId = `ann:${annotation.id}:bracket`;
        const end = arrow ? tickEnd + side * arrowShaftEnd(BRACKET_ARROW, strokeToken(theme, 'rule')) : tickEnd;
        nodes.push({
          t: 'path', id: pathId, d: `M${tickEnd} ${from}L${spine} ${from}L${spine} ${to}L${end} ${to}`,
          stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner, part: 'bracket',
        });
        annotation.nodeIds.push(pathId);
        if (arrow) {
          const headId = `ann:${annotation.id}:comparisonHead`;
          nodes.push({ t: 'path', id: headId, d: arrowHeadPath({ x: tickEnd, y: to }, side === 1 ? Math.PI : 0, BRACKET_ARROW), fill: { token: 'ink' }, owner, part: 'arrowHead' });
          annotation.nodeIds.push(headId);
        }
      }
      return nodes;
    },
  };
  return layout;
}
