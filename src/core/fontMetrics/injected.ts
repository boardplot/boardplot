/** Build a per-chart TextMeasurer from generated font tables. */
import { capHeightOfFace, defaultMeasurer, estimateTextWidthForFace, quantize, type TextMeasurer } from '../text';
import {
  DEFAULT_FAMILY,
  buildCodePointIndex,
  decodeFace,
  familiesOf,
  nearestWeight,
  tableFamilyKey,
  tabledFamilies,
  type Face,
} from './index';
import type { FontMetricTables } from './tableDocument';

/**
 * A `TextMeasurer` over one table file, for the per-layout injection point:
 * pass it as `options.measure` (`measure?: TextMeasurer` is a TS-only option
 * key on the base options and every layout reads `options.measure ??
 * defaultMeasurer`), which is what the React components forward.
 *
 * Only NORMAL faces are usable. `FontSpec` has no italic mode and chart labels
 * are rendered upright, so an italic face's advances are not a measurement for
 * anything this engine draws; italics are skipped and a family that has no
 * normal face in the file is not measured at all — that family keeps the
 * character-class fallback instead of being measured with the wrong widths.
 * Layout uses the measured widths to place labels deterministically.
 *
 * Match order is the same as the built-in path: first family of the CSS stack
 * that the file has, at the nearest tabled weight, ties to the heavier face.
 * Twice the same file gives the same measurer.
 */
export function createMetricTablesMeasurer(tables: FontMetricTables, options: MetricTablesMeasurerOptions = {}): TextMeasurer {
  const own = measurerOverTables(tables);
  return options.bundledFallback === true ? withBundledFallback(own, measurableFamilies(tables)) : own;
}

interface MetricTablesMeasurerOptions {
  /**
   * Measure a family the file does not hold with the bundled tables instead of
   * the character-class model. The first family of the CSS stack that has a
   * table, in the file or in the bundle, measures the text; a stack with none
   * keeps the character-class model. Default false: the file alone measures.
   */
  bundledFallback?: boolean;
}

/** The passed tables for the families the file holds, the bundled measurer for every other tabled family. */
function withBundledFallback(own: TextMeasurer, families: readonly string[]): TextMeasurer {
  const mine = new Set(families.map(tableFamilyKey));
  const bundled = new Set(tabledFamilies().map(tableFamilyKey));
  const owner = (stack: string | undefined): TextMeasurer => {
    for (const family of familiesOf(stack ?? DEFAULT_FAMILY)) {
      if (mine.has(family)) return own;
      if (bundled.has(family)) return defaultMeasurer;
    }
    return defaultMeasurer;
  };
  const measure: TextMeasurer = (text, font) => owner(font.family)(text, font);
  measure.capHeight = (font) => owner(font.family).capHeight?.(font);
  return measure;
}

function measurerOverTables(tables: FontMetricTables): TextMeasurer {
  const index = buildCodePointIndex(tables.codePointRanges, tables.extraCodePoints);
  const byFamily = new Map<string, Face[]>();
  for (const face of tables.faces) {
    if (face.style !== 'normal') continue;
    const key = tableFamilyKey(face.family);
    byFamily.set(key, [...(byFamily.get(key) ?? []), decodeFace(face, index)]);
  }
  const resolved = new Map<string, Face | undefined>();
  const resolve = (stack: string | undefined, weight: number): Face | undefined => {
    const key = `${stack ?? DEFAULT_FAMILY}|${weight}`;
    if (resolved.has(key)) return resolved.get(key);
    let face: Face | undefined;
    for (const family of familiesOf(stack ?? DEFAULT_FAMILY)) {
      const faces = byFamily.get(family);
      if (faces) {
        face = nearestWeight(faces, weight);
        break;
      }
    }
    resolved.set(key, face);
    return face;
  };
  const measure: TextMeasurer = (text, font) => ({
    width: quantize(estimateTextWidthForFace(text, font, resolve(font.family, font.weight))),
    height: quantize(font.size * (font.lineHeight ?? 1.2)),
    ascent: quantize(font.size * 0.8),
  });
  measure.capHeight = (font) => capHeightOfFace(font, resolve(font.family, font.weight));
  return measure;
}

/** Families the file carries, for diagnostics: a host can check its stack. */
export function metricTablesFamilies(tables: FontMetricTables): string[] {
  return [...new Set(tables.faces.map((face) => face.family))];
}

/**
 * Families this measurer can actually measure: those with at least one normal
 * face. An italic-only family is listed by `metricTablesFamilies` and absent
 * here, which is the honest answer to "will my labels be measured from this
 * file?".
 */
export function measurableFamilies(tables: FontMetricTables): string[] {
  return [...new Set(tables.faces.filter((face) => face.style === 'normal').map((face) => face.family))];
}
