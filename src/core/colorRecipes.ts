import { apcaContrast, contrastRatio, tint } from './color';
import { NormalizeError } from './normalize/shared';
import { markRolePaint, mixedPaint, paintColor, seriesPaint } from './theme';
import { MARK_CONTRAST_FLOOR, oklabLightness, PALETTE_NORMAL_FLOOR, palettePerceptualDistance } from './themeRules';
import type { Paint, ThemePaintSource, LintWarning } from './types/scene';
import type { Theme } from './types/theme';

/** The share of the ramp the lowest value of a min..max ramp keeps, so it never reads as empty. */
const SEQUENTIAL_FLOOR = 0.15;

/**
 * Where an unsigned value sits on a sequential ramp, 0 to 1. Data that
 * reaches zero keeps the zero anchor. Data that starts above zero spans its
 * own min..max (88 to 99 would otherwise paint one colour), and a flat set
 * sits in the middle rather than at full strength.
 */
export function sequentialShare(value: number, min: number, max: number): number {
  if (max <= min) return max > 0 ? 0.5 : 0;
  if (min <= 0) return max > 0 ? value / max : 0;
  return SEQUENTIAL_FLOOR + ((1 - SEQUENTIAL_FLOOR) * (value - min)) / (max - min);
}

const BAND_STROKE_CONTRAST_FLOOR = 3.1;
const CONTEXT_STROKE_SEPARATION_FLOOR = 1.3;
function clearsLineBand(theme: Theme, paint: Paint): boolean {
  const css = paintColor(theme, paint);
  return contrastRatio(css, theme.color.background) >= BAND_STROKE_CONTRAST_FLOOR &&
    contrastRatio(css, theme.color.others) >= BAND_STROKE_CONTRAST_FLOOR;
}
const lineBandContrast = (theme: Theme, css: string): number =>
  Math.min(contrastRatio(css, theme.color.background), contrastRatio(css, theme.color.others));
function lineBandPaint(theme: Theme, paint: Paint, seriesId: string): Paint {
  const clearsBandContrast = (paint: Paint) => clearsLineBand(theme, paint);
  if (clearsBandContrast(paint)) return paint;
  const fallbackToken = 'token' in paint ? paint.token : 'inkMuted';
  for (let step = 1; step <= 200; step++) {
    const inkShare = step / 200;
    const candidate = mixedPaint(paint, { token: 'markInk' }, 1 - inkShare, fallbackToken);
    if (clearsBandContrast(candidate)) return candidate;
  }
  throw new NormalizeError(
    'line-band-contrast-exhausted',
    'annotations',
    `series '${seriesId}' cannot reach ${BAND_STROKE_CONTRAST_FLOOR.toFixed(1)}:1 against the page and band`,
    'use a stronger ink token or lighter band',
  );
}
/** An authored colour under the band floor is drawn darker; this tells the author by how much. */
export function lineBandAuthoredWarnings(theme: Theme, base: Paint, seriesId: string, authoredSource: string, authoredPaint?: Paint): LintWarning[] {
  if (clearsLineBand(theme, base)) return [];
  const start = paintColor(theme, base);
  // highlightMode 'fade' washes the stroke first: the text names the authored colour, then the faded one.
  const authored = authoredPaint ? `${paintColor(theme, authoredPaint)}, faded to ${start}` : start;
  const drawn = paintColor(theme, lineBandPaint(theme, base, seriesId));
  return [{
    code: 'line-band-authored-contrast',
    severity: 'warn',
    message: `series '${seriesId}' has the authored ${authoredSource} colour ${authored}, which reaches ${lineBandContrast(theme, start).toFixed(2)}:1 against the page and band; it is drawn as ${drawn} (${lineBandContrast(theme, drawn).toFixed(2)}:1, floor ${BAND_STROKE_CONTRAST_FLOOR.toFixed(1)}:1)`,
    suggest: 'choose a darker colour or a lighter band',
  }];
}
const contextPaintAtShare = (inkShare: number): Paint =>
  inkShare === 0
    ? { token: 'neutralLight' }
    : mixedPaint({ token: 'neutralLight' }, { token: 'markInk' }, 1 - inkShare, 'neutralLight');
