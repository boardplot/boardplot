/**
 * `render`: validate, lay out and draw. An invalid spec comes
 * back with one error per field and nothing drawn; warnings never block.
 */
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { resolveTheme } from '../core/theme';
import { canonicalJson, sha256 } from '../core/claims';
import { chartReading } from '../core/reading';
import { chartNotes } from '../core/notes';
import { completeDiagnostic, type DocumentFinding } from '../core/doc/diagnostics';
import { patchApplies } from '../core/diagnostics/jsonPatch';
import type { LintWarning } from '../core/types/scene';
import type { RenderTarget } from '../core/types/options';
import { addDocumentLints, asSent, drawsWithOptions, layoutChart, loadSpec, shareScaleGroups, type DrawnChart } from './spec';
import { InputError, ok, rejected, type VerbResult } from './result';
import { attributeSizeOverride, keepSizeUnit, length, pixels, targetArgument, withSize } from './size';
import { rasterize } from './raster';
import { applyRows, rewriteRowsDiagnostics, type RowsInput } from './rows';
import { activeFontTables, fontTablesSummary, withFontTables } from './activeFontTables';
import { pushAll } from '../core/arrays';

interface RenderInput extends RowsInput {
  spec: unknown;
  format?: string;
  target?: unknown;
  width?: unknown;
  height?: unknown;
  scale?: unknown;
  background?: unknown;
  outDir?: string;
  overwrite?: boolean;
  return?: readonly string[];
  /** A file built by `boardplot fonts build`; `BOARDPLOT_FONT_TABLES` names one when this is absent. */
  fontTables?: string;
}

const RETURNS = ['svg', 'reading'] as const;

function renderOptions(input: RenderInput) {
  if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') {
    throw new InputError('invalid-argument', 'overwrite must be a boolean', { path: '/overwrite' });
  }
  const format = (input.format ?? 'svg') as 'svg' | 'png';
  if (format !== 'svg' && format !== 'png') {
    throw new InputError('invalid-argument', 'format must be svg or png', {
      path: '/format', expected: { values: ['svg', 'png'] }, suggest: 'Pass format svg, or png for an image.',
      fix: [{ op: 'replace', path: '/format', value: 'svg' }],
    });
  }
  const returned = input.return ?? ['reading'];
  const unknown = returned.filter((entry) => !(RETURNS as readonly string[]).includes(entry));
  if (unknown.length) {
    throw new InputError('invalid-argument', `return takes svg and reading, not ${unknown.join(', ')}`, {
      path: '/return', expected: { values: [...RETURNS] }, suggest: 'Pass return as a list of svg and reading.',
    });
  }
  const scale = pixels('scale', input.scale) ?? 2;
  if (scale > 8) {
    throw new InputError('invalid-argument', 'scale must be at most 8', {
      path: '/scale', expected: { maximum: 8 }, suggest: 'Pass a scale between 1 and 8.', fix: [{ op: 'replace', path: '/scale', value: 8 }],
    });
  }
  // 'transparent' leaves the canvas rectangle out. Halos and hollow
  // marks keep the theme background colour, so the host surface should match it.
  const background = input.background ?? 'theme';
  if (background !== 'theme' && background !== 'transparent') {
    throw new InputError('invalid-argument', 'background must be theme or transparent', {
      path: '/background', expected: { values: ['theme', 'transparent'] }, suggest: 'Pass background theme, or transparent to leave the canvas out.',
      fix: [{ op: 'replace', path: '/background', value: 'theme' }],
    });
  }
  return {
    format, returned, scale, background, target: targetArgument(input.target),
    width: length('width', input.width), height: length('height', input.height),
  };
}

/** The resolved target and natural output size next to the layout size (PresentationInfo). */
function presentation({ geo, request }: Pick<DrawnChart, 'geo' | 'request'>) {
  const info = geo.presentation;
  return { target: info?.target ?? request.target, ...(info ? { naturalSize: info.naturalSize, minDisplayWidth: info.minDisplayWidth } : {}) };
}

/** Chart names never traverse paths. */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'chart';
}

