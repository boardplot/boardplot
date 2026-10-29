import { useMemo, useState, type ReactNode } from 'react';
import { BoardplotTheme, ScaleGroup } from 'boardplot/react/theme';
// ScaleGroup needs the line core registered when it plans, so these cards import LineChart.
import { LineChart } from 'boardplot/react/line';
import { BoardplotChart } from 'boardplot/react/spec';
import { DimSwitchChart } from 'boardplot/react/dimswitch';
import { useExport } from 'boardplot/react/export';
import brand from '../../brand-theme.json';
import { kpiTable, planW39, regions, sales, total, weeks } from './sales';

const W39 = weeks.length - 1;
const source = 'Alder Outdoor order data';
const pct = (a: number, b: number) => Math.round((a / b - 1) * 100);

// One spec per card. The text in each title is computed from the same data.
function kpiSpecs(compare: 'PY' | 'Plan') {
  const ac = total.ac, py = total.py;
  const online = (i: number) => (sales.online.ac[i].rev / total.ac[i].rev) * 100;
  const margin = (w: { rev: number; gm: number }) => (w.gm / w.rev) * 100;
  const spark = (values: number[]) => ({ kind: 'line', values, labels: weeks });
  const vsRevenue = compare === 'PY' ? { vs: py[W39].rev, label: 'vs PY', mode: 'both' } : { vs: planW39.rev, label: 'vs Plan', mode: 'both' };
  return [
    { type: 'kpi', data: { label: 'Revenue, W39', value: ac[W39].rev, format: '€1.1M', compare: [vsRevenue], spark: spark(ac.map((w) => w.rev)) } },
    { type: 'kpi', data: { label: 'Gross margin, W39', value: margin(ac[W39]), format: '1.1%', compare: [{ vs: margin(py[W39]), label: 'vs PY', mode: 'absolute' }], spark: spark(ac.map(margin)) } },
    { type: 'kpi', data: { label: 'Online share, W39', value: online(W39), format: '1.1%', compare: [{ vs: (sales.online.py[W39].rev / py[W39].rev) * 100, label: 'vs PY', mode: 'absolute' }], spark: spark(weeks.map((_, i) => online(i))) } },
    { type: 'kpi', data: { label: 'Orders, W39', value: ac[W39].orders, format: '1,234', compare: [{ vs: py[W39].orders, label: 'vs PY', mode: 'both' }], spark: spark(ac.map((w) => w.orders)) } },
  ];
}

function regionSpec(compare: 'PY' | 'Plan') {
  const vs = compare === 'PY' ? 'PY' : 'PL';
  const gaps = regions.categories.map((c, i) => ({ label: c.label, gap: regions.AC[i] - regions[vs][i] }));
  const worst = gaps.reduce((a, b) => (b.gap < a.gap ? b : a));
  const behind = gaps.filter((g) => g.gap < 0).length;
  return {
    type: 'variance',
    data: {
      categories: regions.categories,
      series: [
        { id: 'AC', label: 'W36–W39', values: regions.AC, scenario: 'AC', colorRole: 'total' },
        { id: vs, label: compare === 'PY' ? 'Last year' : 'Plan', values: regions[vs], role: 'reference', scenario: vs },
      ],
    },
    options: {
      variant: 'integrated', variance: { of: 'AC', vs },
      title: `${behind} of 6 regions are behind ${compare === 'PY' ? 'last year' : 'plan'}; ${worst.label} misses by the most`,
      subtitle: { measure: 'Revenue by region', period: 'W36–W39', scenarios: ['AC', vs] },
      unit: '€m', source,
    },
  };
}

