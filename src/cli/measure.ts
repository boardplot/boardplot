/**
 * `measure`: the smallest, natural and comfortable size one spec needs,
 * without drawing. A size refusal is an answer here, not an
 * error. It names a verified size that draws without a size warning.
 */
import type { ChartMeasurement } from '../core/request';
import type { RenderTarget } from '../core/types/options';
import type { DocumentFinding } from '../core/doc/diagnostics';
import { asSent, loadSpec, measureChart, shareScaleGroups } from './spec';
import { ok, rejected, type VerbResult } from './result';
import { keepSizeUnit, length, targetArgument, withSize } from './size';
import { applyRows, rewriteRowsDiagnostics, type RowsInput } from './rows';
import { activeFontTables, fontTablesSummary, withFontTables } from './activeFontTables';

interface MeasureInput extends RowsInput {
  spec: unknown;
  target?: unknown;
  width?: unknown;
  /** A file built by `boardplot fonts build`; `BOARDPLOT_FONT_TABLES` names one when this is absent. */
  fontTables?: string;
}

type Measured = ChartMeasurement & { target: RenderTarget };

function refusal(measured: Measured) {
  if (!measured.refused) return null;
  const cause = measured.refused.warnings.find((warning) => warning.severity === 'error') ?? measured.refused.warnings[0];
  return {
    code: cause?.code ?? 'size-below-floor',
    message: cause?.message ?? 'the chart does not fit the requested size',
    ...(cause?.fix && cause.expected?.minimum ? { required: cause.expected.minimum } : {}),
    ...(cause?.suggest ? { suggest: cause.suggest } : {}),
  };
}

function dimensions(measured: Measured) {
  const presentation = measured.geometry?.presentation;
  const drawn = measured.geometry ? measured.drawnHeight ?? measured.geometry.size.height : undefined;
  return {
    target: measured.target,
    // The layout this measure made at the requested width, as tall as the chart draws it: a pinned
    // frame taller than the drawing (a circle is bound by its width) leaves empty bands a host
    // would reserve. The natural output size follows, as the footer frame scales it.
    ...(measured.geometry ? { size: { width: measured.geometry.size.width, height: drawn! } } : {}),
    ...(presentation ? { naturalSize: drawn! < measured.geometry!.size.height
      ? { ...presentation.naturalSize, height: presentation.naturalSize.height * drawn! / measured.geometry!.size.height } : presentation.naturalSize,
    minDisplayWidth: presentation.minDisplayWidth } : {}),
    minWidth: measured.minWidth,
    minHeight: measured.minHeight,
    minHeightAtWidth: measured.minHeightAtWidth,
    naturalWidth: measured.naturalWidth,
    naturalHeight: measured.naturalHeight,
    comfortableWidth: measured.comfortableWidth,
    comfortableHeight: measured.comfortableHeight,
    fit: measured.fit,
    ...(measured.compactFloor ? { compactFloor: measured.compactFloor } : {}),
    ...(measured.mode ? { mode: measured.mode } : {}),
    titleLines: measured.titleLines ?? null,
    refused: refusal(measured),
  };
}

export function measure(input: MeasureInput): VerbResult {
  return withFontTables(input.fontTables, () => measureWithTables(input));
}

function measureWithTables(input: MeasureInput): VerbResult {
  const width = length('width', input.width);
  const target = targetArgument(input.target);
  const rows = applyRows(input.spec, input);
  const loaded = loadSpec(rows.spec, { width, target, measure: true });
  if ('errors' in loaded) return rejected(rewriteRowsDiagnostics(asSent(loaded.errors, loaded.bare), rows.pathMap));
  shareScaleGroups(loaded);
  const { doc, envelope, bare } = loaded;
  envelope.warnings.push(...(rows.warnings ?? []));
  const measured: { name: string; result: Measured }[] = [];
  for (const chart of doc.charts) {
    const result = measureChart(doc, withSize(chart, width, undefined, target ?? chart.options?.target as RenderTarget | undefined), envelope, target);
    if (result) measured.push({ name: chart.name, result });
  }
  const sent = <T extends DocumentFinding>(findings: T[]) => keepSizeUnit(rewriteRowsDiagnostics(asSent(findings, bare), rows.pathMap), rows.spec);
  if (envelope.errors.length) return rejected(sent(envelope.errors), sent(envelope.warnings));
  const warnings = sent(envelope.warnings);
  const fontTables = fontTablesSummary(activeFontTables());
  return ok({ errors: [], ...(fontTables ? { fontTables } : {}), ...(measured.length === 1 && bare
    ? { ...dimensions(measured[0]!.result), warnings }
    : { charts: measured.map(({ name, result }) => ({ name, ...dimensions(result) })), warnings }),
  ...(rows.data ? { data: rows.data } : {}) });
}
