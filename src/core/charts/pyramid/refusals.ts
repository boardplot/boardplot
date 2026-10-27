/**
 * The options this type refuses, and the ONE place their wording lives.
 *
 * Both doors use it: `layoutPyramid` throws the code for direct and
 * React callers, and `pyramidOptionsSchema` fails the parse for the CLI, which
 * strips unknown keys before the layout would ever see them. Two doors, two
 * mechanisms, one text — a refusal whose reason reads differently depending on
 * which path you came in by is the same second-source-of-truth defect this
 * type refuses in its data.
 */
export const REFUSED_OPTIONS = {
  sortBy: {
    code: 'pyramid-sort-unsupported',
    why: 'is not accepted on a pyramid: sorting bands by magnitude destroys the ordered axis that makes the shape meaningful',
    fix: 'the band order IS the analysis — author the bands ascending and let the engine invert them',
  },
  sharedScale: {
    code: 'pyramid-shared-scale-required',
    why: 'is not accepted: a pyramid always uses one shared scale, and two independent scales make the two sides visually comparable while being numerically incomparable',
    fix: 'drop options.sharedScale, or use a butterfly chart if the two sides genuinely have different units',
  },
} as const;
