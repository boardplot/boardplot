import type { BarTableData, BarTableOptions } from '../charts/bartable/types';
import type { BoxData, BoxOptions } from '../charts/box/types';
import type { ChoroplethData, ChoroplethOptions } from '../charts/choropleth/types';
import type { CohortData, CohortOptions } from '../charts/cohort/types';
import type { CreativeData, CreativeOptions } from '../charts/creative/types';
import type { DimSwitchData, DimSwitchOptions } from '../charts/dimswitch/types';
import type { GanttOptions } from '../charts/gantt/layout';
import type { MetricStackData } from '../charts/grid/metricStack';
import type { ExplicitGridData, GridLayoutOptions, RepeatGridData } from '../charts/grid/normalize';
import type { HistogramData, HistogramOptions } from '../charts/histogram/types';
import type { LikertData, LikertOptions } from '../charts/likert/layout';
import type { ParetoData } from '../charts/pareto/layout';
import type { PvmData, PvmOptions } from '../charts/pvm/types';
import type { PyramidData, PyramidOptions } from '../charts/pyramid/types';
import type { SankeyData, SankeyOptions } from '../charts/sankey/types';
import type { ScatterStrategyOptions } from '../charts/scatter/types';
import type { StatusData, StatusOptions } from '../charts/status/layout';
import type { TilemapData, TilemapOptions } from '../charts/tilemap/types';
import type { TreemapData, TreemapOptions } from '../charts/treemap/types';
import type { WaffleOptions } from '../charts/waffle/types';
import type { Annotation } from './annotations';
import type { DateCell, NumberCell, PctCell } from './cell';
import type {
  BulletData, Category, ChartData, GanttData, HeatmapSeries, KpiData, LineSeries, LineXData,
  RangeSeries, ScatterData, Series, SlopeSeries, SparklineData, WaterfallData,
} from './data';
import type { DataInput } from './dataInput';
import type { DiagramData, DiagramOptions } from './diagram';
import type { OptionsInput } from './optionInput';
import type * as Options from './options';
import type { TableData, TableOptions } from './table';
import type { Theme, ThemeRef } from './theme';

// The layout shares category and series types. The data schemas each take their own fields.
type NamedCategory = Pick<Category, 'id' | 'label'>;
type DatedCategory = NamedCategory & Pick<Category, 'date' | 'footnote'>;
type BandedCategory = Omit<Category, 'role'>;
type ValueSeries = Pick<Series, 'id' | 'label' | 'values' | 'valueKind' | 'scenario' | 'colorRole' | 'unit' | 'format'>;
type PlotSeries = ValueSeries & Pick<Series, 'role' | 'fill'>;
type DirectedSeries = PlotSeries & Pick<Series, 'direction'>;
type RangePlotSeries = Omit<DirectedSeries, 'values'> & Pick<RangeSeries, 'values'>;
type LinePlotSeries = PlotSeries & Pick<LineSeries, 'kind' | 'axis' | 'shortLabel' | 'lineStyle' | 'marker' | 'smooth' | 'interpolateGaps' | 'targets'>;
type PlainCell = number | null | DateCell | Omit<NumberCell, 'details'> | Omit<PctCell, 'details'>;

type CategoryData<C extends Category, S extends Series> = Pick<ChartData, 'valueKind'> & {
  categories: C[];
  series: S[];
};

type LineSpecData = (CategoryData<BandedCategory, LinePlotSeries> & { x?: never; partial?: never })
  | (Omit<LineXData, 'series'> & { series: LinePlotSeries[] });
type GridStackOptions = NonNullable<GridLayoutOptions['stack']>;

