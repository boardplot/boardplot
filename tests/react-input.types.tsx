import type { RangeChartData } from '../src/core/types';
import type { ColumnOptions } from '../src/core/types/options';
import { ColumnChart } from '../src/react/charts/column';
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
