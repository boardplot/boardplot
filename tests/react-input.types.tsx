import type { RangeChartData } from '../src/core/types';
import type { TextMeasurer } from '../src/core/text';
import type { ColumnOptions } from '../src/core/types/options';
import { ColumnChart } from '../src/react/charts/column';
import { BulletChart } from '../src/react/charts/bullet';
import { CohortChart } from '../src/react/charts/cohort';
import { CreativeChart } from '../src/react/charts/creative';
import { DiagramChart } from '../src/react/charts/diagram';
import { DimSwitchChart } from '../src/react/charts/dimswitch';
import { GanttChart } from '../src/react/charts/gantt';
import { KpiChart } from '../src/react/charts/kpi';
import { LikertChart } from '../src/react/charts/likert';
import { ParetoChart } from '../src/react/charts/pareto';
import { PvmChart } from '../src/react/charts/pvm';
import { PyramidChart } from '../src/react/charts/pyramid';
import { SparklineChart } from '../src/react/charts/sparkline';
import { StatusChart } from '../src/react/charts/status';
import { TreemapChart } from '../src/react/charts/treemap';
import type { PrepareChartRequest } from '../src/react/prepare';
import { BoardplotChart, type BoardplotSpec } from '../src/react/spec';
import { useChartLayout } from '../src/react/useChartLayout';
import imported from './fixtures/render-overwrite.json';

const data = {
  categories: ['North', 'South'],
  series: [{ id: 'sales', values: [{ categoryId: 'South', value: 95 }, { categoryId: 'North', value: 120 }] }],
};

// A column's JSON shorthands compile in React and its layout APIs while a series still needs an id.
export function TypedColumn() {
  const request = { type: 'column', data } satisfies PrepareChartRequest<RangeChartData>;
  useChartLayout<RangeChartData, ColumnOptions>(request);
  useChartLayout<RangeChartData, ColumnOptions>(request.type, data);
  // @ts-expect-error A series needs an id.
  void <ColumnChart data={{ categories: ['North'], series: [{ values: [120] }] }} />;
  return <ColumnChart data={data} />;
}

// The opt-in spec type catches a misspelled chart name while the component still takes external JSON.
export function SpecInputs({ externalSpec }: { externalSpec: unknown }) {
  const chart = { type: 'column', data } satisfies BoardplotSpec;
  const envelope = { version: 1, charts: [{ ...chart, name: 'sales' }] } satisfies BoardplotSpec;
  // @ts-expect-error 'columns' is not a chart type.
  void ({ type: 'columns', data } satisfies BoardplotSpec);
  // @ts-expect-error Use the scenario code 'AC' in a typed spec.
  void ({ type: 'column', data: { ...data, series: [{ id: 'sales', values: [120, 95], scenario: 'ACT' }] } } satisfies BoardplotSpec);
  return <>
    <BoardplotChart spec={envelope} />
    <BoardplotChart spec={externalSpec} />
    <BoardplotChart spec={imported.spec} />
  </>;
}

// A wrapper that is generic over its data type and forwards it to the layout hook keeps compiling.
export function GenericLayout<D extends RangeChartData>({ data }: { data: D }) {
  return useChartLayout<D, ColumnOptions>('column', data);
}

// Rows and columns compile only on a chart type that has a rows mapping. The others refused them at run time only.
export function RowsForm() {
  const rows = [{ month: 'Jan', sales: 1 }];
  const columns = { category: 'month', value: 'sales' } as const;
  // @ts-expect-error bullet has no rows mapping.
  void <BulletChart rows={rows} columns={columns} />;
  // @ts-expect-error cohort has no rows mapping.
  void <CohortChart rows={rows} columns={columns} />;
  // @ts-expect-error creative has no rows mapping.
  void <CreativeChart rows={rows} columns={columns} />;
  // @ts-expect-error diagram has no rows mapping.
  void <DiagramChart rows={rows} columns={columns} />;
  // @ts-expect-error dimswitch has no rows mapping.
  void <DimSwitchChart rows={rows} columns={columns} />;
  // @ts-expect-error gantt has no rows mapping.
  void <GanttChart rows={rows} columns={columns} />;
  // @ts-expect-error kpi has no rows mapping.
  void <KpiChart rows={rows} columns={columns} />;
  // @ts-expect-error likert has no rows mapping.
  void <LikertChart rows={rows} columns={columns} />;
  // @ts-expect-error pareto has no rows mapping.
  void <ParetoChart rows={rows} columns={columns} />;
  // @ts-expect-error pvm has no rows mapping.
  void <PvmChart rows={rows} columns={columns} />;
  // @ts-expect-error pyramid has no rows mapping.
  void <PyramidChart rows={rows} columns={columns} />;
  // @ts-expect-error sparkline has no rows mapping.
  void <SparklineChart rows={rows} columns={columns} />;
  // @ts-expect-error status has no rows mapping.
  void <StatusChart rows={rows} columns={columns} />;
  // @ts-expect-error treemap has no rows mapping.
  void <TreemapChart rows={rows} columns={columns} />;
  return <ColumnChart rows={rows} columns={columns} />;
}

// The generic component takes the wrapper props and a text measurer, like the chart components.
export function SpecHostProps({ externalSpec }: { externalSpec: unknown }) {
  const measure: TextMeasurer = (text, font) => ({ width: text.length * font.size * 0.6, height: font.size * 1.2, ascent: font.size, descent: font.size * 0.2 });
  return <BoardplotChart spec={externalSpec} className="card" style={{ margin: 8 }} measure={measure} rows={[{ month: 'Jan', sales: 1 }]} columns={{ category: 'month', value: 'sales' }} />;
}