function lineContextPaint(theme: Theme, rank: number, contextRungCount: number, seriesId: string): Paint {
  const paintCss = (paint: Paint) => paintColor(theme, paint);
  const clearsBandContrast = (paint: Paint) => clearsLineBand(theme, paint);
  let minimumSafeShare: number | undefined;
  for (let step = 0; step <= 200; step++) {
    const share = step / 200;
    const candidate = contextPaintAtShare(share);
    if (clearsBandContrast(candidate)) {
      minimumSafeShare = share;
      break;
    }
  }
  if (minimumSafeShare === undefined) {
    throw new NormalizeError(
      'line-band-contrast-exhausted',
      'annotations',
      `series '${seriesId}' cannot reach ${BAND_STROKE_CONTRAST_FLOOR.toFixed(1)}:1 against the page and band`,
      'use a stronger ink token or lighter band',
    );
  }
  const basePaint = contextPaintAtShare(minimumSafeShare);
  const availableContrast = contrastRatio(paintCss(basePaint), paintCss({ token: 'markInk' }));
  const rungSeparation = Math.pow(availableContrast, 1 / Math.max(1, contextRungCount));
  if (rungSeparation < CONTEXT_STROKE_SEPARATION_FLOOR) {
    throw new NormalizeError(
      'line-band-hierarchy-exhausted',
      'annotations',
      `${contextRungCount} context levels leave ${rungSeparation.toFixed(2)}:1 between strokes after band contrast`,
      `use fewer series, a lighter band, or ${CONTEXT_STROKE_SEPARATION_FLOOR.toFixed(1)}:1 per level`,
    );
  }
  const targetFromBase = Math.pow(rungSeparation, rank);
  let separatedShare: number | undefined;
  for (let step = Math.ceil(minimumSafeShare * 200); step <= 200; step++) {
    const share = step / 200;
    if (contrastRatio(paintCss(basePaint), paintCss(contextPaintAtShare(share))) >= targetFromBase) {
      separatedShare = share;
      break;
    }
  }
  if (separatedShare === undefined) {
    throw new NormalizeError(
      'line-band-hierarchy-exhausted',
      'annotations',
      `series '${seriesId}' cannot separate context levels after band contrast`,
      'use fewer context series or a lighter band',
    );
  }
  return contextPaintAtShare(separatedShare);
}

function lineApartPaint(theme: Theme, share: number, top: number, apartFrom: readonly Paint[], darker?: { share: number; pairs: ReadonlyArray<readonly [number, number]> }): Paint {
  if (darker && darker.pairs.every(([a, b]) =>
    palettePerceptualDistance(paintColor(theme, contextPaintAtShare(a)), paintColor(theme, contextPaintAtShare(b))) >= PALETTE_NORMAL_FLOOR)) share = darker.share;
  const others = apartFrom.map((paint) => paintColor(theme, paint));
  let step = Math.round(share * 100);
  while (step < Math.round(top * 100) && others.some((other) =>
    palettePerceptualDistance(paintColor(theme, contextPaintAtShare(step / 100)), other) < PALETTE_NORMAL_FLOOR)) step++;
  return contextPaintAtShare(step / 100);
}

function lineForecastPaint(paint: Paint, theme: Theme, crossesBand: boolean): Paint {
  const floor = 3;
  for (let share = 0.8; share < 1; share += 0.025) {
    const candidate = mixedPaint(paint, { token: 'background' }, share, 'token' in paint ? paint.token : 'neutral');
    if (contrastRatio(paintColor(theme, candidate), theme.color.background) >= floor && (!crossesBand || clearsLineBand(theme, candidate))) return candidate;
  }
  return contrastRatio(paintColor(theme, paint), theme.color.background) >= floor
    ? paint : lineBandPaint(theme, paint, 'forecast');
}

