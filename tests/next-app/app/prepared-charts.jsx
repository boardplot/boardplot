'use client';

import { BoardplotChart } from 'boardplot/react/spec';
import { ColumnChart } from 'boardplot/react/column';
import { TableChart } from 'boardplot/react/table';

export default function PreparedCharts({ spec, columnRequest, column, tableData, tableOptions, table }) {
  return <>
    <section aria-label="Weekly orders" data-example="column">
      <ColumnChart data={columnRequest.data} {...columnRequest.options} prepared={column} />
    </section>
    {/* The spec entry links no chart engine: its server pass draws the
        prepared output as a picture, and the chart of the type takes its place
        with the same drawing once the chunk this spec names is in the browser. */}
    <section aria-label="Weekly orders from a spec" data-example="spec">
      <BoardplotChart spec={spec} prepared={column} />
    </section>
    <section aria-label="Orders by region" data-example="table">
      <TableChart data={tableData} {...tableOptions} prepared={table} />
    </section>
  </>;
}
