/** The `categoryLabels` option of the vertical column family (column, combo, pareto). */

import * as z from 'zod';

export const categoryLabelsSchema = z
  .enum(['axis', 'staircase'])
  .optional()
  .describe(
    "Where category names go: 'axis' (default), the row under the axis; 'staircase', each name over the lower columns beside its own, one step lower than the last, with a vertical leader to its column (column, combo, pareto). Without a seat for every name the row returns and staircase-labels-fallback warns.",
  );
