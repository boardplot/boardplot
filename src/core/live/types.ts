/**
 * The line `window` option: its options, its refusals and the sampling
 * record a windowed line carries in its derived values.
 */

/** Named refusals. An unsupported shape is refused, never guessed at. */
type LiveRefusalCode =
  | 'unsupported-shape'
  | 'unsupported-ordering'
  | 'unsupported-metric'
  | 'invalid-window';

export class LiveDataError extends Error {
  readonly code: LiveRefusalCode;
  readonly path: string;

  constructor(code: LiveRefusalCode, path: string, message: string) {
    super(message);
    this.name = 'LiveDataError';
    this.code = code;
    this.path = path;
  }
}

export interface LiveWindowOptions {
  /** Keep the last n categories of the ordered series. */
  last?: number;
  /**
   * Display decimation: 'minmax' keeps each series' bucket extrema; 'none' draws
   * every point. Omitted, a plain line longer than 2,000 categories and four per
   * pixel of width samples by 'minmax' at two buckets per pixel.
   */
  decimate?: 'minmax' | 'none';
  /**
   * Intended category budget for 'minmax'; at least 4. This is not a hard cap:
   * window ends always survive, and each series keeps its original bucket
   * extrema, so the displayed document can exceed maxPoints.
   */
  maxPoints?: number;
}

export type LiveSamplingMethod = 'none' | 'last-n' | 'minmax' | 'last-n+minmax';

export interface LiveSampling {
  method: LiveSamplingMethod;
  /** Source category ids in authored order, displayed or not. */
  sourceCategoryIds: string[];
  /** Category ids that survive into the displayed document, in order. */
  displayedCategoryIds: string[];
  /** Indexes into `sourceCategoryIds` for every displayed category, ascending. */
  displayedSourceIndexes: number[];
  /** Count of source categories the displayed document leaves out. */
  droppedObservations: number;
  /** True when the document reuses the authored category objects, never copies of them. */
  categoryObjectsReused: boolean;
  /**
   * The requested category budget when minmax ran. Displayed categories can exceed
   * this because window ends always survive and each series keeps its own original
   * extrema rather than dropping them to fit.
   */
  maxPoints?: number;
  /** True when displayedSourceIndexes.length is greater than maxPoints. */
  exceededMaxPoints?: boolean;
}
