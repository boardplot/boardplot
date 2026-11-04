/**
 * An authored column width gives way before it refuses: the spec without the
 * width is the floor, and the width is cut to the largest share that still fits.
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

/** `draw` returns undefined where a layout throws for lack of room. `pinned`: the height is given, so a taller chart does not fit. */
export function widthsThatFit<O extends { columnOverrides?: Overrides }, G extends Drawn>(options: O, draw: (options: O) => G | undefined, pinned: boolean): G | undefined {
  const fits = (geometry: G | undefined): geometry is G => geometry !== undefined && !geometry.refused
    && (geometry.sizing?.minWidth ?? 0) <= geometry.size.width + SIZE_TOLERANCE
    && (!pinned || (geometry.sizing?.minHeight ?? 0) <= geometry.size.height + SIZE_TOLERANCE);
  const first = draw(options);
  if (fits(first) || !Object.values(options.columnOverrides ?? {}).some((override) => override.width !== undefined)) return first;
  const floor = draw(scaled(options, 0));
  // Without the widths the chart does not fit either: that spec's own report stands.
  if (!fits(floor)) return floor;
  let best = floor;
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const share = (low + high) / 2;
    const next = draw(scaled(options, share));
    if (fits(next)) { best = next; low = share; } else high = share;
  }
  return { ...best, warnings: [...best.warnings.filter((warning) => warning.code !== 'generated-column-width-capped'), {
    code: 'generated-column-width-capped', severity: 'warn' as const, field: ['options', 'columnOverrides'],
    message: `the authored column widths do not fit the ${Math.round(best.size.width)} x ${Math.round(best.size.height)} px chart, so they were reduced`,
    suggest: 'Use smaller widths, or give the chart more room.',
  }] };
}

/** The spec with no authored width: what a layout reports when even that has no room. */
export const withoutWidths = <O extends { columnOverrides?: Overrides }>(options: O): O => scaled(options, 0);
