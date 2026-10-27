/** Target typography checks use emitted roles and sizes. Findings never block layout. */

import { GRAMMAR_STROKE } from '../theme';
import type { LintWarning, TypographyMetadata, TypographyRole } from '../types/scene';
import type { RenderTarget } from '../types/options';
import { DEFAULT_TARGET, targetFloorsPx } from '../target';
import type { Size } from '../geometry';
import { compareText, type FontSpec } from '../text';

import { TABLE_HEAD_PARTS, tableHeadFloorPx, textScaleOf, textSizeOf } from '../typeFloors';
import { maxOf, minOf, pushAll } from '../arrays';

const displayPx = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * Effective mark floors. The stroke floor is a 1px visible core plus a
 * 0.25px antialias reserve. The marker floor is a 4px minimum diameter. The
 * dash floor uses the same 1.25px visible-run reserve as a series stroke.
 * All three are judged after host scaling, like text.
 */
const MARK_MIN_EFFECTIVE_PX = {
  seriesStroke: 1.25,
  markerRadius: 2,
  dashSegment: 1.25,
} as const;

interface SceneTextLike extends TypographyMetadata {
  part?: string;
  lines?: readonly string[];
  opacity?: number;
  t?: string;
  font?: FontSpec;
}

interface SceneMarkLike {
  t?: string;
  id?: string;
  part?: string;
  width?: number;
  dash?: number[];
  lineCap?: 'butt' | 'round' | 'square';
  r?: number;
  d?: string;
  rect?: { w?: number; h?: number };
  owner?: { seriesId?: string };
}

/** Radius of every marker primitive currently admitted by the scene contract. */
function effectiveMarkerRadius(rawNode: unknown): number | undefined {
  const node = rawNode as SceneMarkLike;
  if (node.part !== 'marker') return undefined;
  if (node.t === 'circle' && typeof node.r === 'number') return node.r;
  if (node.t === 'rect' && typeof node.rect?.w === 'number' && typeof node.rect.h === 'number') {
    return Math.min(node.rect.w, node.rect.h) / 2;
  }
  if (node.t !== 'path' || typeof node.d !== 'string') return undefined;
  // Line markers use absolute M/L paths for triangles and diamonds. Measure
  // their actual bounding box so neither shape bypasses the floor.
  if (!/^[MLZ0-9eE+.,\s-]+$/.test(node.d)) return undefined;
  const coordinates = node.d.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  if (coordinates.length < 4 || coordinates.length % 2 !== 0 || coordinates.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  return Math.min(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys)) / 2;
}

interface TypographyGeometry {
  size: Size;
  scene: readonly unknown[];
  marks?: unknown;
  warnings?: readonly LintWarning[];
  presentation?: { target: RenderTarget };
}

/** Declared CSS width or a React host observation. Observations do not change
 * geometry or the authored embed claim. Repeated surface calls add no copies.
 */
export function typeDocLints(
  type: string,
  options: Record<string, unknown> | undefined,
  geo: TypographyGeometry,
  observedWidth?: number,
): LintWarning[] {
  if (geo.warnings?.some(w => w.severity === 'error')) return [];
  const target = (options?.target as RenderTarget | undefined) ?? geo.presentation?.target ?? DEFAULT_TARGET;
  const findings = targetTypeLints(type, options, geo, target, observedWidth);
  return findings.filter(finding => !geo.warnings?.some(existing => existing.code === finding.code && existing.message === finding.message));
}

