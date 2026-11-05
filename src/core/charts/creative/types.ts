import type { BaseOptions } from '../../types/options';

export type CreativeMedia = {
  aspect: '1:1' | '4:5' | '9:16';
  alt: string;
} & (
  | { kind: 'placeholder' }
  | { kind: 'image'; src: string }
  | { kind: 'video'; poster: string }
);

export interface CreativeMetric {
  value: number | null;
  accountMedian: number | null;
}

export interface CreativeFatigueRule {
  metric: 'ctr' | 'cpa';
  direction: 'higherIsBetter' | 'lowerIsBetter';
  baseline: { startDate: string; endDate: string };
  current: { startDate: string; endDate: string };
  minObservations: number;
  thresholdPct: number;
  missingData: 'unavailable' | 'skip';
}

/** Authored observations. A fatigue rule compares unweighted daily means. */
export interface CreativeData {
  id: string;
  media: CreativeMedia;
  facts: {
    name: string;
    format: string;
    currency: string;
    spendToDate: number | null;
    launchDate: string;
    endDate: string | null; // null means live at asOf
    asOf: string;
  };
  comparison: { startDate: string; endDate: string; population: string };
  /** The source's own definitions of its metrics (hook rate, hold rate), printed under the table as written. */
  definitions?: string;
  metrics: {
    ctr: CreativeMetric; // percentage points, e.g. 1.5 means 1.5%
    cpa: CreativeMetric; // facts.currency
    roas: CreativeMetric; // multiple
    hookRate: CreativeMetric; // percentage points
    holdRate: CreativeMetric; // percentage points
    frequency: CreativeMetric; // exposures per reached person
  };
  fatigueRule?: CreativeFatigueRule;
  observations: {
    date: string;
    spend: number | null; // daily spend in facts.currency
    cpa: number | null;
    ctr: number | null; // percentage points
  }[];
}

/** Creative exhibit metadata and canvas size. */
export type CreativeOptions = Pick<BaseOptions, 'target' | 'textScale' | 'textSize' | 'title' | 'subtitle' | 'source' | 'theme' | 'size' | 'mode' | 'interactive' | 'embed' | 'palette' | 'locale' | 'notes' | 'colorblindSafe'> & {
  /** false leaves the source line and the method lines off the card; frame.source and frame.notes keep them. */
  footnotes?: false;
  /** False leaves a number column out: value, median, delta. The label stays. */
  columnVisibility?: Record<string, boolean>;
  /** Per column: label, value, median, delta. */
  columnOverrides?: Record<string, { width?: number; align?: 'left' | 'right' | 'center'; headAlign?: 'left' | 'right' | 'center'; label?: string }>;
  /** Order of the number columns; the label stays first. */
  columnOrder?: string[];
  /** false: no head row and no rule under it. */
  columnHeads?: false;
  /** False leaves a metric row out; the medians and the fatigue rule still read it. Ids: the keys of data.metrics. */
  rowVisibility?: Record<string, boolean>;
  /** Order of the metric rows; rows left out follow in default order. */
  rowOrder?: string[];
  /** Rename a metric row. */
  rowOverrides?: Record<string, { label?: string }>;
};
