import { localeStrings } from '../../strings/line';
import { stringFields } from '../../strings';
import type { StringsSpec } from '../../types/options';
/**
 * Line series whose last value is zero at the exhibit's precision.
 *
 * Without the group, four lines that all end at 0.0 print four end labels
 * reading "inbox 0.0", "newsfeed 0.0", "owned 0.0", "sms 0.0" on top of each
 * other, the spreader pushes them apart, and the gutter eats the plot for
 * four statements of the same number.
 *
 * The test reads the RAW value against the precision its formatter prints in:
 * the raster does not print a nonzero value as 0, so 0.04 prints
 * "0.04" while 0.06 rounds to 0.1 and keeps its own label. The group prints
 * one value for all its members, so only series whose last values print the
 * same text join it, and an exact zero never joins a nonzero value.
 * A series format answers by its own text: a value that comes out of it
 * exactly as a zero would reads as zero, which keeps the rule true for a unit
 * that contains a digit (`CO2`) and for locales whose numerals are not ASCII.
 *
 * Two or three such series share one end label; more than three lose the
 * labels and the engine derives a footnote instead.
 *
 * The group is built in DATA ORDER (the order of `data.series`), never sorted
 * by value, so two renders of one spec produce the same bytes.
 */

import type { Id } from '../../types/cell';
import type { LabelContent } from '../../types/options';
import type { EndLabelSeed } from './context';

/**
 * More than three names in one end label is a sentence, not a label: at the
 * 18% gutter budget it forces the wrapped or legend rung for every other
 * series on the exhibit. Above this count the labels go and a footnote states
 * the fact instead.
 */
const SHARED_LABEL_MAX_SERIES = 3;

/** Engine receipt for the series that end on a printed zero. */
export interface NearZeroTail {
  /** Series ids in data order. */
  seriesIds: Id[];
  /** The zero the group's last values round to at the exhibit's precision, e.g. `0.0`; every member prints the same value text. */
  value: string;
  /** `shared`: one joint end label. `dropped`: no end label, footnote instead. */
  mode: 'shared' | 'dropped';
  /** Derived footnote text; present only when `mode` is `dropped`. */
  footnote?: string;
}

/**
 * The names of the group, then the rest of the configured label content in its
 * configured order, composed by the same function that wrote the individual
 * labels. `category` therefore stays on the label, an `['absolute', 'series']`
 * order stays that way, and the unit suffix follows its own rule.
 *
 * The colon of "Inbox, Newsfeed, Owned: 0.00" separates the list from what
 * follows it, so it is written only when the names lead and something follows.
 */
function sharedText(group: EndLabelSeed[], endContent: LabelContent, label: (seed: EndLabelSeed) => string): string {
  const names = group.map(label).join(', ');
  const leads = endContent[0] === 'series' && endContent.length > 1;
  return group[0]!.compose(endContent, leads ? `${names}:` : names);
}

/**
 * Member ids are joined with `+`, so an id that contains one is escaped first
 * and the join stays reversible. The `shared:` namespace cannot collide with
 * an ordinary `series:<id>` or `point:<id>:<category>` label, whatever the
 * author named a series.
 */
function escapeMemberId(id: Id): string {
  return String(id).replace(/~/g, '~0').replace(/\+/g, '~1');
}

/** Id of the shared end label seed for these series, in data order. */
export function sharedEndLabelId(seriesIds: readonly Id[]): string {
  return `shared:${seriesIds.map(escapeMemberId).join('+')}`;
}

/**
 * One seed carrying the whole group. It keeps the FIRST member's series,
 * category and row index, so the shared label anchors on the first series in
 * data order and its leader points there.
 */
function sharedSeed(group: EndLabelSeed[], endContent: LabelContent): EndLabelSeed {
  const hasShort = group.some((seed) => seed.shortText !== undefined);
  return {
    ...group[0]!,
    id: sharedEndLabelId(group.map((seed) => seed.s.id)),
    shared: true,
    fullText: sharedText(group, endContent, (seed) => seed.s.label),
    ...(hasShort ? { shortText: sharedText(group, endContent, (seed) => seed.s.shortLabel ?? seed.s.label) } : {}),
  };
}

/**
 * Rewrites the endpoint seeds before any strategy runs, so the shared label
 * goes through the same wrapping, gutter budget and spreader as every other
 * end label and counts once in `label-gutter-over-budget`.
 */
export function planNearZeroTails(input: {
  strings?: StringsSpec;
  seeds: EndLabelSeed[];
  endContent: LabelContent | null;
  /** True when the author pinned a placement for that label id. */
  pinned: (id: Id) => boolean;
}): { seeds: EndLabelSeed[]; tail?: NearZeroTail } {
  const { seeds, endContent, pinned } = input;
  const carriesName = endContent?.includes('series') === true;
  if (!carriesName || !endContent) return { seeds };
  // Each seed reads zero off its own formatter: a series format can print
  // zero as 0.0 where the exhibit prints 0.
  const zeroSeeds = seeds.filter((seed) => seed.kind === 'series' && seed.zeroText !== '' && seed.printsZero);
  // Series that print zero can end at DIFFERENT categories, when one of them
  // has trailing nulls. The shared seed keeps the first member's category, so
  // merging across categories would report a W6 tail as ending at W5. Each
  // ending decides on its own: the largest group merges, and a tail that ends
  // elsewhere keeps its own label rather than being restated. The group
  // prints ONE value, so its members must print the same text (0 and
  // 0.004 print "0.00" and "0.004"), and an exact zero never shares a label
  // with a nonzero value even where a series format prints both as 0.0.
  const byEnding = new Map<string, EndLabelSeed[]>();
  for (const seed of zeroSeeds) {
    const key = `${seed.ci}\u001F${seed.valueText}\u001F${seed.exactZero}`;
    byEnding.set(key, [...(byEnding.get(key) ?? []), seed]);
  }
  const group = [...byEnding.values()]
    .sort((left, right) => right.length - left.length || left[0]!.ci - right[0]!.ci)[0] ?? [];
  const zeroText = group[0]?.zeroText ?? '';
  // A pinned placement names one label id, and merging would silently drop it.
  // Only the group is held back; the rest of the exhibit is not its business.
  if (group.length < 2 || group.some((seed) => pinned(seed.id))) return { seeds };
  const seriesIds = group.map((seed) => seed.s.id);
  const members = new Set(group.map((seed) => seed.id));
  if (group.length > SHARED_LABEL_MAX_SERIES) {
    return {
      seeds: seeds.filter((seed) => !members.has(seed.id)),
      tail: {
        seriesIds,
        value: zeroText,
        mode: 'dropped',
        // "near": each value is nonzero or zero below the precision, never printed as 0.
        footnote: stringFields(input.strings?.nearZeroNote ?? localeStrings().nearZeroNote, { count: group.length, value: zeroText }),
      },
    };
  }
  const shared = sharedSeed(group, endContent);
  const firstId = group[0]!.id;
  return {
    seeds: seeds.flatMap((seed) => (seed.id === firstId ? [shared] : members.has(seed.id) ? [] : [seed])),
    tail: { seriesIds, value: zeroText, mode: 'shared' },
  };
}

/** The footnote the engine owns when the group lost its labels. */
export function nearZeroTailNote(tail: NearZeroTail | undefined): string[] {
  return tail?.footnote ? [tail.footnote] : [];
}
