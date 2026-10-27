import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../src/core/charts/index';
// Every type gets a preview, the choropleth and tilemap included, so every geo pack loads.
import '../../src/core/geo/packs';
import { interactionRecords } from '../../src/core/a11y/records';
import { describedWithCard, hundredPercentComposition, layoutLabelCard, layoutLabelCardContent, sharedLabelCardContent, type CompositionOptions } from '../../src/react/hover/labelCard';
import { overlayInputs, panelOverlayTheme } from '../../src/react/hover/placement';
import { highlightScene, recordBounds } from '../../src/react/hover/highlight';
import { bandTypes, categorySiblings } from '../../src/react/hover/engine';
import { targetId } from '../../src/core/a11y/recordsShared';
import { listCharts, type Fixture } from '../../src/core/registry';
import { layoutResolvedRequest, resolveChartRequest } from '../../src/core/request';
import { renderSvg } from '../../src/core/svg/renderSvg';
import type { Rect } from '../../src/core/geometry';
import { getFixtures } from '../../src/fixtures/index';

export interface HoverPreview {
  type: string;
  family: string;
  fixture: string;
  placement: 'beside' | 'frame' | 'overlay';
  target: Rect | null;
  /** The frame the card had to stay inside: the drawn canvas. */
  frame: Rect;
  /** Null where the demo mark opens no card (a diagram node that prints all it carries). */
  card: Rect | null;
  svg: string;
}

/** A type whose preview failed, a refused demo fixture say; the other types still draw. */
export interface HoverPreviewError {
  type: string;
  family: string;
  fixture: string;
  error: string;
}

export function generateHoverPreviews(families: readonly string[]): (HoverPreview | HoverPreviewError)[] {
  return families.flatMap(family => listCharts().map(({ type }) => {
    const fixture = getFixtures(type).find(candidate => candidate.kind === 'example' && candidate.hover);
    if (!fixture?.hover) throw new Error(`${type} has no hover demo fixture`);
    try {
      return preview(type, family, fixture);
    } catch (error) {
      return { type, family, fixture: fixture.id, error: (error as Error).message };
    }
  }));
}

function preview(type: string, family: string, fixture: Fixture<any, any>): HoverPreview {
  const hover = fixture.hover!;
  const request = resolveChartRequest({ type, data: fixture.data, options: fixture.options,
    annotations: fixture.annotations, theme: family });
  const geometry = layoutResolvedRequest(request);
  if (geometry.refused) throw new Error(`${type}/${family} hover fixture refused`);
  const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
  const target = { chart: request.scope.chart,
    ...(hover.panel === undefined ? {} : { panel: hover.panel }), owner: hover.owner };
  const record = records.find(candidate => candidate.id === targetId(target));
  if (!record) throw new Error(`${type}/${family} hover target does not resolve`);
  const placement = overlayInputs(request, geometry);
  const panel = placement.panels?.find(panel => panel.panel === record.target.panel);
  const theme = panel ? panelOverlayTheme(panel, request.theme) : request.theme;
  const bounds = recordBounds(record, geometry.scene, geometry.debug.occupied);
  const frame = { x: 0, y: 0, w: geometry.size.width, h: geometry.size.height };
  if (record.cardFields?.length === 0) {
    return { type, family, fixture: fixture.id, placement: 'beside' as const, target: bounds ?? null,
      frame, card: null, svg: renderSvg(geometry, request.theme) };
  }
  // The preview shows what a pointer on the demo mark shows: on a banded
  // chart the whole category, the pointed series first.
  const active = [record, ...categorySiblings(records, record, bandTypes[panel?.type ?? type] !== undefined)];
  const cardOptions = { hundredPercent: hundredPercentComposition(panel?.type ?? type,
    panel ? panel.composition : request.options as CompositionOptions) };
  const input = { record, plot: panel?.plot ?? geometry.plot, canvas: frame,
    occupied: geometry.debug.occupied, target: bounds, theme, card: cardOptions };
  const card = active.length > 1
    ? layoutLabelCardContent(input, sharedLabelCardContent(active, undefined, cardOptions))
    : layoutLabelCard(input);
  const previewGeometry = { ...geometry,
    a11y: { ...geometry.a11y, desc: describedWithCard(geometry.a11y.desc, card.accessibleText) },
    scene: [...highlightScene(geometry.scene, records, active, theme), ...card.scene] };
  return { type, family, fixture: fixture.id, placement: card.placement, target: bounds ?? null,
    frame, card: card.rect, svg: renderSvg(previewGeometry, request.theme) };
}

const output = process.argv[2];
if (output && resolve(process.argv[1]!) === fileURLToPath(import.meta.url)) {
  const families = process.argv.slice(3);
  if (!families.length) throw new Error('hover preview generation requires at least one family');
  writeFileSync(output, JSON.stringify(generateHoverPreviews(families)));
}
