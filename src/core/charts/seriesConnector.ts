/**
 * The one number and the one rule shared by the stacked series connectors in
 * the column chart and its horizontal bar twin.
 *
 * THE RULE — a series connector is EDGE-FLUSH. The ink's edge on the side where
 * the segment's own fill lies sits exactly on the cumulative level; the
 * centreline sits half an envelope off it. A connector continues the silhouette
 * of the segment it belongs to, so it must not lay ink outside that silhouette.
 *
 * Why not centre it, as every other rule in this library does: a filled rect
 * encodes its value as a FILL BOUNDARY, not as a stroke centre. A centred stroke
 * on that boundary puts half its width above the bar with nothing beneath it,
 * and the eye compares "where the grey starts" against "where the teal starts"
 * and sees the connector floating. Flush beats centred here, because the
 * connector's job is to read as the bar's own top edge carried across the gap.
 * The centreline moves ~0.38 units off the level; the EDGE that a reader
 * actually compares lands on it exactly, so this reports the number the same
 * way the bar does.
 *
 * Each END is offset separately rather than sliding the whole line: across a
 * category where the series' sign flips, its fill is below the level at one end
 * and above it at the other, so one shared offset cannot flush both. Two
 * offsets can — the line stays straight (two points always are), it just
 * acquires a hair more slope. `edgeFlushEndpoints` solves for that.
 *
 * The endpoints are not tucked 1px under the bars. That moves only the gap-axis
 * coordinate while the other stays pinned to the corners, which SHEARS the line
 * off both (0.12 units in column, 0.72 in bar). Nothing needs masking — butt
 * caps stop on the bar's edge and the bars paint after the connectors.
 *
 * Scope: stacked column and its horizontal bar twin. The waterfall bridge
 * connector is NOT flushed — see the note at the bottom of this file.
 */

/**
 * Place a connector's endpoints so its ink is EDGE-FLUSH with both corners: the
 * boundary of the stroke on the side where each segment's own fill lies passes
 * exactly through that segment's corner, instead of the centreline passing
 * through it and half the ink hanging outside the silhouette.
 *
 * The offset is PERPENDICULAR to the line, magnitude `width / 2`. That matters:
 * the intuitive alternative — offsetting along the value axis by the ink's
 * extent at fixed x, `(w/2)·√(1+slope²)` — is exact for a shallow line and
 * diverges for a steep one: a bar connector that crosses a row gap at a slope
 * of 4.6 moves by 1.76 units, five times the stroke's own half-width. Perpendicular is bounded by `width / 2` at every slope,
 * which is the whole point.
 *
 * `fillDir` says which way, along `axis` and in SCREEN coordinates, that series'
 * own fill lies from the level it reports: +1 toward larger coordinates, -1
 * toward smaller, 0 for a zero-valued segment, which emits no rect and so has no
 * silhouette to be flush with (its endpoint stays on the level). Column offsets
 * against y and a positive segment's fill is BELOW its top edge, so it passes
 * +1; bar offsets against x and a positive segment's fill is to the LEFT of its
 * right edge, so it passes -1. Leaving that sign to the caller is what lets one
 * implementation serve both twins.
 *
 * Sign-flipping stacks: when the series' fill is below the level at one end and above it at the other,
 * no single displacement flushes both, so the two ends are offset separately.
 * That rotates the line by ~width/length, which moves the normal, which moves
 * the offsets — a fixed point, not a formula. Three iterations converge it; when
 * both ends flush the same way (every single-signed stack, i.e. nearly all real
 * data) the first pass is already exact. Pure function of its inputs, so
 * determinism is untouched.
 */
export function edgeFlushEndpoints(
  width: number,
  axis: 'x' | 'y',
  corner1: { x: number; y: number },
  corner2: { x: number; y: number },
  fillDir1: -1 | 0 | 1,
  fillDir2: -1 | 0 | 1,
): { p1: { x: number; y: number }; p2: { x: number; y: number } } {
  const r = width / 2;
  let p1 = { ...corner1 };
  let p2 = { ...corner2 };
  for (let i = 0; i < 3; i += 1) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) break;
    // Unit normal, oriented so its component along `axis` is positive; then
    // fillDir just multiplies it.
    let nx = -dy / length;
    let ny = dx / length;
    const along = axis === 'y' ? ny : nx;
    // Degenerate: the line runs parallel to the offset axis, so "toward the
    // fill" has no component to follow. Leave it on the corners.
    if (along === 0) return { p1: { ...corner1 }, p2: { ...corner2 } };
    if (along < 0) {
      nx = -nx;
      ny = -ny;
    }
    p1 = { x: corner1.x + fillDir1 * r * nx, y: corner1.y + fillDir1 * r * ny };
    p2 = { x: corner2.x + fillDir2 * r * nx, y: corner2.y + fillDir2 * r * ny };
  }
  return { p1, p2 };
}

/**
 * Which way a series' own fill lies from the cumulative level it reports.
 *
 * A ZERO segment returns 0 and its endpoint stays centred on the level. Stated
 * because it is a real exception, not an oversight: column emits no rect at all
 * for a zero value, and bar emits a 0.5-unit minimum-visible sliver, so there is
 * either no silhouette to be flush with or one too degenerate to have a
 * meaningful side. The residual straddle is ~0.12 units against a 0.5-unit
 * sliver. The flush gates exclude these endpoints EXPLICITLY rather than
 * quietly passing them.
 */
export function fillDirection(value: number | null): -1 | 0 | 1 {
  if (value === null || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

export const CONNECTOR_STYLE_DESCRIPTION =
  "Connector stroke: solid 'line' (default) or 'dashed', matching the waterfall bridge's dash.";

/**
 * The waterfall bridge connector is NOT edge-flushed, because a bridge is not
 * the same object as a stacked connector.
 *
 * A stacked connector reports ONE cumulative edge with its fill on one side, so
 * a rigid half-stroke offset flushes both of its ends. A bridge reports a level
 * that TWO bars touch, from opposite sides, and in about half the bridge
 * connectors of the fixtures the two ends' fills point OPPOSITE ways
 * (ebit-bridge: 4 of 6). No rigid offset flushes both of those ends. The only
 * thing that does is a rotation — and a bridge that tilts is a bridge that
 * lies, since "exactly level" is its entire semantic content.
 *
 * The cost is a 0.5-unit straddle at every bridge corner, identical in both
 * orientations because the transpose leaves node.width alone. The bridge's 1px
 * corner air gap is applied after any transpose (insetBridgeEnds() in
 * waterfall/layout.ts), so the horizontal twin keeps 1px too.
 */