function targetTypeLints(
  type: string,
  options: Record<string, unknown> | undefined,
  geo: TypographyGeometry,
  target: RenderTarget,
  observedWidth?: number,
): LintWarning[] {
  const roleFloors = targetFloorsPx(target);
  // A table head is held to the table head floor (two px under the body), as presentationInfo holds it.
  const headFloor = tableHeadFloorPx(target);
  const emitted = new Map<string, { role: TypographyRole; size: number; floor: number; count: number }>();
  for (const raw of geo.scene) {
    const node = raw as SceneTextLike;
    if (node.t !== 'text' || node.opacity === 0 || node.lines?.every(line => line.length === 0) ||
      typeof node.font?.size !== 'number' || !Number.isFinite(node.font.size) || node.font.size <= 0) continue;
    const role = node.typeRole ?? 'label';
    const floor = TABLE_HEAD_PARTS.has(node.part ?? '') ? headFloor : roleFloors[role];
    const key = `${role}|${node.font.size}|${floor}`;
    const existing = emitted.get(key);
    if (existing) existing.count++;
    else emitted.set(key, { role, size: node.font.size, floor, count: 1 });
  }
  const entries = [...emitted.values()].sort((a, b) => compareText(a.role, b.role) || a.size - b.size || a.floor - b.floor);
  const details = (scale: number) => entries.filter(entry => entry.size * scale < entry.floor - 1e-9)
    .map(({ role, size, floor, count }) => `${role} ${displayPx(size)}px → ${displayPx(size * scale)} effective px (floor ${displayPx(floor)}, ${count} node${count === 1 ? '' : 's'})`);
  const findings: LintWarning[] = [];
  const native = details(1);
  const textScale = textScaleOf(options);
  const textSize = textSizeOf(options);
  if (native.length > 0 && textScale < 1) {
    // The user's own scale wins over the floors; the render says what it costs, once.
    const below = entries.filter(entry => entry.size < entry.floor - 1e-9);
    const worst = below.reduce((a, b) => (b.floor / b.size > a.floor / a.size ? b : a));
    const smallest = below.reduce((a, b) => (b.size < a.size ? b : a));
    const needed = Math.ceil(textScale * (worst.floor / worst.size) * 100 - 1e-6) / 100;
    // textSize is the primary label size; the factor that clears the floor lifts it by the same ratio.
    const option = textSize === undefined ? 'textScale' : 'textSize';
    const neededSize = textSize === undefined ? undefined : Math.ceil(textSize * (worst.floor / worst.size) * 100 - 1e-6) / 100;
    findings.push({
      code: 'text-below-floor', severity: 'warn',
      message: `'${type}' draws text below the ${target} floor at ${option} ${displayPx(textSize ?? textScale)}: the smallest is ${smallest.role} ${displayPx(smallest.size)}px (floor ${displayPx(smallest.floor)}px); ${native.join('; ')}.`,
      suggest: textSize === undefined ? `Raise textScale to ${displayPx(needed)}.` : `Raise textSize to ${displayPx(neededSize!)}.`,
      field: ['options', textSize === undefined ? 'textScale' : 'textSize'],
    });
  } else if (native.length > 0) findings.push({
    code: 'type-below-native-min', severity: 'warn',
    message: `'${type}' has text below the ${target} floor at its natural size: ${native.join('; ')}.`,
    suggest: 'Increase the authored type sizes to the target floors, then render again.',
  });
  const embed = (options as { embed?: { width?: unknown } } | undefined)?.embed;
  const width = observedWidth ?? embed?.width;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || geo.size.width <= 0) return findings;
  const scale = width / geo.size.width;
  const minimumScale = Math.max(0.9, maxOf(entries.map(({ size, floor }) => floor / size)));
  if (scale < minimumScale - 1e-9) {
    const violations = details(scale);
    findings.push({
      code: 'type-below-effective-min', severity: 'warn',
      message: `'${type}' has ${observedWidth === undefined ? 'declared' : 'observed'} display width ${displayPx(width)}px on a ${displayPx(geo.size.width)}px canvas ` +
        `(scale ${displayPx(scale)}; minimum safe scale ${displayPx(minimumScale)}).` +
        (violations.length ? ` ${violations.join('; ')}.` : ' Display shrink exceeds 10%.'),
      suggest: `Render for the actual slot, allow scrolling, or offer a full-size view at least ${Math.ceil(geo.size.width * minimumScale)}px wide.`,
      ...(observedWidth === undefined ? { field: ['options', 'embed', 'width'] as const } : {}),
    });
  }
  pushAll(findings, markDocLints(type, geo, width, observedWidth !== undefined));
  return findings;
}