interface ChartInputs {
  bar: [CategoryData<BandedCategory, RangePlotSeries>, Options.BarOptions];
  bartable: [BarTableData, BarTableOptions];
  box: [BoxData, BoxOptions];
  bullet: [BulletData, Options.BulletOptions];
  butterfly: [CategoryData<DatedCategory, ValueSeries & Pick<Series, 'fill'>>, Options.ButterflyOptions];
  choropleth: [ChoroplethData, ChoroplethOptions];
  cohort: [CohortData, CohortOptions];
  column: [CategoryData<Category, RangePlotSeries & Pick<Series, 'kind' | 'axis'>>, Options.ColumnOptions];
  combo: [CategoryData<BandedCategory, PlotSeries & Pick<Series, 'kind' | 'axis' | 'lineStyle' | 'marker' | 'smooth' | 'interpolateGaps'>>, Options.ComboOptions];
  creative: [CreativeData, CreativeOptions];
  diagram: [DiagramData, DiagramOptions];
  dimswitch: [DimSwitchData, DimSwitchOptions];
  dot: [CategoryData<DatedCategory, RangePlotSeries>, Options.DotOptions];
  funnel: [CategoryData<DatedCategory, PlotSeries>, Options.FunnelOptions];
  gantt: [GanttData, GanttOptions];
  grid: [Pick<ExplicitGridData, 'panels'> | RepeatGridData, GridLayoutOptions & { stack?: never }]
    | [MetricStackData, GridLayoutOptions & { stack: GridStackOptions }];
  heatmap: [CategoryData<DatedCategory, ValueSeries & Pick<HeatmapSeries, 'direction' | 'sizes' | 'bases' | 'states'>>, Options.HeatmapOptions];
  histogram: [HistogramData, HistogramOptions];
  kpi: [KpiData, Options.KpiOptions];
  likert: [LikertData, LikertOptions];
  line: [LineSpecData, Options.LineOptions];
  mekko: [CategoryData<DatedCategory & Pick<Category, 'total100'>, DirectedSeries>, Options.MekkoOptions];
  pareto: [ParetoData, Options.ParetoOptions];
  pie: [CategoryData<DatedCategory, ValueSeries & Pick<Series, 'role'>>, Options.PieOptions];
  pvm: [PvmData, PvmOptions];
  pyramid: [PyramidData, PyramidOptions];
  sankey: [SankeyData, SankeyOptions];
  scatter: [ScatterData, ScatterStrategyOptions];
  slope: [CategoryData<DatedCategory, PlotSeries & Pick<SlopeSeries, 'negative' | 'footnote'> & { n?: number | [number, number] }>, Options.SlopeOptions];
  sparkline: [SparklineData, Options.SparklineOptions];
  status: [StatusData, StatusOptions];
  table: [TableData, TableOptions];
  tilemap: [TilemapData, TilemapOptions];
  treemap: [TreemapData, TreemapOptions];
  variance: [CategoryData<DatedCategory & Pick<Category, 'partial'>, Omit<DirectedSeries, 'values'> & { values: PlainCell[] }>, Options.VarianceOptions];
  waffle: [CategoryData<NamedCategory, Pick<Series, 'id' | 'label' | 'valueKind' | 'colorRole' | 'fill' | 'format'> & { values: PlainCell[] }>, WaffleOptions];
  waterfall: [WaterfallData, Options.WaterfallOptions];
}

type SpecChart<T extends keyof ChartInputs, Input> = Input extends [infer D, infer O]
  ? {
    type: T;
    data: DataInput<D>;
    annotations?: Annotation<T extends 'line' ? string | number : string>[];
  } & ({} extends O ? { options?: OptionsInput<O> } : { options: OptionsInput<O> })
  : never;

type ChartSpec = {
  [T in keyof ChartInputs]: SpecChart<T, ChartInputs[T]>;
}[keyof ChartInputs];

/** Check a chart literal with `satisfies BoardplotSpec`. BoardplotChart validates every spec at runtime. */
export type BoardplotSpec = (ChartSpec & { name?: string; theme?: ThemeRef | Theme; version?: never; charts?: never }) | {
  $schema?: string;
  version: 1;
  type?: never;
  theme?: ThemeRef | Theme;
  locale?: string;
  charts: [ChartSpec & { name: string }];
};
