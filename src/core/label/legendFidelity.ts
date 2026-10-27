import type { StringsSpec } from '../types/options';
import { localeStrings } from '../strings';
/**
 * The legend never lies: a key glyph mirrors the mark
 * encoding it names.
 *
 * Two failures this module exists to remove:
 *
 * 1. **A pattern on the marks that no key carries.** Scenario notation is a
 *    CELL property (`val.scenario ?? s.scenario`) while a series key can only
 *    read the SERIES (`s.scenario`), so a series that is AC in three categories
 *    and FC in the fourth paints a hatched column and a flat swatch. Hatching
 *    the series key instead would be the opposite lie — it would claim the AC
 *    columns are forecast too. The encoding belongs to neither series nor
 *    category, so it gets its own key, the way `bar`'s tornado already gives
 *    its detached-swing hatch one.
 *
 * 2. **Two keys a reader cannot tell apart.** `likert`'s split neutral is ONE
 *    response option drawn as two segments meeting at the centre line, and a
 *    legend built one-key-per-series printed a five-point scale as six keys,
 *    two of them identical in fill and in label.
 *
 * Both helpers derive from what the layout will actually PAINT. The caller
 * passes the patterns its own mark predicate returns over its own cells — the
 * same "one predicate, one source" discipline `frameRendersUnit` uses in
 * frame.ts — so a key and its mark cannot drift apart by editing one of them.
 */

import type { LegendItemInput } from '../frame';
import type { Id } from '../types/cell';

/** The fill-pattern channel a `rect` mark and a `box` legend key share. */
type MarkPattern = Extract<NonNullable<LegendItemInput['pattern']>, 'hatch45' | 'outline'>;

/**
 * Scenario notation: AC as dark solid, PY as light solid, PL as outline, and
 * FC as 45-degree hatch. Only the two PATTERNED scenarios appear here — AC and PY are carried
 * by fill alone, and a key for them would name an encoding the reader already
 * has in the series swatch.
 *
 * The label states the notation code AND its meaning: the code alone is house
 * jargon to a reader outside the standard, and the word alone drops the tie to
 * the `AC FC` the subtitle already carries.
 *
 * The `__` prefix keeps these ids out of the series id space (the convention
 * `bar`'s `__tornadoDetached` set), so `legend.order`, highlight lookups and
 * per-series tests cannot collide with them.
 */
const SCENARIO_KEY: Record<MarkPattern, { id: Id }> = {
  hatch45: { id: '__scenarioFC' },
  outline: { id: '__scenarioPL' },
};

/** Reading order follows the `AC PY PL FC` subtitle order the exhibits carry. */
const SCENARIO_ORDER: MarkPattern[] = ['outline', 'hatch45'];

interface ScenarioKeyInput {
  /**
   * Every pattern the layout's mark predicate returns over the cells it will
   * actually emit. Pass the predicate's own output — deriving these from the
   * data a second time is how the key and the mark drift.
   */
  strings?: StringsSpec;
  markPatterns: Iterable<LegendItemInput['pattern']>;
  /** Patterns already carried by the series/reference keys the caller built. */
  keyPatterns: Iterable<LegendItemInput['pattern']>;
  /**
   * Paint for the scenario key. A scenario styles ON TOP of series identity
   * so this must be a neutral tone: a key in one
   * series' colour would read as "only that series is forecast".
   */
  paint: LegendItemInput['paint'];
}

/**
 * The keys the exhibit is missing: one per pattern the marks paint and no key
 * names. Returns `[]` when the legend is already faithful, so a caller can
 * splice it unconditionally and fixtures that were correct do not move a byte.
 */
export function scenarioLegendKeys(input: ScenarioKeyInput): LegendItemInput[] {
  const painted = new Set<MarkPattern>();
  for (const pattern of input.markPatterns) if (pattern === 'hatch45' || pattern === 'outline') painted.add(pattern);
  for (const pattern of input.keyPatterns) if (pattern === 'hatch45' || pattern === 'outline') painted.delete(pattern);
  return SCENARIO_ORDER.filter((pattern) => painted.has(pattern)).map((pattern) => ({
    id: SCENARIO_KEY[pattern].id,
    label: (pattern === 'hatch45' ? input.strings?.forecast : input.strings?.plan) ?? (pattern === 'hatch45' ? localeStrings().forecast : localeStrings().plan),
    paint: input.paint,
    pattern,
  }));
}

interface DedupeResult<T> {
  items: T[];
  /** The entries removed, in the order they were dropped — for a disclosure. */
  dropped: T[];
}

/** U+001F: cannot occur in a resolved colour or a pattern name, so the joined
 *  signature stays unambiguous even for a label that contains a separator. */
const UNIT_SEPARATOR = '\u001f';

/**
 * Collapse legend entries a reader cannot tell apart.
 *
 * Two entries are the same key when their rendered appearance AND their label
 * agree. Appearance alone is not enough: palette exhaustion paints a seventh
 * series in the sixth's colour, and those two keys carry DIFFERENT names, so
 * collapsing on colour would delete a series from the legend. Label alone is
 * not enough either — two same-named series in different colours are two marks.
 *
 * The first occurrence survives, so reading order is preserved and the id that
 * remains is the one that sorted first.
 */
export function dedupeLegendKeys<T extends LegendItemInput>(
  items: T[],
  appearance: (item: T) => string,
): DedupeResult<T> {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    const signature = [
      appearance(item),
      item.pattern ?? '',
      item.key ?? 'box',
      (item.dash ?? []).join(','),
      item.label,
    ].join(UNIT_SEPARATOR);
    if (seen.has(signature)) dropped.push(item);
    else {
      seen.add(signature);
      kept.push(item);
    }
  }
  return { items: kept, dropped };
}
