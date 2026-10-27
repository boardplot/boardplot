import type { ValueBand } from '../../bands';
import type { LintWarning } from '../../types/scene';
import type { TableOptions, ComputedCellRecord, TableData, TableDerived } from '../../types/table';

/**
 * Expressions read additive sums. Ratios never read precomputed ratios.
 * `{ measure }` reads another measure's value (a percent measure enters as a
 * fraction); a number is a constant.
 */
export type DimSwitchExpression = { field: string } | { measure: string } | { total: DimSwitchExpression } | number | { op: 'sub' | 'add' | 'div' | 'mul'; a: DimSwitchExpression; b: DimSwitchExpression; factor?: number };
export type DimSwitchJudgeBase = string | [string, ...string[]];
export type DimSwitchComparisonKind = 'period' | 'prior' | 'plan';
type DimSwitchThresholdFamilies = Partial<Record<'volume' | 'cost' | 'rate' | 'effect', [number, number]>>;
export interface DimSwitchMeasure {
  id: string;
  label: string;
  /** Required, except on a subtotal: then Boardplot adds up its parts with their signs. */
  value?: DimSwitchExpression;
  /** Precision rule from drawn periods and Range. Money and count take one magnitude per measure, from its largest absolute cell over every member row ("0.21M", not "210.0k"); per unit and percent decide per row. Absent keeps the authored format. */
  scale?: 'money' | 'perUnit' | 'count' | 'percent';
  /** Judge Range and period levels in value units (percent levels use points). */
  bands?: ValueBand[];
  format?: string;
  unit?: string;
  /** A split appears below this measure and adds no depth rung. */
  parentId?: string;
  /** Root when splits are off; appears only below this measure when splits are on. */
  splitOf?: string;
  /** relative: % vs the reference; pp: points; absolute: current minus reference in the measure's unit. */
  change?: 'relative' | 'pp' | 'absolute';
  /** effect: judged by the line's effect on the statement result, in options.thresholds.effect units; base is optional there. */
  judge?: { family: 'volume' | 'cost' | 'rate'; base: DimSwitchJudgeBase } | { family: 'effect'; base?: DimSwitchJudgeBase };
  /** Statement: the subtotal line this measure adds up into (a measure id). */
  partOf?: string;
  /** Statement: -1 subtracts the line (a cost authored as a positive amount). */
  sign?: -1;
  /** Statement: a result line (a margin). Its value names the lines it is made of, e.g. { op: 'sub', a: { measure: 'income' }, b: { measure: 'costs' } }. */
  result?: true;
  /** Statement: how this line follows from driver measures, e.g. (AOV - returns) x margin. The measures it names are drivers: printed, never added, judged by their effect. */
  drivers?: DimSwitchExpression;
  /** Group label. by-measure heads each group with a section row; by-member nests the group under a label row in every member block. */
  group?: string;
  /** The measure opens a family of KPIs: its rows take the rule above them. */
  divider?: true;
  /** false leaves the measure out of the total's block in by-member; by-measure keeps its total row. */
  inTotalBlock?: boolean;
}
/** `fields` declares the sums fields that apply to the member even when the drawn windows hold only null for them. */
export interface DimSwitchMember { id: string; label: string; parentId?: string; fields?: string[] }
export interface DimSwitchPeriod { id: string; label: string; subLabel?: string; partial?: boolean; kind?: 'range' | 'prior' | 'plan' }
export type DimSwitchSums = Record<string, number | null>;
export interface DimSwitchData {
  dimension: { label: string; total: { id: string; label: string; heading?: string; fields?: string[] }; members: DimSwitchMember[]; headline: string[]; sums?: boolean };
  /** Tag of the change line under each period value, such as "WoW"; it also opens the cell's hover text. */
  changeLabel?: string;
  /** Tag of a driver's effect in its hover text, such as "Margin effect". Absent: no effect line. */
  effectLabel?: string;
  /** by-measure section heading per measure group label; absent, the group label. */
  groupHeadings?: Record<string, string>;
  measures: DimSwitchMeasure[];
  periods: DimSwitchPeriod[];
  facts: { memberId: string; periodId: string; sums: DimSwitchSums; ref?: DimSwitchSums }[];
}
export type DimSwitchVariant = 'by-measure' | 'by-member';
export interface DimSwitchOptions extends Omit<TableOptions, 'expansion' | 'topN' | 'variant'> {
  topN?: never;
  /** 'cohort' and 'cohort-small' are refused on dimswitch; use 'compact'. */
  density?: Exclude<TableOptions['density'], 'cohort' | 'cohort-small'>;
  variant?: DimSwitchVariant;
  depth?: number;
  splits?: boolean;
  expansion?: { expanded?: string[]; collapsed?: string[] };
  order?: 'sheet' | { by: string; desc?: boolean };
  show?: 'always' | 'withData';
  thresholds?: DimSwitchThresholdFamilies & Partial<Record<DimSwitchComparisonKind, DimSwitchThresholdFamilies>>;
  minimumSample?: Record<string, number>;
  /** Fixed track widths in px: label, Range, change and period. Without a label width, its text adds up to 320 px, plus indent and affix. Value defaults are 110, 92 and 94. */
  widths?: { label?: number; range?: number; change?: number; period?: number };
}
export interface CompiledDimSwitch {
  data: TableData;
  options: TableOptions;
  computedCells: ComputedCellRecord[];
  /** Stable row ids folded by the requested depth, before manual overrides. */
  depthCollapsed: string[];
  /** Outline level of each foldable row's children: depth d folds every row whose children sit deeper than d. */
  levels: Record<string, number>;
  /** The deepest depth that still opens a row. */
  maxDepth: number;
  warnings: LintWarning[];
}

export interface DimSwitchDerived extends TableDerived { compiled: {data: TableData; options: TableOptions} }
