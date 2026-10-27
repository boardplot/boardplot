'use client';

import { BoardplotChart } from 'boardplot/react/spec';
import { ColumnChart } from 'boardplot/react/column';
import { TableChart } from 'boardplot/react/table';

export default function PreparedCharts({ spec, columnRequest, column, tableData, tableOptions, table }) {
  return <>
    <section aria-label="Weekly orders" data-example="column">
      <ColumnChart data={columnRequest.data} {...columnRequest.options} prepared={column} />
    </section>
    {/* The spec entry links no chart engine: it requests the one this spec
        names, draws the busy placeholder in the server pass, and attaches the
        same prepared output once the chunk is in the browser. */}
    <section aria-label="Weekly orders from a spec" data-example="spec">
      <BoardplotChart spec={spec} prepared={column} />
    </section>
    <section aria-label="Orders by region" data-example="table">
      <TableChart data={tableData} {...tableOptions} prepared={table} />
    </section>
  </>;
}
