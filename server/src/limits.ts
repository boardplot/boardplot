/**
 * Product limits of the hosted server. They bound the work one
 * anonymous request can cause; they are not engine limits.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const LIMITS = {
  /** Request body, in bytes. */
  bodyBytes: 1024 * 1024,
  rows: 2_000,
  cells: 20_000,
  /** Largest PNG side in device pixels. */
  pngSide: 4_000,
  /** Render deadline in ms. BOARDPLOT_DEADLINE_MS lowers it for a local check only. */
  deadlineMs: envNumber('BOARDPLOT_DEADLINE_MS', 10_000),
  /** Render child processes in the pool. */
  workers: Math.floor(envNumber('BOARDPLOT_WORKERS', 2)),
  /** Characters of one boardplot_chart result (Claude's tool result limit is about 150,000). */
  chartResultChars: 100_000,
  /** Characters of one boardplot_export result. */
  exportResultChars: 120_000,
  /** Both view SVGs together, in characters. Above it only the light SVG travels. */
  viewSvgChars: 90_000,
  /** Base64 characters of the preview PNG for a client without MCP Apps. */
  previewPngChars: 60_000,
} as const;

/** The frame a chart gets when the call names none: 16:9 at engine target report. */
export const DEFAULT_FRAME = { width: 720, height: 405 } as const;
