import type { Geometry } from './types/scene';
import type { RenderTarget } from './types/options';
import type { PresentationInfo } from './types/sizing';
import { naturalOutputSize, targetFloorsPx } from './target';
import { typeWidthClass, type TypeWidthClass } from './theme';
import type { Theme } from './types/theme';
import { TABLE_HEAD_PARTS, tableHeadFloorPx } from './typeFloors';

/** Paint values are excluded; anything that can change layout remains. */
export function themeGeometryTokens(theme: Theme, target?: RenderTarget): unknown {
  return {
    ...(target === undefined ? {} : { target }),
    scenario: theme.scenario,
    pattern: { ...theme.pattern, hatchColor: theme.pattern.hatchColor ?? 'segment' },
    stroke: theme.stroke,
    dash: theme.dash,
    type: theme.type,
    space: theme.space,
    surface: theme.surface,
    // Label ink and the grid dash are baked into the scene, so a switch relayouts as their siblings do.
    labels: theme.labels,
    valueAxis: theme.valueAxis,
    // The outline and edge switches are recomputed by a repaint (repaintSeparation, decideFillEdges);
    // every other mark key (marker, radius, tint, caret, bar label side) is baked into the layout.
    marks: theme.marks && (({ restOutline: _r, sliceOutline: _s, othersOutline: _o, contrastEdge: _c, ...rest }) => rest)(theme.marks),
    // Table sizes, pads, weights, rules and glyphs are geometry; its inks, rule ink and bar grounds are colour.
    table: theme.table && (({ inks: _inks, ruleInk: _ruleInk, bar: _bar, ...rest }) => rest)(theme.table),
    legend: theme.legend?.auto ?? false,
    seriesOverflow: theme.color.seriesOverflow ?? 'repeatLast',
    seriesCount: theme.color.series.length,
  };
}

/** Output metadata from the final layout. Text roles are supplied by the text lanes. */
export function presentationInfo(geometry: Geometry<object, object>, target: RenderTarget, inheritedClass?: TypeWidthClass, textScale = 1): PresentationInfo {
  const floors = targetFloorsPx(target);
  let minimumScale = 0.9;
  for (const node of geometry.scene) {
    if (node.t !== 'text' || node.lines.every(line => line.length === 0) || node.opacity === 0) continue;
    // A table head is held to the table head floor wherever the table is drawn.
    const tableHead = TABLE_HEAD_PARTS.has(node.part ?? '');
    minimumScale = Math.max(minimumScale, (tableHead ? tableHeadFloorPx(target) : floors[node.typeRole ?? 'label']) / node.font.size);
  }
  return { target,
    typeClass: geometry.type === 'kpi' || geometry.type === 'bullet' ? 'M' : inheritedClass ?? typeWidthClass(geometry.size.width),
    naturalSize: naturalOutputSize(target, geometry.size),
    minDisplayWidth: geometry.size.width * minimumScale,
    ...(textScale === 1 ? {} : { textScale }),
  };
}
