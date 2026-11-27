import type { ExportInput, ExportOk, ExportResult } from './types';

let engine: Promise<ReturnType<typeof import('./engine').linkedEngine>> | undefined;
/** The export engine, loaded once, at the first export call. */
const loaded = () => engine ??= import('./engine').then((module) => module.linkedEngine(), (error: unknown) => { engine = undefined; throw error; });

export async function exportSvg(input: ExportInput): Promise<ExportResult> {
  return (await loaded()).exportSvg(input);
}
export async function exportCsv(input: ExportInput): Promise<ExportResult> {
  return (await loaded()).exportCsv(input);
}
export async function exportPng(input: ExportInput, scale: number): Promise<ExportResult> {
  return (await loaded()).exportPng(input, scale);
}
/** The PNG and the SVG it was painted from, from one layout. */
export async function renderPng(input: ExportInput, scale: number): Promise<{ png: ExportResult; svg?: ExportOk }> {
  return (await loaded()).renderPng(input, scale);
}
