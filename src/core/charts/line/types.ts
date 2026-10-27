// The line family's option and series shapes are declared in the public type
// modules, not augmented into them: a `declare module '../../types/options'`
// block is copied verbatim into the published declaration bundle, where the
// relative specifier resolves to nothing and the interface merge never happens.
export type {
  GapFillTone,
  LineInterpolation,
  LineOptionTarget,
  LinePhase,
  LineXAxis,
  LineXTimeUnit,
} from '../../types/options';
export type { LineSeriesTarget } from '../../types/data';

/** The layout reads canonical category ids after the continuous axis resolves authored x anchors. */
export type LineOptions = Omit<import('../../types/options').LineOptions, 'annotations'> & {
  annotations?: import('../../types/annotations').Annotation[];
};
