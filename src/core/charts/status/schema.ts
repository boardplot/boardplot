/** Status data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, cellSchema as valueCellSchema, idSchema, keyPositionSchema, refusedBaseOptions, sideKeyError } from '../../schema/shared';
import type { StatusData, StatusOptions } from './layout';

const rowSchema = z.strictObject({
  id: idSchema.describe("Unique matrix-row identity referenced by cells."),
  label: z.string().optional().describe("Displayed matrix-row name; defaults to its id."),
});

const columnSchema = z.strictObject({
  id: idSchema.describe("Unique matrix-column identity referenced by cells."),
  label: z.string().optional().describe("Displayed matrix-column name; defaults to its id."),
});

const cellSchema = z.strictObject({
  row: idSchema.describe("Id of the matrix row containing this cell."),
  col: idSchema.describe("Id of the matrix column containing this cell."),
  state: idSchema.describe("Id of a state declared in options.states."),
  value: valueCellSchema.optional().describe("Optional value printed under the state label, or alone when the cell is too small for both. A value object can set its own format, such as { number: 97.5, format: '1.0%' }."),
});

export const statusDataSchema = z
  .strictObject({
    rows: z.array(rowSchema).min(1).describe("Matrix rows displayed in the supplied order."),
    columns: z.array(columnSchema).min(1).describe("Matrix columns displayed in the supplied order."),
    cells: z.array(cellSchema).describe("Unique row/column bindings to declared states; unbound positions remain missing."),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.rows, ['rows'], {
      name: 'row',
      keys: 'cell bindings and scene identities',
    });
    addDuplicateIdIssues(ctx, data.columns, ['columns'], {
      name: 'column',
      keys: 'cell bindings and scene identities',
    });
    const rowIds = new Set(data.rows.map((row) => row.id));
    const columnIds = new Set(data.columns.map((column) => column.id));
    const bindings = new Set<string>();

    data.cells.forEach((cell, index) => {
      if (!rowIds.has(cell.row)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index, 'row'],
          message: `unknown row '${cell.row}'`,
        });
      }
      if (!columnIds.has(cell.col)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index, 'col'],
          message: `unknown column '${cell.col}'`,
        });
      }
      const key = `${cell.row}\u0000${cell.col}`;
      if (bindings.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: `duplicate cell binding '${cell.row}/${cell.col}'`,
        });
      }
      bindings.add(key);
    });
  }) as unknown as z.ZodType<StatusData>;

const themeRoleSchema = z
  .string()
  .regex(
    /^(?:good|bad|warn|neutral|neutralLight|highlight|total|others|series-[1-9]\d*|status-[A-Za-z0-9][A-Za-z0-9_-]*)$/,
    'role must be a semantic theme role such as good, warn, highlight, series-1, or status-open',
  );

const stateSchema = z.strictObject({
  id: idSchema.describe("Unique state identity referenced by matrix cells."),
  label: z.string().min(1).describe("Visible state name used by the legend and the accessible description. The description lists each state with its cell count, as 'On track 12', then 'No status 3' for empty cells; the reading carries each count as a derived claim with that text."),
  tone: z.union([
    z.enum(['good', 'bad', 'neutral', 'warn', 'info']),
    z.strictObject({ role: themeRoleSchema.describe("Named semantic theme color role for this state.") }),
  ]).describe("Semantic verdict tone, or an explicit theme role for the state fill."),
  pattern: z.literal('hatch45').optional().describe("Optional 45-degree hatching to distinguish this state beyond color."),
});

// 'right' is refused as on every type: a key beside the plot takes its width.
const legendSchema = z.union([
  z.enum(['top', 'bottom', 'none']),
  z.strictObject({ position: keyPositionSchema.describe("Place the categorical state legend at the top or bottom.") }),
], { error: sideKeyError });

export const statusOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('status'))
  .safeExtend({
    labels: baseOptionsSchema.shape.labels.describe("False hides cell state and value labels. Row and stage names remain. series: false hides row names; category: false hides stage names. When the state key is drawn and colour or hatch tells the states apart, the key names them and the cells print no state names, unless labelDensity is 'full'; then the names print at the largest type step where all of them fit, and if no step fits they stay off with a label-hidden warning and one reading.omissions entry per state. Otherwise state names print in every bound cell only when all of them fit; else the key names states."),
    states: z
      .array(stateSchema)
      .min(1, { message: 'status requires at least one declared state' })
      .max(6, {
        message: 'status supports at most 6 states; bucket related verdicts into 6 or fewer states',
      }).describe("One to six declared categorical states defining cell meaning, legend labels and paint."),
    columnLabels: z.enum(['top', 'bottom']).optional().describe("Column-caption position; defaults to top."),
    legend: legendSchema.optional().describe("State-legend placement, or none to suppress the legend while cells name every used state. A required key remains when cell state names are not drawn, including a one-state matrix. A grid panel's explicit none leaves the state key with the host."),
  })
  .superRefine((options, ctx) => {
    addDuplicateIdIssues(ctx, options.states, ['states'], {
      name: 'state',
      keys: 'cell tones, legends and scene identities',
    });
  }) as unknown as z.ZodType<StatusOptions>;