interface FanPaintStep { paint: Paint; css: string }
function paintAmount(target: number, baseCss: string, background: string): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(tint(baseCss, mid, background), background) > target) lo = mid;
    else hi = mid;
  }
  let amount = (lo + hi) / 2;
  while (amount > 0 && contrastRatio(tint(baseCss, amount, background), background) < target) amount = Math.max(0, amount - 1 / 512);
  return amount;
}

function fanPaintStep(centrePaint: Paint, baseCss: string, background: string, amount: number): FanPaintStep {
  const paint: Paint = 'css' in centrePaint
    ? mixedPaint(centrePaint, { token: 'background' }, 1 - amount, 'highlight')
    : { ...centrePaint, tint: amount };
  return { paint, css: tint(baseCss, amount, background) };
}

function preferredFanPaints(
  centrePaint: Paint, baseCss: string, background: string, showBounds: boolean,
): FanPaintStep[] | undefined {
  const amounts = [0.82, 0.65]; // outer 18% and inner 35% of the central colour
  if (showBounds) {
    const innerContrast = contrastRatio(tint(baseCss, amounts[1]!, background), background);
    const centreContrast = contrastRatio(baseCss, background);
    amounts.push(paintAmount(Math.sqrt(innerContrast * centreContrast), baseCss, background));
  }
  const ladder = amounts.map((amount) => fanPaintStep(centrePaint, baseCss, background, amount));
  const colors = [background, ...ladder.map((step) => step.css), baseCss];
  return colors.slice(1).every((color, index) => contrastRatio(colors[index]!, color) >= 1.2)
    ? ladder : undefined;
}


export function fanPaintSteps(theme: Theme, centrePaint: Paint, bandCount: number, showBounds: boolean, seriesId: string, deEmphasized: boolean): FanPaintStep[] {
  const floor = 1.2;
  const baseCss = paintColor(theme, centrePaint);
  const background = theme.color.background;
  const cBase = contrastRatio(baseCss, background);
  let capacity = 0;
  for (let acc = floor; acc <= cBase + 1e-9; acc *= floor) capacity++;
  const needed = bandCount + 1 + (showBounds ? 1 : 0);
  const rungs = Math.max(needed, Math.min(5, capacity));
  if (capacity < needed) throw new NormalizeError(
    'fan-tint-exhausted',
    'fan.bands',
    `series '${seriesId}' (${baseCss}) has ${cBase.toFixed(2)}:1 contrast on '${theme.name}': ${capacity} distinguishable washes at ${floor.toFixed(2)}:1; ${bandCount} bands plus centre${showBounds ? ' and bounds' : ''} need ${needed}`,
    `use fewer bands${showBounds ? ', disable showBounds to save one rung' : ''}${deEmphasized ? `, highlight '${seriesId}'` : ''}, or a darker fill; the current washes cannot be distinguished`,
  );
  const preferred = bandCount === 2 ? preferredFanPaints(centrePaint, baseCss, background, showBounds) : undefined;
  if (preferred) return preferred;
  const fanLadder: FanPaintStep[] = [];
  for (let i = 1; i <= bandCount + (showBounds ? 1 : 0); i++) {
    const amount = paintAmount(Math.pow(cBase, i / rungs), baseCss, background);
    fanLadder.push(fanPaintStep(centrePaint, baseCss, background, amount));
  }
  return fanLadder;
}

/**
 * The qualitative band ladder of a bullet, from `poor` to `good`, evenly
 * spaced in OKLab lightness. Neighbouring bands keep the swatch floor
 * (0.12 lightness is 12 OKLab units between greys): when the
 * theme's neutral range is narrower than the ladder needs, the poor end moves
 * on toward the mark ink until it is wide enough, so four bands read as four.
 * The bar paints in the mark ink. When the band farthest from the page falls
 * under 3:1 against it, the whole ladder moves toward the page, as little as
 * clears that band, and its lightest band stays 0.06 lightness from the page;
 * a ladder that cannot clear stays where it was and the bar keeps its outline
 * (separationStroke). A range the ink cannot widen warns and keeps its mix.
 * The light ladder is the default: the good end sits 0.06 lightness from the
 * page and the bands step 0.06 apart (the warning floor), not 0.12, so the
 * bands stay behind the bar at every row count. `light` marks rows that print
 * every band's name; with the theme's `marks.bulletBandFill: 'full'` only
 * those rows keep the light ladder and the rest step 0.12 apart.
 * `tones`: a band with a tone takes its tone's fill washed toward the page
 * (bulletToneTint) in place of its ladder step.
 */
