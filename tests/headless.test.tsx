// @vitest-environment jsdom

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getFixtures } from '../src/fixtures';
import { listCharts } from '../src/core/registry';
import { claimsForChart } from '../src/core/claims';
import { resolveChartRequest, type ChartRequest } from '../src/core/request';
import { layoutContainerRequest } from '../src/react/containerLayout';
import { useChartLayout, type ChartLayoutResult } from '../src/react/useChartLayout';

function headless(request: ChartRequest): ChartLayoutResult {
  let result: ChartLayoutResult | undefined;
  function Probe() {
    result = useChartLayout(request);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return result!;
}

describe('headless chart layout', () => {
  it.each(listCharts().map(chart => chart.type))('%s demo records preserve the live layout and claims', type => {
    for (const fixture of getFixtures(type).filter(fixture => fixture.kind === 'example')) {
      const input = { type, data: fixture.data, options: fixture.options, annotations: fixture.annotations };
      const expected = layoutContainerRequest(resolveChartRequest(input));
      const actual = headless(input);
      const context = `${type}/${fixture.id}`;
      if (expected.refused) {
        expect(actual.refused, context).toEqual(expected);
        expect(actual.records, context).toEqual([]);
        expect(actual.claims, context).toEqual([]);
      } else {
        expect(actual.geometry, context).toEqual(expected);
        expect(actual.claims, context).toEqual(claimsForChart(type, expected));
        expect(actual.warnings, context).toEqual(expected.warnings);
        expect(JSON.parse(JSON.stringify(actual.records)), context).toEqual(actual.records);
        expect(new Set(actual.records.map(record => record.id)).size, context).toBe(actual.records.length);
        for (const record of actual.records) {
          expect(record.target.chart, context).toBe(type);
          expect(record.value.state, context).toBeTruthy();
          for (const nodeId of record.nodeIds) expect(expected.scene.some(node => node.id === nodeId), `${context}: ${nodeId}`).toBe(true);
        }
      }
    }
  });
});
