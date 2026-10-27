import { spaceTokens, WIDE_CANVAS_MIN_WIDTH, type SpaceTokens } from './theme';
import type { Margin } from './geometry';
import type { Theme } from './types/theme';

/**
 * Compact air uses the existing table compact/regular row-pitch ratio
 * (22/27). Comfortable is identity. Values stay inside the space-token
 * bounds in themeRules.
 */
const COMPACT_SPACE_RATIO = 22 / 27;

const LABEL_PAD = { min: 1, max: 16 };
const TIER_FACET = { min: 4, max: 64 };
const LEGEND_ROW = { min: 12, max: 28 };
const GAP = { min: 0, max: 32 };
const CANVAS = { min: 0, max: 96 };

function scaleSpacePx(value: number, min: number, max: number): number {
  if (value === 0 && min === 0) return 0;
  return Math.min(max, Math.max(min, Math.round(value * COMPACT_SPACE_RATIO)));
}

function scaleMargin(margin: Margin): Margin {
  return {
    top: scaleSpacePx(margin.top, CANVAS.min, CANVAS.max),
    right: scaleSpacePx(margin.right, CANVAS.min, CANVAS.max),
    bottom: scaleSpacePx(margin.bottom, CANVAS.min, CANVAS.max),
    left: scaleSpacePx(margin.left, CANVAS.min, CANVAS.max),
  };
}

function scaleGap(tokens: SpaceTokens, wide: SpaceTokens): NonNullable<Theme['space']['gap']> {
  return {
    titleSubtitle: scaleSpacePx(tokens.gapTitleSubtitle, GAP.min, GAP.max),
    subtitlePlot: scaleSpacePx(tokens.gapSubtitlePlot, GAP.min, GAP.max),
    subtitlePlotWide: scaleSpacePx(wide.gapSubtitlePlot, GAP.min, GAP.max),
    axisFootnote: scaleSpacePx(tokens.gapAxisFootnote, GAP.min, GAP.max),
    axisFootnoteWide: scaleSpacePx(wide.gapAxisFootnote, GAP.min, GAP.max),
    footnoteSource: scaleSpacePx(tokens.gapFootnoteSource, GAP.min, GAP.max),
    legend: scaleSpacePx(tokens.gapLegend, GAP.min, GAP.max),
  };
}

/** Compact writes scaled pads and row pitch onto the existing space fields. */
export function themeForDensity(theme: Theme, density: 'comfortable' | 'compact' = 'comfortable', width?: number): Theme {
  if (density !== 'compact') return theme;
  // The default margins step with the canvas width, so a known width scales
  // the margin of its own step; without one the 960 px step is the base.
  const base = spaceTokens(theme, width !== undefined && width < WIDE_CANVAS_MIN_WIDTH ? width : WIDE_CANVAS_MIN_WIDTH - 1);
  const wide = spaceTokens(theme, WIDE_CANVAS_MIN_WIDTH);
  return {
    ...theme,
    space: {
      tierGap: scaleSpacePx(theme.space.tierGap, TIER_FACET.min, TIER_FACET.max),
      facetGap: scaleSpacePx(theme.space.facetGap, TIER_FACET.min, TIER_FACET.max),
      labelPad: scaleSpacePx(theme.space.labelPad, LABEL_PAD.min, LABEL_PAD.max),
      canvas: { base: scaleMargin(base.margin), wide: scaleMargin(wide.margin) },
      gap: scaleGap(base, wide),
      legendRowH: scaleSpacePx(base.legendRowH, LEGEND_ROW.min, LEGEND_ROW.max),
      // A fixed bar row is the theme's row, at every density.
      ...(theme.space.barRow ? { barRow: theme.space.barRow } : {}),
    },
  };
}
