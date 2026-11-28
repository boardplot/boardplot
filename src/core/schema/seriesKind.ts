/** `series[].kind` and `series[].axis` on plain line and column: combo-shaped input, tolerated. */

import * as z from 'zod';

const KINDS = ['column', 'line', 'area'] as const;
const AXES = ['primary', 'secondary'] as const;
const SECOND_AXIS_GUIDANCE = "Use type 'combo' with kind: 'line' or 'area' and axis: 'secondary' on the series that needs a second value scale. The combo chart draws the scale and warns dual-axis.";

/** Accepted for combo-shaped data. Ignored here. A kind that differs from the chart type is refused. */
export const seriesKindField = z.enum(KINDS).optional().describe('Accepted for combo-shaped data. Ignored here. A kind that differs from the chart type is refused.');
export const seriesAxisField = z.enum(AXES).optional().describe(
  `On column charts, only 'primary' is accepted and it has no effect. ${SECOND_AXIS_GUIDANCE}`,
);
export const lineSeriesAxisField = seriesAxisField.describe(
  `Line charts draw all series on one scale and report secondary-axis-ignored for 'secondary'. ${SECOND_AXIS_GUIDANCE}`,
);

/** Refuses a mismatched `kind` on line and column charts and `axis: 'secondary'` on column charts. */
export function addSeriesKindIssues(
  ctx: z.RefinementCtx,
  series: { id: string; kind?: string; axis?: string }[],
  own: 'line' | 'column',
  basePath: (string | number)[] = ['series'],
): void {
  series.forEach((entry, index) => {
    if (entry.kind !== undefined && entry.kind !== own) {
      ctx.addIssue({
        code: 'custom',
        path: [...basePath, index, 'kind'],
        message:
          own === 'line' && entry.kind === 'area'
            ? `series '${entry.id}': kind 'area' is not a line kind. Set options.variant to 'area' or 'stacked-area', or use type combo.`
            : `series '${entry.id}': kind '${entry.kind}' belongs to a combo chart. Remove kind or use type combo.`,
      });
    }
    if (own === 'column' && entry.axis === 'secondary') {
      ctx.addIssue({
        code: 'custom',
        path: [...basePath, index, 'axis'],
        message: `series '${entry.id}': axis 'secondary' needs a second axis. Remove axis to keep one scale. ${SECOND_AXIS_GUIDANCE}`,
      });
    }
  });
}
