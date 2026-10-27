import type { FontSpec } from '../../text';
import type { Id, Scenario } from '../../types/cell';
import type { LabelContent } from '../../types/options';
import type { MarkerShape } from '../../types/data';
import type { LineOptionTarget, LineSeriesTarget } from './types';

export interface NormVal {
  v: number | null;
  isPct: boolean;
  fill?: string;
  scenario?: Scenario;
  format?: string;
  labelOverride?: string | false;
  priority?: number;
}

export interface NormSer {
  id: Id;
  label: string;
  shortLabel?: string;
  role: 'data' | 'reference';
  scenario?: Scenario;
  colorRole?: string;
  fill?: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  marker?: MarkerShape;
  smooth?: boolean;
  interpolateGaps: boolean;
  targets: LineSeriesTarget[];
  /** Series format example and unit (a series format overrides). */
  format?: string;
  unit?: string;
  vals: NormVal[];
}

export interface NormTarget extends LineOptionTarget {
  id: Id;
}

export interface EndLabel {
  id: Id;
  kind: 'series' | 'point';
  /** One label for several series that end on the same printed zero. */
  shared?: true;
  s: NormSer;
  dataIdx: number;
  ci: number;
  text: string;
  w: number;
  lines: string[];
  h: number;
  /** The full name when the bump name block cut it; the node's `<title>`. */
  title?: string;
  /** The stepped font when the name block stepped down to fit. */
  font?: FontSpec;
  /** The last value as the point would print it; a crowded end prints it under the name. */
  valueText?: string;
}

export interface EndLabelSeed {
  id: Id;
  kind: 'series' | 'point';
  /** One seed standing for several series (see `nearZero.ts`). */
  shared?: true;
  /**
   * Writes this seed's label text for any label content, with the endpoint
   * unit suffix applied. The near-zero group reuses it so a shared label keeps the configured
   * content and its order.
   */
  compose: (content: LabelContent, seriesLabel: string) => string;
  s: NormSer;
  dataIdx: number;
  ci: number;
  fullText: string;
  shortText?: string;
  valueText: string;
  /** How zero prints under this seed's own formatter (a series format can differ from the exhibit's). */
  zeroText: string;
  /**
   * The last value is zero at the precision this seed's formatter prints in.
   * Read off the raw value: the raster does not print a nonzero
   * value as 0, so 0.004 prints "0.004" and still joins the group.
   */
  printsZero: boolean;
  /** The last value is exactly zero; it never shares a label with a nonzero value. */
  exactZero: boolean;
}
