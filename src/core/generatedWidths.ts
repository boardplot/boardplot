/**
 * An authored column width gives way before it refuses: the spec without the
 * width is the floor, and the width moves to the nearest size that still fits.
 * A chart with no authored width runs its layout once, with no extra work.
 */
import { SIZE_TOLERANCE } from './sizing';
import type { LintWarning } from './types/scene';

type Overrides = Readonly<Record<string, { width?: number }>>;
interface Drawn { refused?: unknown; size: { width: number; height: number }; sizing?: { minWidth?: number; minHeight?: number }; warnings: LintWarning[] }

/** The search halves the share this many times: a 5000 px width lands within about 150 px of the largest that fits. */
const SEARCH_STEPS = 5;

/** The same keys with each width at `share`. At 0 the width goes, and an override left empty goes with it. */
function scaled<O extends { columnOverrides?: Overrides }>(options: O, share: number): O {
  const entries = Object.entries(options.columnOverrides ?? {}).flatMap(([id, override]) => {
    const { width, ...rest } = override;
    if (width === undefined) return [[id, override] as const];
    if (share > 0) return [[id, { ...rest, width: width * share }] as const];
    return Object.keys(rest).length ? [[id, rest] as const] : [];
  });
  const { columnOverrides: _all, ...others } = options;
  return (entries.length ? { ...others, columnOverrides: Object.fromEntries(entries) } : others) as O;
}

/** The chart holds its room: no refusal, no error finding, and its measured floors met. `pinned`: the height is given, so a taller chart does not fit. */
export function fitsRoom(geometry: Drawn | undefined, pinned: boolean): boolean {
  return geometry !== undefined && !geometry.refused && !geometry.warnings.some((warning) => warning.severity === 'error')
    && (geometry.sizing?.minWidth ?? 0) <= geometry.size.width + SIZE_TOLERANCE
    && (!pinned || (geometry.sizing?.minHeight ?? 0) <= geometry.size.height + SIZE_TOLERANCE);
}

const GIVEN_WAY: ReadonlySet<string> = new Set(['generated-column-width-capped', 'generated-column-width-floored']);

interface GiveWayOptions<G> {
  /** Where the warning points: the keys of the diagram inset live under data. */
  field?: (string | number)[];
  /** The labels a draw hides. A draw that hides more than the spec without widths does not fit, because a later note pass can refuse it. */
  hidden?: (geometry: G) => number;
}

/** `draw` returns undefined where a layout throws for lack of room. */
export function widthsThatFit<O extends { columnOverrides?: Overrides }, G extends Drawn>(options: O, draw: (options: O) => G | undefined, pinned: boolean, giveWay: GiveWayOptions<G> = {}): G | undefined {
  const { field = ['options', 'columnOverrides'], hidden } = giveWay;
  const first = draw(options);
  const widths = Object.values(options.columnOverrides ?? {}).flatMap((override) => (override.width === undefined ? [] : [override.width]));
  if (widths.length === 0 || (fitsRoom(first, pinned) && (hidden === undefined || hidden(first!) === 0))) return first;
  const floor = draw(scaled(options, 0));
  // Without the widths the chart does not fit either: that spec's own report stands.
  if (floor === undefined || !fitsRoom(floor, pinned)) return floor;
  const fits = (geometry: G | undefined): geometry is G => fitsRoom(geometry, pinned) && (hidden === undefined || hidden(geometry!) <= hidden(floor));
  if (fits(first)) return first;
  let best = floor;
  let reduced = false;
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const share = (low + high) / 2;
    const next = draw(scaled(options, share));
    if (fits(next)) { best = next; low = share; reduced = true; } else high = share;
  }
  // No smaller width fits, so the width may be too narrow: the first wider one that fits stands.
  const widest = Math.max(...widths);
  let raised = false;
  if (!reduced) for (let share = 2; widest * share < floor.size.width; share *= 2) {
    const next = draw(scaled(options, share));
    if (fits(next)) { best = next; raised = true; break; }
  }
  // With neither, the unset widths stand: a width as wide as the chart was cut, and any other was raised.
  const code = raised || (!reduced && widest < floor.size.width) ? 'generated-column-width-floored' as const : 'generated-column-width-capped' as const;
  return { ...best, warnings: [...best.warnings.filter((warning) => !GIVEN_WAY.has(warning.code)), {
    code, severity: 'warn' as const, field,
    message: code === 'generated-column-width-capped'
      ? `the authored column widths are too wide for the ${Math.round(best.size.width)} x ${Math.round(best.size.height)} px chart, so they were reduced`
      : `the authored column widths are too narrow for the ${Math.round(best.size.width)} x ${Math.round(best.size.height)} px chart, so they were raised`,
    suggest: code === 'generated-column-width-capped' ? 'Use smaller widths, or give the chart more room.' : 'Use larger widths, or leave the width out.',
  }] };
}

/** The spec with no authored width: what a layout reports when even that has no room. */
export const withoutWidths = <O extends { columnOverrides?: Overrides }>(options: O): O => scaled(options, 0);