export function bulletBandPaints(theme: Theme, count: number, poor: Paint, good: Paint, warnings: LintWarning[] = [], light = false,
  tones?: readonly (BulletBandTone | null | undefined)[]): Paint[] {
  // Every band node and key swatch resolves the ladder again at paint time; the searches run once per
  // ladder. The key holds the colours the ladder reads, so a theme edited in place misses it.
  const full = theme.marks?.bulletBandFill === 'full';
  const toned = tones?.some((tone) => tone) ? tones : undefined;
  const key = JSON.stringify([count, light, full, poor, good, paintColor(theme, poor), paintColor(theme, good),
    paintColor(theme, { token: 'background' }), paintColor(theme, { token: 'markInk' }),
    toned ? [toned, ...toned.map((tone) => tone && paintColor(theme, markRolePaint(tone, true)))] : null]);
  let ladder = bulletLadders.get(key);
  if (!ladder) {
    const own: LintWarning[] = [];
    const steps = bulletLadder(theme, count, poor, good, own, light || !full);
    ladder = { paints: toned ? steps.map((step, index) => toned[index] ? bulletToneTint(theme, toned[index]!, full) : step) : steps, warnings: own };
    if (bulletLadders.size >= 256) bulletLadders.clear();
    bulletLadders.set(key, ladder);
  }
  for (const warning of ladder.warnings) warnings.push({ ...warning });
  return [...ladder.paints];
}

export type BulletBandTone = 'good' | 'warn' | 'bad' | 'neutral';

/**
 * How far each band tone sits from the page, in OKLab lightness. Good sits
 * furthest, as the percentOfTarget scale's good band does (goodFill at 68 %
 * toward white), so the zone the bar should reach reads first. Bad sits
 * nearest: a wide off-plan zone stays a pale wash and the bar, not the zone,
 * carries the alarm. The steps keep good and bad apart in lightness, also for
 * red-green colour vision, where their hues meet.
 */
const BULLET_TONE_STEP: Record<BulletBandTone, number> = { good: 0.13, warn: 0.11, bad: 0.09, neutral: 0.15 };

/**
 * A toned bullet band (or an attainment wash): the tone's fill washed toward
 * the page until it sits its step (BULLET_TONE_STEP) from the page, decided in
 * the theme the scene is painted in. A fill already within its step keeps its
 * colour. `full` (the theme's `marks.bulletBandFill: 'full'`) keeps the fill.
 */
function bulletToneTint(theme: Theme, tone: BulletBandTone, full: boolean): Paint {
  const base = markRolePaint(tone, true);
  if (full) return base;
  const page = theme.color.background;
  const baseCss = paintColor(theme, base);
  const pageL = oklabLightness(page) ?? 1;
  const distance = (amount: number) => Math.abs((oklabLightness(tint(baseCss, amount, page)) ?? pageL) - pageL);
  const step = BULLET_TONE_STEP[tone];
  if (distance(0) <= step) return base;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const amount = (low + high) / 2;
    if (distance(amount) >= step) low = amount;
    else high = amount;
  }
  return { ...base, tint: low };
}

const bulletLadders = new Map<string, { paints: Paint[]; warnings: LintWarning[] }>();