/** Existing files keep their names unless overwrite is explicit. Names within one call stay distinct. */
function writeFreshFiles(directory: string, files: readonly { name: string; body: string | Buffer }[], extension: string, overwrite: boolean): string[] {
  const existing = new Map(readdirSync(directory).map((entry) => [entry.toLowerCase(), entry]));
  const taken = new Set(overwrite ? [] : existing.keys());
  return files.map(({ name: base, body }) => {
    for (let suffix = 1; ; suffix++) {
      const candidate = `${suffix === 1 ? base : `${base}-${suffix}`}${extension}`;
      if (taken.has(candidate.toLowerCase())) continue;
      taken.add(candidate.toLowerCase());
      const path = join(directory, overwrite ? existing.get(candidate.toLowerCase()) ?? candidate : candidate);
      const symlink = () => new InputError('out-is-symlink', `${path} is a symlink; overwrite does not write through it`, { path: '/outDir', suggest: 'Remove the link, or write to another outDir.' });
      // Overwrite replaces a file, never the target of a symlink planted in its place.
      // lstat covers Windows, which has no O_NOFOLLOW.
      if (overwrite && lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw symlink();
      try {
        const fd = openSync(path, overwrite ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW : 'wx');
        try { writeFileSync(fd, body); } finally { closeSync(fd); }
        return path;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (overwrite && code === 'ELOOP') throw symlink();
        if (code !== 'EEXIST') throw error;
      }
    }
  });
}

interface Drawing { name: string; chart: DrawnChart; svg: string; fontFamily: string; png?: Buffer }

function outDirectory(outDir: string | undefined): string | undefined {
  if (outDir === undefined) return undefined;
  if (typeof outDir !== 'string' || outDir === '') {
    throw new InputError('invalid-argument', 'outDir must be a directory path', { path: '/outDir', suggest: 'Pass an absolute directory path.' });
  }
  return resolve(outDir);
}

/**
 * An out path ending in .png or .svg names the file of a single chart. A
 * trailing separator or an existing folder keeps it a folder; the check reads
 * the path as passed, because resolve drops the trailing separator.
 */
function outFileExtension(outDir: string | undefined, out: string | undefined): string | undefined {
  if (outDir === undefined || out === undefined || /[\\/]$/.test(outDir) || isFolder(out)) return undefined;
  const extension = extname(out).toLowerCase();
  return extension === '.png' || extension === '.svg' ? extension : undefined;
}

/** A path under a folder without search permission cannot be read here; the write step names that cause. */
function isFolder(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
}

export function render(input: RenderInput): VerbResult {
  return withFontTables(input.fontTables, () => renderWithTables(input));
}

function renderWithTables(input: RenderInput): VerbResult {
  const out = outDirectory(input.outDir);
  const fileExtension = outFileExtension(input.outDir, out);
  // Without --format, an out file's extension picks it: --out chart.png draws a PNG.
  const options = renderOptions({ ...input, format: input.format ?? fileExtension?.slice(1) });
  if (fileExtension && fileExtension !== `.${options.format}`) {
    throw new InputError('invalid-argument', `--out ${basename(out!)} ends in ${fileExtension}, but the format is ${options.format}`, {
      path: '/outDir', suggest: `Pass --format ${fileExtension.slice(1)}, or end --out in .${options.format}.`,
    });
  }
  const rows = applyRows(input.spec, input);
  const loaded = loadSpec(rows.spec, { width: options.width, height: options.height, target: options.target });
  if ('errors' in loaded) return rejected(rewriteRowsDiagnostics(asSent(loaded.errors, loaded.bare), rows.pathMap));
  if (fileExtension && loaded.doc.charts.length > 1) {
    throw new InputError('invalid-argument', `--out names a folder when the spec draws several charts; this spec draws ${loaded.doc.charts.length}, so --out ${basename(out!)} would become a folder`, {
      path: '/outDir', suggest: `Pass --out with a folder path, or render one chart to write ${basename(out!)}.`,
    });
  }
  shareScaleGroups(loaded);
  const { doc, envelope, bare } = loaded;
  envelope.warnings.push(...(rows.warnings ?? []));
  const laid: { name: string; chart: DrawnChart; drawsWith: (changed: Record<string, unknown>) => boolean }[] = [];
  const scopeUses = new Map<string, number>();
  for (const chart of doc.charts) {
    const sized = withSize(chart, options.width, options.height, options.target ?? chart.options?.target as RenderTarget | undefined);
    // Ids carry a hash of the drawing's content (type, data, options with
    // annotations, and the locale that prints its numbers), so two different
    // charts inlined into one page never share an id. The chart's
    // name stays out. The resolved document theme gives light and dark
    // copies distinct ids while scene data-id part names remain stable. A second
    // identical chart in the same call takes `-2`, a third `-3`: the copies
    // would otherwise share every id on the page they are inlined into.
    const { name: _name, ...drawing } = sized;
    // A target argument draws differently, so it joins the hash; without one the hash keeps its old input.
    const hashed = sha256(canonicalJson({ drawing, locale: doc.locale ?? null, theme: resolveTheme(doc.theme), ...(options.target ? { target: options.target } : {}) })).slice(0, 10);
    const uses = (scopeUses.get(hashed) ?? 0) + 1;
    scopeUses.set(hashed, uses);
    const idScope = uses === 1 ? hashed : `${hashed}-${uses}`;
    const before = envelope.warnings.length;
    const drawn = layoutChart(doc, sized, envelope, {
      idScope,
      ...(options.background === 'transparent' ? { background: false as const } : {}),
    }, options.target);
    const drawnCodes = new Set(envelope.warnings.slice(before).map((warning) => warning.code));
    if (drawn) laid.push({ name: chart.name, chart: drawn, drawsWith: (changed) => drawsWithOptions(doc, sized, changed, drawnCodes, options.target) });
  }
  addDocumentLints(doc, envelope, laid);
  const sent = <T extends DocumentFinding>(findings: T[]) => keepSizeUnit(attributeSizeOverride(
    rewriteRowsDiagnostics(asSent(findings, bare), rows.pathMap), options.width, options.height, rows.spec, options.target), rows.spec);
  // A design fix must patch what the caller sent: one aimed at data that rows
  // generated (or that the caller did not write) is left out, and its suggest stays.
  let fontWarning: DocumentFinding | undefined;
  const fontMessages = new Set<string>();
  const warnings = sent(envelope.warnings).map((warning) => {
    if (warning.severity !== 'advice' || !warning.fix || patchApplies(input.spec, warning.fix)) return warning;
    const { fix: _fix, ...rest } = warning;
    return rest;
  }).filter((warning) => {
    if (warning.code !== 'family-outside-metric-class') return true;
    if (!fontWarning) {
      fontWarning = warning;
      fontMessages.add(warning.message);
      return true;
    }
    // Keep the first source path and combine distinct font problems in one batch warning.
    if (!fontMessages.has(warning.message)) {
      fontMessages.add(warning.message);
      fontWarning.message += `; ${warning.path}: ${warning.message}`;
    }
    return false;
  });
  if (envelope.errors.length) return rejected(sent(envelope.errors), warnings);

  const drawings: Drawing[] = laid.map(({ name, chart }) => ({ name, chart, svg: chart.svg, fontFamily: chart.fontFamily }));
  let format: 'svg' | 'png' = options.format;
  if (format === 'png') {
    const rasterized = rasterize(drawings.map((drawing) => ({
      svg: drawing.svg, size: drawing.chart.geo.size, fontFamily: drawing.fontFamily, name: drawing.name,
      text: drawing.chart.geo.scene.flatMap((node) => (node.t === 'text' ? node.lines : [])).join('\n'),
    })), options.scale);
    pushAll(warnings, rasterized.warnings.map((warning) =>
      completeDiagnostic(warning, undefined, [], 'docs/manual.md#getting-a-chart-with-mcp')));
    if (rasterized.pngs) rasterized.pngs.forEach((png, index) => { drawings[index]!.png = png; });
    else format = 'svg';
  }
  const returnSvg = options.returned.includes('svg') || (options.format === 'png' && format === 'svg');
  const outputs = out ? writeOutputs(out, drawings, format, fileExtension !== undefined, warnings, input.overwrite === true) : undefined;
  const charts = drawings.map((drawing) => ({
    size: { width: drawing.chart.geo.size.width, height: drawing.chart.geo.size.height },
    ...presentation(drawing.chart),
    ...(returnSvg ? { svg: drawing.svg } : {}),
    // The notes list, so a host can build an appendix (footer rule).
    notes: chartNotes(drawing.chart.geo),
    ...(options.returned.includes('reading') ? {
      reading: {
        ...chartReading({
          name: drawing.name, type: drawing.chart.def.type, request: drawing.chart.request,
          geometry: drawing.chart.geo as never, claims: drawing.chart.claims,
        }),
        ...(rows.data ? { data: rows.data } : {}),
      },
    } : {}),
  }));
  const images = drawings.flatMap((drawing) => (drawing.png ? [drawing.png] : []));
  const body = charts.length === 1 && bare
    ? { ...charts[0]!, warnings }
    : { charts: charts.map((chart, index) => ({ name: drawings[index]!.name, ...chart })), warnings };
  const fontTables = fontTablesSummary(activeFontTables());
  return ok({ errors: [], ...body, ...(outputs ? { outputs } : {}), ...(fontTables ? { fontTables } : {}) }, images);
}

/**
 * `asFile`: the out path names the one chart's file, extension case kept. A
 * PNG that fell back to SVG keeps that name with .svg.
 */
function writeOutputs(out: string, drawings: readonly Drawing[], format: 'svg' | 'png', asFile: boolean, warnings: LintWarning[], overwrite: boolean): string[] {
  if (!isAbsolute(out)) throw new InputError('invalid-argument', 'outDir must be absolute', { path: '/outDir' });
  const directory = asFile ? dirname(out) : out;
  const extension = asFile && extname(out).toLowerCase() === `.${format}` ? extname(out) : `.${format}`;
  // Every chart is validated and serialized before this commit phase touches the directory.
  try {
    mkdirSync(directory, { recursive: true });
    const files = drawings.map((drawing) => ({
      name: asFile ? basename(out, extname(out)) : safeName(drawing.name), body: format === 'png' ? drawing.png! : drawing.svg,
    }));
    const written = writeFreshFiles(directory, files, extension, overwrite);
    // The default keeps existing files, but a caller who named one must
    // learn that the drawing went elsewhere, or it reads the stale file.
    written.forEach((path, index) => {
      const requested = join(directory, `${files[index]!.name}${extension}`);
      if (path === requested || (overwrite && path.toLowerCase() === requested.toLowerCase())) return;
      // Two charts of this render whose names give one file name collide with
      // each other, not with an older file.
      const sibling = written.slice(0, index).findIndex((earlier) => earlier.toLowerCase() === requested.toLowerCase());
      warnings.push(completeDiagnostic(sibling >= 0 ? {
        code: 'out-name-taken',
        severity: 'warn',
        message: `charts '${drawings[sibling]!.name}' and '${drawings[index]!.name}' both give the file name ${requested}; this render wrote the first there and this one to ${path}`,
        suggest: 'Give the charts names that differ in letters and digits.',
      } : {
        code: 'out-name-taken',
        severity: 'warn',
        message: `${requested} already exists, so this render wrote ${path}; the existing file is unchanged`,
        suggest: `Read ${path}, or pass --overwrite (overwrite: true) to replace the existing file.`,
      }, undefined, [], 'docs/manual.md#getting-a-chart-with-the-cli'));
    });
    return written;
  } catch (error) {
    // The out path is the caller's input: a file in the way or a folder without
    // write permission is theirs to fix, not an engine failure.
    const cause = OUT_CAUSES[(error as NodeJS.ErrnoException).code ?? ''];
    if (!cause) throw error;
    throw new InputError('out-unwritable', `cannot write to ${directory}: ${cause}`, {
      path: '/outDir', suggest: 'Pass --out with a folder you can write to, or a new path.',
    });
  }
}

const OUT_CAUSES: Record<string, string> = {
  EEXIST: 'it is a file, not a folder',
  ENOTDIR: 'part of the path is a file, not a folder',
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EROFS: 'the file system is read-only',
};