function weeklySpec(id: 'online' | 'retail', label: string) {
  const s = sales[id];
  const change = pct(s.ac[W39].rev, s.py[W39].rev);
  return {
    type: 'line',
    data: {
      categories: weeks,
      series: [
        { id: 'AC', label: 'FY26', values: s.ac.map((w) => w.rev / 1e6), colorRole: 'highlight' },
        { id: 'PY', label: 'FY25', values: s.py.map((w) => w.rev / 1e6), scenario: 'PY' },
      ],
    },
    options: {
      title: `${label} is ${Math.abs(change)}% ${change >= 0 ? 'above' : 'below'} last year in W39`,
      subtitle: { measure: `${label} revenue by week` },
      unit: '€m', format: '1.1', source, scaleGroup: { y: 'weekly', id },
    },
  };
}

function Card({ label, exportable = true, children }: { label: string; exportable?: boolean; children: (exporter?: ReturnType<typeof useExport>) => ReactNode }) {
  const exporter = useExport();
  const save = async (kind: 'png' | 'csv') => {
    const result = kind === 'png' ? await exporter.png(2) : await exporter.csv();
    if (!result.ok) return;
    const url = URL.createObjectURL(new Blob([result.artifact.bytes], { type: result.artifact.mediaType }));
    Object.assign(document.createElement('a'), { href: url, download: result.artifact.filename }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="card">
      <header>
        <span>{label}</span>
        {exportable && <span className="tools"><button onClick={() => save('png')}>PNG</button><button onClick={() => save('csv')}>CSV</button></span>}
      </header>
      {children(exportable ? exporter : undefined)}
    </section>
  );
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="toggle">
      {options.map(([id, text]) => <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
    </span>
  );
}

export function App() {
  const [compare, setCompare] = useState<'PY' | 'Plan'>('PY');
  const [variant, setVariant] = useState<'by-measure' | 'by-member'>('by-measure');
  const kpis = useMemo(() => kpiSpecs(compare), [compare]);
  const region = useMemo(() => regionSpec(compare), [compare]);
  const online = weeklySpec('online', 'Online');
  const retail = weeklySpec('retail', 'Retail');

  return (
    <BoardplotTheme target="dashboard" theme={brand}>
      <div className="bar">
        <div><b>Alder Outdoor</b> · Weekly trading dashboard · W39 2026</div>
        <label>Compare with <Toggle value={compare} options={[['PY', 'Last year'], ['Plan', 'Plan']]} onChange={setCompare} /></label>
      </div>
      <main>
        <div className="kpis">
          {kpis.map((spec, i) => (
            <section className="card kpi" key={i}><BoardplotChart spec={spec} size="container" fit="content" fallbackSize={{ width: 300, height: 160 }} /></section>
          ))}
        </div>
        <div className="row wide">
          <Card label="Channel KPIs" exportable={false}>
            {() => (
              <>
                <div className="controls">
                  <Toggle value={variant} options={[['by-measure', 'KPIs by channel'], ['by-member', 'Channels by KPI']]} onChange={setVariant} />
                </div>
                <DimSwitchChart data={kpiTable} variant={variant} depth={2} size="container" fit="content" fallbackSize={{ width: 760, height: 520 }}
                  title="Online carries the growth; retail revenue and margin are below last year" subtitle={{ measure: 'Channel KPIs', period: 'W36–W39 vs W32–W35, weeks vs last year' }} source={source} />
              </>
            )}
          </Card>
          <Card label="Regions">
            {(exporter) => <BoardplotChart spec={region} exporter={exporter} size="container" fit="content" fallbackSize={{ width: 420, height: 520 }} />}
          </Card>
        </div>
        <ScaleGroup group="weekly" members={[{ id: 'online', ...online }, { id: 'retail', ...retail }].map(({ id, type, data, options }) => ({ id, type, data, options }))}>
          <div className="row">
            <Card label="Online">{(exporter) => <LineChart data={online.data} {...online.options} exporter={exporter} size="container" fit="content" fallbackSize={{ width: 600, height: 360 }} />}</Card>
            <Card label="Retail">{(exporter) => <LineChart data={retail.data} {...retail.options} exporter={exporter} size="container" fit="content" fallbackSize={{ width: 600, height: 360 }} />}</Card>
          </div>
        </ScaleGroup>
      </main>
    </BoardplotTheme>
  );
}
