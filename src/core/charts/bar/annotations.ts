import { valueLineLabelsOn } from '../labelOn';
import { strokeToken, dashToken } from '../../theme';
/**
 * Standard bar phase 4, first half: the annotations bar draws itself, before
 * the solver. valueLines run vertically and indicator100 sits above the plot
 * (the shared runAnnotatePass draws both horizontally, for columns). Each
 * brings its nodes, its claims in a fresh index, and its label request.
 */

import { namedLineText } from '../../annotateParts';
import { formatterFromExample } from '../../formatSpec';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import type { drawBarIndicator } from './rowOptions';
import type { LintWarning, PlacedAnnotation, SceneNode } from '../../types/scene';
import { valueLineValue } from './domain';
import type { BarArea, BarDomain } from './model';
import { composedTextRole } from '../../textRole';
import { SHARES_OF_ONE_WHOLE_FIX } from '../../stackAdds';
import { percentLevels } from '../../annotatePass';

export interface BarLocalAnnotations {
  nodes: SceneNode[];
  claims: OccupiedIndex;
  requests: LabelRequest[];
  placed: PlacedAnnotation[];
}

export function layoutBarLocalAnnotations(domain: BarDomain, area: BarArea, warnings: LintWarning[], indicator?: typeof drawBarIndicator): BarLocalAnnotations {
  const { size, measure, fmt, statFmt, meanValue } = domain;
  const { plot, x, strongFont } = area;
  const out: BarLocalAnnotations = {
    nodes: [],
    claims: createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height }),
    requests: [],
    placed: [],
  };
  const { nodes, claims, requests, placed } = out;
  const percent = domain.variant === 'stacked100' || domain.options.unit === '%' || percentLevels(domain.dataSeries.map(series => ({ vals: series.cells })));
  for (const ann of domain.localAnns) {
    const id = ann.id!;
    const annFmt = ann.format ? formatterFromExample(ann.format, domain.options.locale?.language) : fmt;
    if (ann.kind === 'valueLine') {
      const v = valueLineValue(ann, meanValue);
      // Same fail-closed trace the shared annotate pass emits (annotate.ts):
      // no plotted value ⇒ no mean ⇒ no line, and the reason is visible.
      if (v === undefined) {
        warnings.push({
          code: 'no-mean',
          severity: 'warn',
          message: `valueLine '${id}': ${domain.meanMissing ?? 'no mean available'}`,
          ...(domain.meanMissing ? { suggest: SHARES_OF_ONE_WHOLE_FIX } : {}),
        });
        continue;
      }
      const vx = x(v);
      const lineId = `ann:${id}:line`;
      nodes.push({
        t: 'line',
        id: lineId,
        x1: vx,
        y1: plot.y,
        x2: vx,
        y2: plot.y + plot.h,
        stroke: { token: 'ink' },
        width: strokeToken(domain.theme, 'rule'),
        dash: dashToken(domain.theme, 'reference'),
        owner: { annotationId: id },
        part: 'valueLine',
      });
      claims.claim({ x: vx - 1, y: plot.y, w: 2, h: plot.h }, 'annotation', { annotationId: id }, 'referenceLine');
      const isMean = ann.value === undefined || ann.value === 'mean';
      // A mean is a derived statistic: without an authored annotation format
      // it lifts past the exhibit raster (statFmt) instead of rounding to a
      // different number than it is.
      const meanFmt = ann.format ? annFmt : statFmt;
      // Without a format a typed reference is a late value of the plot's set.
      const valueText = isMean || id === domain.averageMarkerId ? meanFmt(v) : percent && !ann.format && !domain.options.format ? domain.valueSpec.fmtPercent(v) : annFmt(v);
      const labelText = ann.label === false || !valueLineLabelsOn(domain.options) ? '' : ann.label !== undefined ? namedLineText(ann.label, valueText, v, id) : isMean ? `${domain.options.strings!.average} ${valueText}` : valueText;
      if (labelText) {
        const lines = labelText.split('\n');
        const w = Math.max(...lines.map((l) => measure(l, strongFont).width));
        const h = lines.length * measure('X', strongFont).height;
        requests.push({
          id: `valueLine:${id}`,
          kind: 'valueLine',
          role: composedTextRole(labelText),
          owner: { annotationId: id },
          text: labelText,
          lines,
          typeRole: 'label', font: strongFont,
          priority: ann.priority ?? PRIORITY.valueLine,
          candidates: [
            { slot: 'aboveLine', rect: { x: vx - w / 2, y: plot.y - h - 6, w, h }, penalty: 0 },
            { slot: 'aboveLineLeft', rect: { x: vx - w - 4, y: plot.y - h - 6, w, h }, penalty: 1 },
            { slot: 'aboveLineRight', rect: { x: vx + 4, y: plot.y - h - 6, w, h }, penalty: 2 },
          ],
        });
      }
      placed.push({
        id,
        kind: 'valueLine',
        computedText: labelText,
        valueText,
        nodeIds: [lineId],
        labelId: labelText ? `valueLine:${id}` : undefined,
      });
      continue;
    }
    indicator?.(domain, area, ann, out);
  }
  return out;
}