/** Keep mark floors on the same declared or observed scale as text. */
function markDocLints(type: string, geo: TypographyGeometry, embedWidth: number, observed = false): LintWarning[] {
  const s = embedWidth / geo.size.width;
  const canvasWidth = geo.size.width;
  const EPS = 1e-9;
  const findings: LintWarning[] = [];
  const markViolations = new Map<string, { label: string; raw: number; floor: number; count: number }>();
  const addMark = (label: string, raw: number, floor: number): void => {
    if (raw * s >= floor - EPS) return;
    const key = `${label}|${raw}|${floor}`;
    const current = markViolations.get(key);
    if (current) current.count += 1;
    else markViolations.set(key, { label, raw, floor, count: 1 });
  };
  for (const rawNode of geo.scene) {
    const node = rawNode as SceneMarkLike;
    // A page-colour stroke is a separator (a stacked area's band edge), not a
    // series line a reader has to see, so the series-stroke floor skips it.
    const stroke = (rawNode as { stroke?: unknown }).stroke;
    const pageColour = typeof stroke === 'object' && stroke !== null && (stroke as { token?: string }).token === 'background';
    const scopedStroke =
      (node.t === 'line' || node.t === 'path') &&
      (node.part === 'line' || node.part === 'referenceLine') &&
      typeof node.width === 'number' && !pageColour;
    if (scopedStroke) {
      const isContextStroke = node.part === 'referenceLine' || node.width! < 2;
      const series = node.owner?.seriesId ? ` '${node.owner.seriesId}'` : '';
      const floor = node.part === 'referenceLine' ? GRAMMAR_STROKE.rule : MARK_MIN_EFFECTIVE_PX.seriesStroke;
      addMark(`${isContextStroke ? 'context ' : 'hero/series '}stroke${series}`, node.width!, floor);
      for (const [index, segment] of (node.dash ?? []).entries()) {
        if (Number.isFinite(segment) && segment > 0) {
          // Round caps add one stroke width to each dash's painted run.
          const painted = index % 2 === 0 && node.lineCap === 'round' ? segment + node.width! : segment;
          addMark('dash segment', painted, MARK_MIN_EFFECTIVE_PX.dashSegment);
        }
      }
    }
    if (node.part === 'marker') {
      const radius = effectiveMarkerRadius(node);
      if (radius !== undefined) addMark('marker radius', radius, MARK_MIN_EFFECTIVE_PX.markerRadius);
    }
  }
  if (markViolations.size > 0) {
    let markSMin = 0;
    const details = [...markViolations.values()]
      .sort((a, b) => a.floor - b.floor || a.raw - b.raw || compareText(a.label, b.label))
      .map(({ label, raw: rawSize, floor, count }) => {
        markSMin = Math.max(markSMin, floor / rawSize);
        return `${label} ${rawSize}px → ${(rawSize * s).toFixed(1)} effective px (floor ${floor}, ${count} node${count === 1 ? '' : 's'})`;
      });
    const minEmbed = Math.ceil(canvasWidth * markSMin);
    findings.push({
      code: 'mark-below-effective-min',
      // The mark floor is the mark half of the existing effective-pixel text gate, so
      // it deliberately shares the registered severity.
      severity: 'warn',
      message:
        `'${type}' has ${observed ? 'observed' : 'declared'} display width ${displayPx(embedWidth)} on a ${displayPx(canvasWidth)} canvas, so it is shown at ${s.toFixed(2)} of drawn size: ` +
        `${details.join('; ')}. At that scale the marks disappear.`,
      suggest: `Embed it at ${minEmbed}px or wider, or render a canvas the size of the slot.`,
      ...(observed ? {} : { field: ['options', 'embed', 'width'] as const }),
    });
  }

  return findings;
}