function bulletLadder(theme: Theme, count: number, poor: Paint, good: Paint, warnings: LintWarning[], light: boolean): Paint[] {
  const PAGE_STEP = 0.06;
  const BAND_STEP = (light ? PAGE_STEP : PALETTE_NORMAL_FLOOR / 100) + 0.005;
  const lightness = (paint: Paint) => oklabLightness(paintColor(theme, paint)) ?? 0;
  const needed = BAND_STEP * Math.max(0, count - 1);
  const ink: Paint = { token: 'markInk' };
  // The poor end of the ladder from poor to good: moved toward the mark ink until the span holds the steps.
  const ladderEnd = (from: Paint, to: Paint): Paint => {
    const lastL = lightness(to);
    if (count <= 1 || Math.abs(lightness(from) - lastL) >= needed) return from;
    let low = 0;
    let high = 1;
    const reach = lightness(mixedPaint(from, ink, 0)) - lastL;
    if (Math.abs(reach) < needed) return from;
    for (let step = 0; step < 20; step++) {
      const weight = (low + high) / 2;
      if (Math.abs(lightness(mixedPaint(from, ink, 1 - weight)) - lastL) >= needed) high = weight;
      else low = weight;
    }
    return mixedPaint(from, ink, 1 - high);
  };
  const inkCss = paintColor(theme, ink);
  const page: Paint = { token: 'background' };
  const pageL = lightness(page);
  const toPage = (paint: Paint, weight: number): Paint => weight === 0 ? paint : mixedPaint(paint, page, 1 - weight);
  const clears = (weight: number) =>
    contrastRatio(inkCss, paintColor(theme, ladderEnd(toPage(poor, weight), toPage(good, weight)))) >= MARK_CONTRAST_FLOOR;
  if (light && count > 1) {
    // The good end moves toward the page until it is 0.06 from it; the poor end then sits the steps away.
    if (Math.abs(lightness(good) - pageL) > PAGE_STEP) {
      let low = 0;
      let high = 1;
      for (let step = 0; step < 16; step++) {
        const weight = (low + high) / 2;
        if (Math.abs(lightness(toPage(good, weight)) - pageL) >= PAGE_STEP) low = weight;
        else high = weight;
      }
      good = toPage(good, low);
    }
    const far = ladderEnd(poor, good);
    const goodL = lightness(good);
    if (Math.abs(lightness(far) - goodL) > needed) {
      let low = 0;
      let high = 1;
      for (let step = 0; step < 20; step++) {
        const weight = (low + high) / 2;
        if (Math.abs(lightness(mixedPaint(far, good, weight)) - goodL) >= needed) high = weight;
        else low = weight;
      }
      poor = mixedPaint(far, good, high);
    } else poor = far;
  } else if (count > 1 && !clears(0) && Math.abs(lightness(good) - pageL) > PAGE_STEP) {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 16; step++) {
      const weight = (low + high) / 2;
      if (Math.abs(lightness(toPage(good, weight)) - pageL) >= PAGE_STEP) low = weight;
      else high = weight;
    }
    const most = low;
    if (clears(most)) {
      low = 0;
      high = most;
      for (let step = 0; step < 16; step++) {
        const weight = (low + high) / 2;
        if (clears(weight)) high = weight;
        else low = weight;
      }
      poor = toPage(poor, high);
      good = toPage(good, high);
    }
  }
  const lastL = lightness(good);
  const dark = ladderEnd(poor, good);
  const firstL = lightness(dark);
  const span = lastL - firstL;
  if (count > 1 && Math.abs(span) < 0.06 * (count - 1)) {
    warnings.push({
      code: 'band-lightness-insufficient',
      severity: 'warn',
      message: `${count} bands cannot keep a 0.06 lightness step and separate the measure within the theme's neutral range; authored bands and colors remain`,
    });
  }
  return Array.from({ length: count }, (_, index) => {
    if (count > 1 && index === 0) return dark;
    if (count > 1 && index === count - 1) return good;
    const fraction = count === 1 ? 0.5 : index / (count - 1);
    if (Math.abs(span) < 0.06 * Math.max(1, count - 1)) return mixedPaint(dark, good, 1 - fraction);
    const target = firstL + span * fraction;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 16; step++) {
      const weight = (low + high) / 2;
      const l = lightness(mixedPaint(dark, good, 1 - weight));
      if ((l - target) * Math.sign(span) < 0) low = weight;
      else high = weight;
    }
    return mixedPaint(dark, good, 1 - (low + high) / 2);
  });
}

