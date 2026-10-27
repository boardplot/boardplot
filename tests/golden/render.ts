/**
 * Golden set: every registered fixture, laid out and serialised the way the
 * CLI does it, in two variants (as authored, and forced onto the notation
 * preset). The engine promises identical bytes for identical input, so a
 * hash per entry is the whole regression net for behaviour-preserving work.
 */

import { getFixtures } from '../../src/fixtures';
import '../../src/core/geo/packs';
// The CLI links the story layer; the golden set renders as the CLI does.
import '../../src/core/storyLayer';
import { chartDefinitions } from '../../src/core/charts';
import { getChart, type ChartDefinition, type Fixture } from '../../src/core/registry';
import { renderSvg } from '../../src/core/svg/renderSvg';
import { requireGeometry } from '../../src/core/sizing';
import { resolveTheme } from '../../src/core/theme';
import type { LayoutResult } from '../../src/core/types/scene';
import type { ThemeRef } from '../../src/core/types/theme';
import { generateHoverPreviews } from './hover';
import { stampFreeSha } from './stamp';

export type GoldenVariant = 'authored' | 'notation' | 'hover-boardroom' | 'hover-notation';
export const GOLDEN_VARIANTS: readonly GoldenVariant[] = ['authored', 'notation'];

export interface GoldenEntry {
  /** `<type>/<fixtureId>.<variant>` */
  key: string;
  type: string;
  fixtureId: string;
  variant: GoldenVariant;
  /** The SVG bytes, or `ERROR: <message>` when layout or serialisation threw. */
  output: string;
  sha256: string;
}

type AnyDefinition = ChartDefinition<any, any, any, any>;

/** One golden case before rendering: a fixture of a definition in a variant. */
export interface GoldenCase { key: string; definition: AnyDefinition; fixture: Fixture; variant: GoldenVariant }

/** A rendered case with what produced it: the layout result, and the data and options it was given. */
export interface GoldenRender {
  output: string;
  layout?: LayoutResult;
  data?: unknown;
  options?: Record<string, unknown>;
}

/** Render one case at the default target. */
export function renderGolden(def: AnyDefinition, fixture: Fixture, variant: GoldenVariant): GoldenRender {
  const result: GoldenRender = { output: '' };
  try {
    result.data = def.normalize(structuredClone(fixture.data));
    const parsedOptions = def.optionsSchema.parse(structuredClone(fixture.options ?? {})) as Record<string, unknown>;
    const options: Record<string, unknown> = result.options = {
      ...def.defaults,
      ...parsedOptions,
      ...(variant === 'notation' ? { theme: 'notation' } : {}),
      ...(fixture.annotations ? { annotations: structuredClone(fixture.annotations) } : {}),
    };
    result.layout = getChart(def.type)!.layout(result.data, options as never);
    result.output = renderSvg(requireGeometry(result.layout), resolveTheme(options.theme as ThemeRef | undefined));
  } catch (e) {
    result.output = `ERROR: ${(e as Error).message}`;
  }
  return result;
}

/** Every fixture × variant, in registry order. */
export function goldenCases(): GoldenCase[] {
  return (chartDefinitions as readonly AnyDefinition[]).flatMap(definition => getFixtures(definition.type).flatMap(fixture =>
    GOLDEN_VARIANTS.map(variant => ({ key: `${definition.type}/${fixture.id}.${variant}`, definition, fixture, variant }))));
}

const hashed = (key: string, type: string, fixtureId: string, variant: GoldenVariant, output: string): GoldenEntry =>
  ({ key, type, fixtureId, variant, output, sha256: stampFreeSha(output) });

/**
 * The hover previews of both families. A failed preview is an `ERROR:` output
 * of its own key, as a failed fixture render is.
 */
export function hoverEntries(): GoldenEntry[] {
  return generateHoverPreviews(['boardroom', 'notation']).map(preview => {
    const variant = `hover-${preview.family}` as GoldenVariant;
    const output = 'error' in preview ? `ERROR: ${preview.error}` : preview.svg;
    return hashed(`${preview.type}/${preview.fixture}.${variant}`, preview.type, preview.fixture, variant, output);
  });
}

/** Every fixture × variant, in registry order, hashed, then the hover previews. */
export function goldenEntries(): GoldenEntry[] {
  return [
    ...goldenCases().map(c => hashed(c.key, c.definition.type, c.fixture.id, c.variant, renderGolden(c.definition, c.fixture, c.variant).output)),
    ...hoverEntries(),
  ];
}
