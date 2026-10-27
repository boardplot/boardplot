import { parseChartSpec, prepareChart } from 'boardplot/react/prepare';
import PreparedCharts from './prepared-charts';

// These illustrative values are safe to send to the browser with the prepared output.
const spec = {
  version: 1,
  charts: [{
    name: 'weekly-orders',
    type: 'column',
    data: {
      categories: ['Week 1', 'Week 2', 'Week 3'],
      series: [{ id: 'orders', label: 'Orders', values: [24, 32, 28] }],
    },
    options: { title: 'Weekly orders', size: { width: 720, height: 405 } },
  }],
};

const tableData = {
  columns: [{ id: 'name', kind: 'rowLabel', label: 'Region' }, { id: 'orders', kind: 'value', label: 'Orders' }],
  rows: [{
    id: 'all', label: 'All regions', cells: { orders: 84 }, children: [
      { id: 'north', label: 'North', cells: { orders: 44 } },
      { id: 'south', label: 'South', cells: { orders: 40 } },
    ],
  }],
};
const tableOptions = {
  title: 'Orders by region',
  size: { width: 720, height: 405 },
  expansion: { depth: 0 },
};

export default async function Page() {
  // Through JSON, because a request travels to a client component as data.
  const columnRequest = JSON.parse(JSON.stringify((await parseChartSpec(spec)).request));
  const column = await prepareChart(columnRequest);
  const table = await prepareChart({ type: 'table', data: tableData, options: tableOptions });
  return <main style={{ maxWidth: 760, margin: '32px auto', padding: '0 16px' }}>
    <h1>Charts prepared on the server</h1>
    <p>The column chart and table attach to their prepared output. Expand the table to see its regional rows.</p>
    <PreparedCharts spec={spec} columnRequest={columnRequest} column={column} tableData={tableData} tableOptions={tableOptions} table={table} />
  </main>;
}