/**
 * A plain segment colour within 2:1 of the total's reads as a small total. It
 * takes a light tint (60%, else 35%) of the first plain segment colour that
 * stands apart from the total, when that tint also stands apart from the total
 * and 1.3:1 from every colour in use. The check reads the theme painted in, so
 * a repaint reruns it.
 */
function segmentApartPaints(theme: Theme, plain: readonly Paint[], others: readonly Paint[]): Paint[] {
  const totalCss = paintColor(theme, { token: 'total' });
  const apart = (paint: Paint) => contrastRatio(paintColor(theme, paint), totalCss) >= 2;
  const result = [...plain];
  const base = plain.find(apart);
  if (!base) return result;
  const tints = [0.6, 0.35];
  for (let index = 0; index < result.length; index++) {
    if (apart(result[index]!)) continue;
    const used = [...others, ...result].map((other) => paintColor(theme, other));
    const weight = tints.find((w) => {
      const candidate = mixedPaint(base, { token: 'background' }, w);
      const css = paintColor(theme, candidate);
      return apart(candidate) && used.every((other) => contrastRatio(css, other) >= 1.3);
    });
    if (weight !== undefined) result[index] = mixedPaint(base, { token: 'background' }, weight, 'neutral');
  }
  return result;
}

/**
 * The story lines of a highlighted bump chart (line.bump). The first takes the
 * focus, the second the mark ink (or the first series colour a palette step
 * from the focus). A third and later one takes the first series colour that
 * is not in use and stays a palette step (PALETTE_NORMAL_FLOOR) from every
 * earlier story colour and from the context grey; with none left, the first
 * unused series colour. The choice reads the theme, so each third and later
 * line keeps it as a bump-story recipe that a repaint resolves again.
 */
export function bumpStoryPaints(theme: Theme, count: number): Paint[] {
  const css = (paint: Paint) => paintColor(theme, paint);
  const focus: Paint = { token: 'focus' };
  const pool = theme.color.series.map((_, index) => seriesPaint(index));
  const second = [{ token: 'markInk' } as Paint, ...pool]
    .find((paint) => palettePerceptualDistance(css(paint), css(focus)) >= PALETTE_NORMAL_FLOOR) ?? focus;
  const result: Paint[] = [focus, second];
  const grey = css({ token: 'neutralLight' });
  while (result.length < count) {
    const used = result.map(css);
    const unused = pool.filter((paint) => !used.includes(css(paint)));
    result.push(unused.find((paint) => [...used, grey].every((other) => palettePerceptualDistance(css(paint), other) >= PALETTE_NORMAL_FLOOR))
      ?? unused[0] ?? focus);
  }
  return result.slice(0, count);
}

/** How far each status tone washes toward the page before it has to step back. */
const STATUS_TONE_WASH = { good: 0.78, neutral: 0.67 } as const;
/**
 * The OKLab step a washed status cell keeps from every other cell colour, for
 * normal and for red-green colour vision: a ramp class step, the distance at
 * which neighbouring classes of a sequential ramp still read apart.
 */
const STATUS_TONE_APART = 6;
function statusToneApart(a: string, b: string): boolean {
  return Math.min(palettePerceptualDistance(a, b), palettePerceptualDistance(a, b, 'protan'), palettePerceptualDistance(a, b, 'deutan')) >= STATUS_TONE_APART;
}

/**
 * A good or neutral status cell (the status-tone recipe): the tone washed
 * toward the page, stepped back toward the full tone until it reads further
 * from the page than the cell with no status and a palette step
 * (STATUS_TONE_APART, red-green vision included) from it and from every
 * other state colour, and a step further from the page than the hatch
 * ground of a hatched state in the same tone, so an actual reads stronger
 * than its forecast. On a dark page it also draws the APCA contrast the
 * same wash draws on white.
 */
