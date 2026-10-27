// Large table inputs for scripts/speed-tool.mjs, built from invented data.
// They cover two large cases: a 2,000-row bar table and a
// 287-period dimswitch with six and with 27 measures. Each export is a chart
// request in the shape `{ type, data, options }`.

/** 2,000 bar-table rows with repeating invented values. */
function barTable2000() {
  const rows = 2000;
  return {
    type: 'bartable',
    data: {
      categories: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, label: `Segment ${i + 1}` })),
      series: [{ id: 'v', label: 'Value' }],
      panels: [{ id: 'p', label: 'Revenue', unit: '$', values: { v: Array.from({ length: rows }, (_, i) => 1000 + (i % 100) * 37) } }],
    },
    options: { size: { width: 1280 }, total: false },
  };
}

/** Six measures (two derived), a Total and four channel members, Range and Prior plus 285 day periods. */
function dimswitch287Six() {
  const members = [{ id: 'paid', label: 'Paid Search' }, { id: 'search-a', label: 'Search A', parentId: 'paid' },
    { id: 'search-b', label: 'Search B', parentId: 'paid' }, { id: 'organic', label: 'Organic' }];
  const measures = [
    { id: 'orders', scale: 'count', label: 'Orders', change: 'relative', value: { field: 'orders' }, judge: { family: 'volume', base: 'orders' } },
    { id: 'new', scale: 'count', label: 'New customers', parentId: 'orders', value: { field: 'nc' } },
    { id: 'existing', scale: 'count', label: 'Existing customers', parentId: 'orders', value: { op: 'sub', a: { field: 'orders' }, b: { field: 'nc' } } },
    { id: 'revenue', scale: 'money', label: 'Net revenue', value: { field: 'rev' }, format: '$1.2', unit: '$' },
    { id: 'spend', scale: 'money', label: 'Marketing spend', value: { field: 'spend' }, format: '$1.2', unit: '$' },
    { id: 'cac', scale: 'perUnit', label: 'CAC', value: { op: 'div', a: { field: 'spend' }, b: { field: 'nc' } }, format: '$1.2', unit: '$', judge: { family: 'cost', base: 'nc' } },
  ];
  const periods = [{ id: 'range', label: 'Range', kind: 'range' }, { id: 'prior', label: 'Prior', kind: 'prior' },
    ...Array.from({ length: 285 }, (_, i) => ({ id: `p${i}`, label: `Day ${i + 1}` }))];
  const facts = ['total', ...members.map((m) => m.id)].flatMap((memberId, i) => periods.map((p, j) => ({
    memberId, periodId: p.id,
    sums: { orders: 120 + i * 15 + j, nc: 60 + i * 7, rev: 12000 + i * 1500 + j * 50, spend: 1800 + i * 200 + j * 3 },
    ref: { orders: 110 + i * 15, nc: 50 + i * 7, rev: 11000 + i * 1500, spend: 1900 + i * 200 },
  })));
  return {
    type: 'dimswitch',
    data: { dimension: { label: 'Channel', total: { id: 'total', label: 'Total' }, members, headline: ['spend', 'revenue'] }, measures, periods, facts },
    options: { size: { width: 960 }, depth: 2, variant: 'by-measure' },
  };
}

/** 27 measures by 287 day periods plus Range and Prior, a Total and five members (the days(287) input of tests/dimswitch-wide.test.tsx). */
function dimswitch287TwentySeven() {
  const members = [{ id: 'paid', label: 'Paid' }, { id: 's1', label: 'Search A', parentId: 'paid' },
    { id: 's2', label: 'Search B', parentId: 'paid' }, { id: 'social', label: 'Social' }, { id: 'organic', label: 'Organic' }];
  const measures = Array.from({ length: 27 }, (_, i) => i % 3 === 0
    ? { id: `m${i}`, scale: 'count', label: `Count measure ${i}`, value: { field: `f${i}` } }
    : { id: `m${i}`, scale: i % 3 === 1 ? 'money' : 'perUnit', label: `Money measure ${i}`, value: { field: `f${i}` }, format: '$1.2', unit: '$' });
  const start = Date.UTC(2026, 0, 1);
  const periods = [{ id: 'range', label: 'Range', kind: 'range' }, { id: 'prior', label: 'Prior', kind: 'prior' },
    ...Array.from({ length: 287 }, (_, i) => ({ id: `d${i}`, label: new Date(start + i * 86_400_000).toISOString().slice(5, 10) }))];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const facts = ['total', ...members.map((m) => m.id)].flatMap((memberId) => periods.map((p) => {
    const sums = {}, ref = {};
    for (const m of measures) { const base = 100 + random() * 900; sums[m.value.field] = Math.round(base); ref[m.value.field] = Math.round(base * 0.9); }
    return { memberId, periodId: p.id, sums, ref };
  }));
  return {
    type: 'dimswitch',
    data: { dimension: { label: 'Channel', total: { id: 'total', label: 'Total' }, members, headline: ['m0', 'm1', 'm2'] }, measures, periods, facts },
    options: { target: 'report', title: 'Daily performance', variant: 'by-measure', depth: 2, show: 'always', size: { width: 1216 } },
  };
}

export const largeInputs = {
  'bartable-2000-rows': barTable2000,
  'dimswitch-287-periods-6-measures': dimswitch287Six,
  'dimswitch-287-periods-27-measures': dimswitch287TwentySeven,
};
