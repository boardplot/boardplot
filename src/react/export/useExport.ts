"use client";

import { useMemo, useRef } from 'react';
import { useBoardplotTheme } from '../themeContext';
import { EXPORT_LINK, type DrawnChart, type ExportLink } from '../exportLink';
import { copyData, copyImage } from './clipboard';
import { downloadExport } from './download';
import { DRAWN, type DrawnExportInput } from './drawn';
import { exportCsv, exportPng, exportSvg } from './lazy';
import type { ExportFailed, ExportInput, ExportResult } from './types';

export interface UseExport extends ExportLink {
  svg(): Promise<ExportResult>;
  png(scale?: number): Promise<ExportResult>;
  csv(): Promise<ExportResult>;
  downloadSvg(): Promise<ExportResult>;
  downloadPng(scale?: number): Promise<ExportResult>;
  downloadCsv(): Promise<ExportResult>;
  copyImage(): Promise<ExportResult>;
  copyData(): Promise<ExportResult>;
}

/**
 * File export. Pass the handle to a chart as `exporter={handle}` and each
 * call exports what that chart drew, at its size on screen; without a drawn
 * chart it exports `input` (a spec or a request) at its fallback size. Each
 * call lays out canonical geometry again. Clipboard permission is requested
 * only from copyImage and copyData.
 */
export function useExport(input: ExportInput = {}): UseExport {
  const inherited = useBoardplotTheme();
  const latest = useRef(input);
  latest.current = { ...input, context: { ...inherited, ...input.context } };
  const charts = useRef(new Map<object, DrawnChart>());
  return useMemo(() => {
    /** One snapshot per call, taken before any await. */
    const current = (): DrawnExportInput | ExportFailed => {
      const drawn = [...charts.current.values()];
      if (drawn.length > 1) {
        return { ok: false, code: 'invalid', message: `This useExport() handle is the exporter of ${drawn.length} charts; give each chart its own useExport().` };
      }
      const chart = drawn[0];
      return chart ? { ...latest.current, [DRAWN]: chart } : latest.current;
    };
    const run = (format: (input: ExportInput) => Promise<ExportResult>) => () => {
      const input = current();
      return 'ok' in input ? Promise.resolve(input) : format(input);
    };
    const svg = run(exportSvg);
    const png = (scale = 2) => run((input) => exportPng(input, scale))();
    const csv = run(exportCsv);
    return {
      [EXPORT_LINK]: (owner: object, drawn: DrawnChart | undefined) => {
        if (drawn) charts.current.set(owner, drawn);
        else charts.current.delete(owner);
      },
      svg,
      png,
      csv,
      downloadSvg: () => downloadExport('svg', svg),
      downloadPng: (scale) => downloadExport('png', () => png(scale)),
      downloadCsv: () => downloadExport('csv', csv),
      copyImage: run(copyImage),
      copyData: run(copyData),
    };
  }, []);
}