const statusToneByTheme = new WeakMap<Theme, WeakMap<object, string>>();
// The recipe reads only the theme's colours, hatch pattern and mark switches.
// The themes one render builds per width share those parts, so a state
// resolves once per set of them.
const statusToneByParts = new WeakMap<object, WeakMap<object, WeakMap<object, Map<string, string>>>>();
const NO_MARKS = {};
function statusToneColor(theme: Theme, source: Extract<ThemePaintSource, { kind: 'status-tone' }>): string {
  let byTheme = statusToneByTheme.get(theme);
  if (!byTheme) statusToneByTheme.set(theme, byTheme = new WeakMap());
  const known = byTheme.get(source);
  if (known !== undefined) return known;
  let byPattern = statusToneByParts.get(theme.color);
  if (!byPattern) statusToneByParts.set(theme.color, byPattern = new WeakMap());
  let byMarks = byPattern.get(theme.pattern);
  if (!byMarks) byPattern.set(theme.pattern, byMarks = new WeakMap());
  const marks = theme.marks ?? NO_MARKS;
  let bySource = byMarks.get(marks);
  if (!bySource) byMarks.set(marks, bySource = new Map());
  const key = JSON.stringify(source);
  let color = bySource.get(key);
  if (color === undefined) bySource.set(key, color = statusToneSearch(theme, source));
  byTheme.set(source, color);
  return color;
}

function statusToneSearch(theme: Theme, source: Extract<ThemePaintSource, { kind: 'status-tone' }>): string {
  const page = theme.color.background;
  const base = paintColor(theme, source.base);
  if (theme.marks?.statusFill === 'full') return base;
  const empty = paintColor(theme, source.empty);
  const under = (source.under ?? []).map((paint) => paintColor(theme, paint));
  const others = [empty, ...under, ...(source.apartFrom ?? []).map((paint) => paintColor(theme, paint))];
  const emptyContrast = contrastRatio(empty, page);
  const underContrast = Math.max(1, ...under.map((color) => contrastRatio(color, page)));
  const wash = STATUS_TONE_WASH[source.role];
  // A wash toward a dark page darkens a cell more, to the eye, than the same
  // wash lightens it on white: there the wash also steps back until its APCA
  // contrast with the page reaches what the same wash draws on a white page.
  const darkPage = contrastRatio(page, '#FFFFFF') > contrastRatio(page, '#000000');
  const lightContrast = darkPage ? apcaContrast(tint(base, wash, '#FFFFFF'), '#FFFFFF') : 0;
  for (let step = Math.round(wash * 50); step > 0; step--) {
    const washed = tint(base, step / 50, page);
    if (contrastRatio(washed, page) > emptyContrast && contrastRatio(washed, page) >= underContrast
      && apcaContrast(washed, page) >= lightContrast
      && others.every((other) => statusToneApart(washed, other))) return washed;
  }
  return base;
}

export function adaptivePaintColor(theme: Theme, source: Extract<ThemePaintSource, {kind: 'line-band' | 'line-context' | 'line-apart' | 'line-forecast' | 'fan-step' | 'bullet-band' | 'segment-apart' | 'bump-story' | 'status-tone'}>): string {
  switch (source.kind) {
    case 'status-tone': return statusToneColor(theme, source);
    case 'bump-story': return paintColor(theme, bumpStoryPaints(theme, source.count)[source.index]!);
    case 'segment-apart': return paintColor(theme, segmentApartPaints(theme, source.plain, source.others)[source.index]!);
    case 'line-apart': return paintColor(theme, lineApartPaint(theme, source.share, source.top, source.apartFrom, source.darker));
    case 'line-band': return paintColor(theme, lineBandPaint(theme, source.base, source.seriesId));
    case 'line-context': return paintColor(theme, lineContextPaint(theme, source.rank, source.rungCount, source.seriesId));
    case 'line-forecast': return paintColor(theme, lineForecastPaint(source.base, theme, source.crossesBand));
    case 'fan-step': return paintColor(theme, fanPaintSteps(theme, source.base, source.bandCount, source.showBounds, source.seriesId, source.deEmphasized)[source.index]!.paint);
    case 'bullet-band': return paintColor(theme, bulletBandPaints(theme, source.count, source.poor, source.good, [], source.light === true, source.tones)[source.index]!);
  }
}
