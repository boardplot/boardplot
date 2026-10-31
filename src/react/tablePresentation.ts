import { tableDisplayFloor, tableFrameMode } from '../core/charts/table/widths';
import type { BaseOptions, Subtitle } from '../core/types/options';
import { compositeColor, contrastRatio, mixColors } from '../core/color';
import { isSafeSvgColor, resolvePaint } from '../core/svg/paint';
import {
  cellGrounds,
  colorblindTheme,
  tableEmphasis,
  farGround,
  panelTypeClass,
  resolveSurface,
  sameRecipe,
  smallestTitleSize,
  themeForWidth,
  warnColor,
  strokeToken,
  tableInkColor,
} from '../core/theme';
import { tableInk } from '../core/charts/table/statement';
import { checkedFontFamily, checkedMotionEasing } from '../core/themeRules';
import { interactionTokens } from '../core/a11y/theme';
import { INLINE_LINE_RATIO, LINE_BOX_EPSILON, LINE_RATIO, levelLadder, type TableDensity } from '../core/charts/table/ladder';
import { chipPaints, onTableGround, tableGround, toneTextPaint } from '../core/charts/table/chips';
import { CHANGE_LINE_MIN_PX, CHANGE_LINE_SIZE_STEP_PX, changeLineFont, ENGINE_NOTES, INLINE_LABEL_INDENT, tableFonts } from '../core/charts/table/tracks';
import { formatScenarios, resolveCanvasOptions, resolveSubtitle } from '../core/normalize/shared';
import { numericVariant } from '../core/textRole';
import { tableFootnotes } from '../core/charts/table/view';
import { defaultNotePlacement, notesPointer } from '../core/notes';
import { localeStrings } from '../core/strings';
import { footerType } from '../core/footer';
import type { ResolvedColumn, ResolvedRow, ResolvedTable } from '../core/types/table';
import type { ResolvedChartRequest } from '../core/request';
import { DEFAULT_TARGET, scaleTextPx } from '../core/target';
import type { RenderTarget } from '../core/types/options';
import type { PresentationInfo } from '../core/types/sizing';
import type { StickyLabels, TableOptions } from '../core/types/table';
import type { Theme } from '../core/types/theme';
import type { Paint } from '../core/types/scene';

/** The same target-resolved faces drive track measurement, CSS and preparation. */
export function tableRenderTheme(request: ResolvedChartRequest): Theme {
  const typeClass = panelTypeClass(request.options) ?? request.size.width;
  const theme = typeClass === undefined ? request.theme : themeForWidth(request.theme, typeClass);
  return (request.options as TableOptions).colorblindSafe ? colorblindTheme(theme) : theme;
}

/** Read the shared table type floor for the HTML frame. */
export function tablePresentation(request: ResolvedChartRequest, table: ResolvedTable): Pick<PresentationInfo, 'target' | 'minDisplayWidth'> {
  return tableDisplayFloor(table, tableRenderTheme(request), request.options as TableOptions, request.target, request.size.width,
    tableFrame(table, request.options as TableOptions));
}

interface RenderTableHtmlOptions extends Pick<BaseOptions, 'title' | 'subtitle' | 'unit' | 'source' | 'footnotes' | 'notes' | 'target' | 'mode' | 'size' | 'margin' | 'canvas' | 'strings' | 'locale' | 'a11y'> {
  caption?: string;
  interactive?: boolean;
  stickyLabels?: StickyLabels;
  density?: TableDensity;
  anchorWash?: boolean;
  /**
   * Fragment mode (report compiler): omit the per-table <style> block —
   * the host document emits the table stylesheet ONCE via
   * tableStylesheet(theme).
   */
  fragment?: boolean;
}

interface TableStyleFeatures {
  inCellBar: boolean;
  rowHighlight: boolean;
  anchorWash: boolean;
  statement?: boolean;
  /** A cohort density: a row grows to hold its inline lines and bars instead of cutting them at the fixed pitch. */
  cohort?: boolean;
  /** The object form of `stickyLabels` is in use: its page head, head switch and section rules come with it, and a 0.27 table draws none of them. */
  sticky?: boolean;
}

/**
 * The cohort densities fix a row at one pitch (--bp-row-h). A row that holds an
 * inline line or a bar is taller than that, and its cells were cut. The pitch
 * stays the least a row takes, so a one-line row keeps its height. It is added
 * only for a cohort density, so every other grid keeps its stylesheet.
 * A row name on two lines (`rowLabelLines`) grows the row as the SVG does: the
 * lines sit 1.2em apart and the block keeps the pitch's air, so each extra line
 * adds one line pitch (layout: `rowHeight + ceil((lines - 1) * size * 1.2)`).
 * The air counts the rule above the cell, which the first row and a row after a
 * spacer or a total draw without.
 */
const COHORT_GROWTH = '\n.bp-table-grid[data-bp-density^="cohort"] [role="row"]>*{height:auto;min-height:var(--bp-row-h)}\n.bp-table-grid[data-bp-density^="cohort"] [role="row"].bp-total>*{height:auto;min-height:calc(var(--bp-row-h) + 8px)}'
  + '\n.bp-table-grid[data-bp-density^="cohort"] [role="row"]:not(.bp-total)>[role="rowheader"] .bp-value{line-height:round(up,1.2em,1px);margin-block:calc((var(--bp-row-h) - round(up,1.2em,1px) - var(--bp-rule-top,var(--bp-stroke-hair)))/2)}'
  + '\n.bp-table-grid[data-bp-density^="cohort"] :is([data-bp-rowgroup="body"],[data-bp-row-page="0"])>.bp-rowwrap:first-child>[role="row"]>*,.bp-table-grid[data-bp-density^="cohort"] [role="row"][data-bp-spacer]:not(.bp-total)>*,.bp-table-grid[data-bp-density^="cohort"] .bp-rowwrap:has(>.bp-total)+.bp-rowwrap>[role="row"]>*{--bp-rule-top:0px}';

/** HTML framing shares notes and mode selection with the React table. */
export function tableFrame(
  table: ResolvedTable,
  options: RenderTableHtmlOptions,
  rows: readonly ResolvedRow[] = table.rows,
  columns: readonly ResolvedColumn[] = table.columns,
) {
  options = resolveCanvasOptions(options);
  const title = options.title === false ? undefined : options.title;
  const padding = options.margin
    ? `${options.margin.top ?? 0}px ${options.margin.right ?? 0}px ${options.margin.bottom ?? 0}px ${options.margin.left ?? 0}px`
    : undefined;
  const mode = tableFrameMode(options);
  const subtitle = subtitleText(options.subtitle, table.unit ?? options.unit);
  const authored = options.footnotes === false ? [] : options.footnotes ?? [];
  const markerNotes = mode === 'compact' && options.title ? authored : [];
  // The list is not an <ol>: no note carries a number, the author's
  // included. Nothing in a table points at one, and a
  // "1)" that no head or cell refers to is a number the reader cannot
  // follow; the SVG table prints its notes the same way. `footnotes: false`
  // hands the author's notes to the host and keeps the engine's disclosures,
  // as the SVG frame does.
  // As in the SVG table, the
  // engine's notes are disclosures: they print only where `notes.show` lists
  // 'disclosure', else they sit in the 'info' panel. The author's notes are
  // notes, first, and print where `notes.placement` is 'frame' and
  // `notes.show` keeps 'note'. Elsewhere ('info', the dashboard default, or
  // 'list') they sit behind the pointer, as in ChartFooter.
  // A dimswitch hands its own disclosures (partial period, n.m., hidden periods) on in ENGINE_NOTES, after the table's.
  const derived = [...tableFootnotes(table, rows, columns), ...((options as { [ENGINE_NOTES]?: string[] })[ENGINE_NOTES] ?? [])];
  const notes = options.footnotes === false || markerNotes.length > 0 ? [] : authored;
  const placement = options.notes?.placement ?? defaultNotePlacement(options.target);
  const framed = placement === 'frame' && (options.notes?.show ?? ['note']).includes('note');
  // An authored `notes.maxLines` holds the notes and the source line, as in the SVG; the rest go behind the pointer.
  // shortcut: one note counts as one line here (the grid wraps after layout); count wrapped lines if a host needs it.
  const budget = options.notes?.maxLines === undefined ? Infinity : Math.max(0, options.notes.maxLines - (options.source ? 1 : 0));
  const inFrame = framed ? notes.slice(0, budget) : [];
  const disclosed = (options.notes?.show ?? []).includes('disclosure');
  const footnotes = [...inFrame, ...(disclosed ? derived : [])];
  const listed = options.notes?.pointer === false ? [] : [...notes.slice(inFrame.length), ...(!disclosed && placement === 'info' ? derived : [])];
  const words = { ...localeStrings(options.locale?.language), ...options.strings };
  return {
    mode, title, subtitle, source: options.source && sourceLine(options.source, options.strings?.source ?? 'Source'), footnotes, padding,
    listed,
    pointer: listed.length === 0 ? undefined : placement === 'info' ? `${words.notesAndSources} (${listed.length})` : notesPointer(listed.length, words),
    markerNotes: markerNotes.join(' '),
    // The author's accessible description replaces the generated summary, as it does in the SVG.
    summary: options.a11y?.description ?? options.caption ?? [title, subtitle,
      `Table with ${table.rows.length} rows and ${table.columns.length} columns.`]
      .filter((part): part is string => Boolean(part)).join(' · '),
  };
}

/**
 * The source credit as the SVG frame draws it: "Source: <source>",
 * unless the text already opens with that word. A copy of `sourceLine` in
 * core/frame.ts, which does not export it.
 */
function sourceLine(source: string, word: string): string {
  const opensWithWord = source.slice(0, word.length).toLowerCase() === word.toLowerCase() &&
    /^\p{L}*\s*:/u.test(source.slice(word.length));
  return opensWithWord ? source : `${word}: ${source}`;
}

/**
 * The subtitle line as plain text — ONE implementation for every
 * string-emitting surface: this renderer and `TableChart`, which imports it
 * from here instead of keeping a second copy.
 *
 * `resolveSubtitle` first, because `subtitle` is a union of string and object
 * and the STRING form is the common authoring one.
 * Treating it as an opaque label dropped the unit on the floor: the SVG of the
 * same table printed "Revenue in $M" while this surface printed "Revenue" over
 * cells whose $M had already been HOISTED out of them — the money lost its
 * scale on one surface only.
 */
function subtitleText(
  subtitle: string | Subtitle | undefined,
  unit: string | undefined,
): string | undefined {
  const sub = resolveSubtitle(subtitle);
  if (sub === undefined) return undefined;
  const measure = unit ? `${sub.measure} in ${unit}` : sub.measure;
  return [sub.company, measure, sub.period, sub.scenarios?.length ? formatScenarios(sub.scenarios) : undefined]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** The head paddings a theme sets, as stylesheet variable names and px. */
function headPadVars(theme: Theme): [string, number][] {
  const pads: [string, number | undefined][] = [
    ['head-pad-top', theme.table?.headPad?.top],
    ['head-pad-bottom', theme.table?.headPad?.bottom],
    ['group-pad-top', theme.table?.groupPad?.top],
    ['group-pad-bottom', theme.table?.groupPad?.bottom],
  ];
  return pads.filter((entry): entry is [string, number] => entry[1] !== undefined);
}

/**
 * The head block's air: the theme's where it names it, else the
 * SVG's own: no air above a head, the 7 px gap to the rule under it,
 * and a group heading 6 px over its line box and 2 px under its hairline.
 * The grid padded its heads with the row air and drew them 8 px taller.
 */
function headPadRules(): string {
  return '\n.bp-table-grid [data-bp-rowgroup="head"] .bp-columns>*{padding-top:var(--bp-head-pad-top,0px);padding-bottom:var(--bp-head-pad-bottom,7px)}'
    + '.bp-table-grid [data-bp-rowgroup="head"] .bp-groups>*{padding-top:var(--bp-group-pad-top,6px);padding-bottom:var(--bp-group-pad-bottom,2px)}'
    // Cohort row pitches belong to the body. Target header faces,
    // padding and wrapped lines set their own height, as in SVG layout.
    + '.bp-table-grid [data-bp-rowgroup="head"] [role="row"]>*{height:auto;white-space:normal;overflow-wrap:break-word}'
    // A hidden column keeps its cell in a zero-wide track, and a column that
    // opens grows from zero. A label that wraps there breaks after every
    // letter and stretches its whole head row; it stays on one line instead.
    + '.bp-table-grid [role="row"]>:is([data-bp-hidden],[data-bp-opening]),.bp-table-grid [role="row"]>:is([data-bp-hidden],[data-bp-opening]) *{white-space:nowrap}'
    + '.bp-table-grid .bp-head-label{min-width:0;max-width:calc(100% + var(--bp-header-tracking,0px));margin-inline-end:calc(-1*var(--bp-header-tracking,0px))}'
    + '.bp-table-grid .bp-sort>span,.bp-table-grid .bp-head-sub{min-width:0;white-space:normal;overflow-wrap:break-word;text-overflow:clip}';
}

/** A report supplies paired variables; React uses the literal theme colors. */
/** Full literal stylesheet shared by React and standalone table consumers. */
/**
 * A cell tint (heat band or tone ground) as CSS background longhands: the
 * colour 1 px inside the padding box, clear of the rule above, the next row
 * and its neighbours, as the SVG insets it. The background colour stays with
 * the cascade, so a row, column band or sticky ground shows around the tint.
 */
export const insetTint = (color: string) => ({
  backgroundImage: `linear-gradient(${color},${color})`,
  backgroundPosition: 'center',
  backgroundSize: 'calc(100% - 2px) calc(100% - 2px)',
  backgroundRepeat: 'no-repeat',
});

const insetTintCss = (color: string): string => Object.entries(insetTint(color))
  .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`).join(';');

export function tableStylesheet(theme: Theme, target: RenderTarget = DEFAULT_TARGET, statement = false, cohort = false, sticky = false, textScale = 1, palette?: string): string {
  return renderTableStyle(theme, { inCellBar: true, rowHighlight: true, anchorWash: true, statement, cohort, sticky }, target, textScale, palette);
}

/**
 * The rules of the `stickyLabels` object form, after the rules they refine. `head: 'page'` draws the head in a
 * box of its own outside the sideways scroll box, which the page scroll pins at `--bp-sticky-top`; `head: false` frees
 * the head; `sections` pins the section row under the head (`--bp-sections-top`). Print pins nothing.
 */
const STICKY_RULES = `
.bp-table-grid[data-bp-sticky-head="off"] [data-bp-rowgroup="head"]{position:static}
.bp-table-grid[data-bp-sticky-head="page"]{width:auto;border-bottom:0}
.bp-table-grid[data-bp-sticky-head="page"]>.bp-page-head{position:sticky;top:var(--bp-sticky-top,0px);z-index:4;overflow:hidden;background:var(--bp-background)}
.bp-table-grid[data-bp-sticky-head="page"]>.bp-page-head>[data-bp-rowgroup="head"]{position:static;width:var(--bp-table-width,max-content)}
.bp-table-grid[data-bp-sticky-head="page"]>.bp-scroll{overflow-x:auto;overflow-y:visible}
.bp-table-grid[data-bp-sticky-head="page"] [data-bp-rowgroup="body"]{width:var(--bp-table-width,max-content);border-bottom:var(--bp-stroke-hair) solid var(--bp-rule)}
.bp-table-grid[data-bp-sticky-head="page"] [data-bp-rowgroup="body"]:has(>.bp-rowwrap:last-child>.bp-total),.bp-table-grid[data-bp-sticky-head="page"] [data-bp-rowgroup="body"]:has(>.bp-section-scope:last-child>.bp-rowwrap:last-child>.bp-total){border-bottom:0}
.bp-table-grid[data-bp-sticky-sections]:not([data-bp-sticky-head="page"]) [role="row"][data-role="section"]{position:sticky;top:var(--bp-sections-top,0px);z-index:3}
.bp-table-grid[data-bp-sticky-sections]:not([data-bp-sticky-head="page"]) [role="row"][data-role="section"]>*{background-color:var(--bp-background);background-image:linear-gradient(var(--bp-row-ground),var(--bp-row-ground))}
.bp-table-grid[data-bp-sticky-head="page"]>.bp-section-float{position:sticky;top:var(--bp-sections-top,0px);height:0;z-index:3;pointer-events:none}
.bp-section-float-clip{position:absolute;left:0;right:0;top:0;overflow:hidden}
.bp-section-float-inner{width:var(--bp-table-width,max-content);background:var(--bp-background)}
.bp-section-float-inner [role="row"]>*{background-color:var(--bp-background);background-image:linear-gradient(var(--bp-row-ground),var(--bp-row-ground))}
.bp-table-grid[data-bp-sticky-sections] .bp-section-scope>.bp-rowwrap:first-child:not(:has(>.bp-children)){display:contents}
.bp-table-grid[data-bp-sticky-sections] [data-bp-rowgroup="body"]>.bp-section-scope:first-child>.bp-rowwrap:first-child>[role="row"]>*{border-top:0}
.bp-table-grid[data-bp-sticky-sections]:has([data-bp-rowgroup="body"]>.bp-section-scope:last-child>.bp-rowwrap:last-child>.bp-total){border-bottom:0}
@media print{.bp-table-grid[data-bp-sticky-head="page"]>.bp-section-float{display:none}.bp-table-grid[data-bp-sticky-head="page"]>.bp-page-head{overflow:visible}.bp-table-grid[data-bp-sticky-head="page"] [data-bp-rowgroup]{width:100%!important}.bp-table-grid[data-bp-sticky-head]>.bp-page-head,.bp-table-grid[data-bp-sticky-head] [data-bp-rowgroup="head"],.bp-table-grid[data-bp-sticky-sections] [role="row"][data-role="section"]{position:static}}`;

function renderTableStyle(
  theme: Theme,
  features: TableStyleFeatures = { inCellBar: false, rowHighlight: false, anchorWash: false },
  target: RenderTarget = DEFAULT_TARGET,
  textScale = 1,
  palette?: string,
): string {
  const vars = [
    ['ink', theme.color.ink],
    ['ink-inverse', theme.color.inkInverse],
    ['ink-muted', theme.color.inkMuted],
    // The tertiary ink, only where the theme sets it.
    ...(theme.color.inkMeta === undefined ? [] : [['ink-meta', theme.color.inkMeta] as const]),
    ['good', theme.color.good],
    ['bad', theme.color.bad],
    ['warn', theme.color.warn ?? '#8F6A00'],
    ['neutral', theme.color.neutral],
    ['neutral-light', theme.color.neutralLight],
    ['highlight', theme.color.highlight],
    ['total', theme.color.total],
    ['others', theme.color.others],
    ['axis', theme.color.axis],
    ['grid', theme.color.grid],
    ['leader', theme.color.leader],
    ['background', theme.color.background],
    // Grounds and rules: the total band, the group band one step
    // lighter, and the structural rule the header, total and close share.
    ['emphasis', mixColors(theme.color.neutral, theme.color.background, Math.min(1, resolveSurface(theme).bandTint * 2))],
    ['column-band-strong', mixColors(theme.color.ink,
      mixColors(theme.color.neutral, theme.color.background, Math.min(1, resolveSurface(theme).bandTint * 2)),
      resolveSurface(theme).bandTint)],
    ['band', mixColors(theme.color.neutral, theme.color.background, resolveSurface(theme).bandTint)],
    ['rule', theme.color.rule ?? theme.color.axis],
    // The table's quiet rule and its secondary and toggle inks (`table.ruleInk`, `table.inks`).
    ['rule-row', tableInkColor(theme, 'rule')],
    ['ink-2', tableInkColor(theme, 'secondary')],
    ['toggle', tableInkColor(theme, 'toggle')],
    ['tile-shadow', mixColors(theme.color.ink, theme.color.background, 0.12)],
  ] as const;
  const colorDeclarations = vars.map(([name, value]) => `--bp-${name}:${cssValue(checkedCssColor(value))}`);
  // The status chip the SVG draws: a tone wash behind ink-mixed tone text
  //, from colours the line above has already checked.
  const chipDeclarations = (['good', 'bad', 'warn', 'neutral'] as const).flatMap((tone) => {
    const chip = chipPaints(theme, tone, palette);
    return [`--bp-chip-${tone}-bg:${cssValue(checkedCssColor(resolvePaint(chip.fill, theme)))}`,
      `--bp-chip-${tone}-ink:${cssValue(checkedCssColor(resolvePaint(chip.ink, theme)))}`];
  });
  // Tone text, the colour the SVG prints a toned figure in: 4.5:1 on the page and every row ground.
  const toneTextDeclarations = (['good', 'bad', 'warn'] as const).map((tone) =>
    `--bp-${tone}-text:${cssValue(checkedCssColor(resolvePaint(toneTextPaint(theme, tone, palette), theme)))}`);
  const typeVars = (['title', 'subtitle', 'label', 'axis', 'footnote'] as const).flatMap((name) => {
    const font = theme.type[name];
    return [
      [`${name}-size`, `${font.size}px`],
      [`${name}-weight`, String(font.weight)],
      [`${name}-line-height`, String(font.lineHeight ?? 1.2)],
    ] as const;
  });
  // The same ladder the SVG steps, so a level reads one step down on
  // both surfaces. Density changes the padding here, as it always has; the
  // type steps come from the theme.
  const ladder = levelLadder(theme, 'regular', target, textScale);
  const levelVars = ([1, 2, 3] as const).map(
    (level) => [`level-${level}-size`, `${ladder.size(level)}px`] as const,
  );
  // The ladder's own air, so the grid and the SVG pad a rung with
  // the same numbers. The density step stays in CSS, as it always has.
  const padVars = [
    ['pad-anchor', ladder.pad(0, true)],
    ['pad-leaf', ladder.pad(1, false)],
    ['pad-deep', ladder.pad(3, false)],
    ['pad-total', ladder.totalPad],
  ] as const;
  const motion = interactionTokens(theme);
  const surface = resolveSurface(theme);
  // The head face the SVG draws, and the ratio both surfaces take
  // its line box from: ceil(size x ratio), the micro-pixel off first.
  const headFace = tableFonts(theme, ladder).header;
  const changeFace = changeLineFont(theme, ladder, 0);
  const headRatio = theme.table?.head?.lineHeight ?? LINE_RATIO;
  const sectionSpace = theme.table?.section?.spaceBefore ?? ladder.lineBox(ladder.label);
  const declarations = [
    ...colorDeclarations,
    ...chipDeclarations,
    ...toneTextDeclarations,
    `--bp-stroke-hair:${strokeToken(theme, 'hair')}px`,
    `--bp-stroke-rule:${strokeToken(theme, 'rule')}px`,
    `--bp-stroke-row:${theme.table?.ruleWidths?.row ?? strokeToken(theme, 'hair')}px`,
    `--bp-stroke-mark:${strokeToken(theme, 'mark')}`,
    `--bp-font-family:${cssValue(checkedFontFamily(theme.type.family))}`,
    ...typeVars.map(([name, value]) => `--bp-${name}:${cssValue(value)}`),
    ...levelVars.map(([name, value]) => `--bp-${name}:${cssValue(value)}`),
    `--bp-group-size:${cssValue(`${ladder.group}px`)}`,
    `--bp-micro-size:${cssValue(`${ladder.micro}px`)}`,
    // The footer's text (notes, source, notes list): the small role the SVG footer draws (footerType).
    `--bp-foot-size:${cssValue(`${footerType(theme.type.footnote, target, textScale).size}px`)}`,
    ...padVars.map(([name, value]) => `--bp-${name}:${cssValue(`max(1px,calc(${value}px + var(--bp-pad-step)))`)}`),
    `--bp-inline-gap:${cssValue(`${ladder.inlineGap}px`)}`,
    // The air above the label of a section that follows other rows, inside its row as on the SVG,
    // and the smaller air of a section that is the first row under the head.
    `--bp-section-space:${cssValue(`${sectionSpace}px`)}`,
    `--bp-section-lead:${cssValue(`${Math.round(Math.min(sectionSpace, ladder.lineBox(ladder.label) / 4))}px`)}`,
    // The chip corner the SVG draws, from the theme. A status table
    // squares its chips on both surfaces.
    `--bp-chip-radius:${cssValue(`${surface.chipRadius}px`)}`,
    // The head block's air, only where the theme names it; unset,
    // the head rules fall back to the row air they always had.
    ...headPadVars(theme).map(([name, value]) => `--bp-${name}:${cssValue(`${value}px`)}`),
    `--bp-line-ratio:${cssValue(String(LINE_RATIO))}`,
    `--bp-head-size:${cssValue(`${headFace.size}px`)}`,
    `--bp-head-ratio:${cssValue(String(headRatio))}`,
    `--bp-inline-ratio:${cssValue(String(INLINE_LINE_RATIO))}`,
    `--bp-title-compact-size:${cssValue(`${smallestTitleSize(theme)}px`)}`,
    `--bp-motion-fade:${cssValue(`${motion.fade}ms`)}`,
    `--bp-motion-layout:${cssValue(`${motion.layout}ms`)}`,
    `--bp-motion-easing:${cssValue(checkedMotionEasing(motion.easing))}`,
  ].join(';');
  // Figures belong to the cells that hold numbers, and they follow
  // `theme.type.numeric` like every other numeric text. The rule does not
  // sit on the table element, so the prose readout column and the status
  // badges keep proportional figures.
  const figures = numericVariant('value', theme) ?? 'tabular-nums';
  const featureStyles = renderFeatureStyles(theme, features);
  const tableRules = renderTableConventions(theme, target, features.statement, textScale) + (features.cohort ? COHORT_GROWTH : '');
  // A row draws every value at the ladder's role weight, as the SVG
  // does (`rowFont`), not only the row header.
  // A glyph keeps the body weight and a strong column uses emphasis, as there.
  // A column head draws the header face's tracking, as the SVG does:
  // the grid writes it with the size, and the width pass measures both.

  return `<style>
.bp-table{${declarations};margin:0;color:var(--bp-ink);background:var(--bp-background);font-family:var(--bp-font-family);font-size:var(--bp-label-size);line-height:var(--bp-label-line-height)}
.bp-table figcaption{margin:0 0 .9em}.bp-table .bp-title,.bp-table .bp-subtitle{display:block}.bp-table .bp-title{font-size:var(--bp-title-size);font-weight:var(--bp-title-weight);line-height:var(--bp-title-line-height)}.bp-table .bp-subtitle{margin-top:.2em;color:var(--bp-ink);font-size:var(--bp-subtitle-size);font-weight:var(--bp-subtitle-weight);line-height:var(--bp-subtitle-line-height)}
.bp-table .bp-key{display:flex;flex-wrap:wrap;gap:0 14px;margin-top:8px;font-size:var(--bp-footnote-size);font-weight:var(--bp-footnote-weight);line-height:18px}.bp-table .bp-key>span{display:inline-flex;align-items:center;gap:5px}.bp-table .bp-key i{flex:none;box-sizing:border-box;width:12px;height:12px;border:var(--bp-stroke-hair) solid var(--bp-grid)}.bp-table .bp-key .bp-key-glyph{flex:none;width:12px;font-weight:inherit;text-align:center}
figure.bp-table[data-bp-mode="compact"] .bp-title{font-size:var(--bp-title-compact-size)}.bp-table .bp-footnote-marker{font-size:var(--bp-footnote-size);font-weight:var(--bp-footnote-weight);line-height:0;vertical-align:super}.bp-table .bp-source{margin:.7em 0 0;padding-inline:var(--bp-note-indent,0);color:var(--bp-ink-muted);font-size:var(--bp-foot-size);font-weight:var(--bp-footnote-weight);line-height:var(--bp-footnote-line-height)}
.bp-scroll{overflow-x:auto;max-width:100%;scrollbar-width:thin;scrollbar-color:var(--bp-grid) transparent}.bp-scroll:has(>[data-bp-sticky]){overflow:auto}
figure.bp-table[data-bp-fill-height]{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0}figure.bp-table[data-bp-fill-height]>.bp-scroll{flex:1 1 auto;min-height:0;overflow:auto}.bp-hover-table:has(>figure.bp-table[data-bp-fill-height]){height:100%}
.bp-table-grid .bp-arrow{margin-inline-end:4px}.bp-table .bp-summary,.bp-table-grid .bp-spark-text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.bp-table-grid [role="row"]>[data-encoding="sparkline"]{padding:0;align-items:stretch}.bp-table-grid .bp-spark{display:block}
.bp-table-grid{width:var(--bp-table-width,max-content);border-bottom:var(--bp-stroke-rule) solid var(--bp-rule);--bp-pad-step:0px;--bp-size-step:0px;--bp-cell-pad-x:12px;--bp-inline-size:max(var(--bp-micro-size),calc(var(--bp-label-size) + var(--bp-size-step) - 2px));--bp-inline-box:calc(var(--bp-inline-size)*var(--bp-inline-ratio))}
.bp-table-grid{--bp-inline-box:round(up,calc(var(--bp-inline-size)*var(--bp-inline-ratio)),1px)}
.bp-table-grid:has([data-bp-rowgroup="body"]>.bp-rowwrap:last-child>.bp-total){border-bottom:0}
.bp-table-grid[data-bp-density="compact"]{--bp-pad-step:-1px;--bp-size-step:-.5px}.bp-table-grid[data-bp-density="relaxed"]{--bp-pad-step:2px}
.bp-table-grid[data-bp-density="cohort"]{--bp-size-step:-.5px;--bp-row-h:26px}.bp-table-grid[data-bp-density="cohort-small"]{--bp-size-step:-1px;--bp-row-h:20px}
.bp-table-grid[data-bp-density="cohort"] [role="row"]>*,.bp-table-grid[data-bp-density="cohort-small"] [role="row"]>*{box-sizing:border-box;height:var(--bp-row-h);padding-top:0;padding-bottom:0}
.bp-table-grid[data-bp-density="cohort"] [role="row"].bp-total>*,.bp-table-grid[data-bp-density="cohort-small"] [role="row"].bp-total>*{box-sizing:border-box;height:calc(var(--bp-row-h) + 8px)}
.bp-table-grid [role="row"]{display:grid;grid-template-columns:var(--bp-cols);--bp-row-size:calc(var(--bp-label-size) + var(--bp-size-step));--bp-change-size:max(${CHANGE_LINE_MIN_PX}px,calc(var(--bp-row-size) - ${CHANGE_LINE_SIZE_STEP_PX}px));--bp-row-pad:var(--bp-pad-anchor);--bp-row-ground:transparent;--bp-row-line:calc(var(--bp-row-size)*var(--bp-line-ratio));transition:grid-template-columns var(--bp-motion-layout) var(--bp-motion-easing)}
.bp-table-grid [role="row"]{--bp-row-line:round(up,calc(var(--bp-row-size)*var(--bp-line-ratio)),1px)}
.bp-table-grid [role="row"]:has(.bp-line[data-bp-line]:not(.bp-line-off)){--bp-inline-box:round(up,calc(max(var(--bp-inline-size),var(--bp-change-size))*var(--bp-inline-ratio)),1px)}
.bp-table-grid [role="row"]:has(.bp-line[data-bp-line]:not(.bp-line-off)){--bp-row-line:round(up,calc(max(${CHANGE_LINE_MIN_PX}px,var(--bp-row-size))*var(--bp-line-ratio)),1px)}
.bp-table-grid [role="row"]:has(.bp-line[data-bp-line]:not(.bp-line-off))>*{font-size:max(${CHANGE_LINE_MIN_PX}px,var(--bp-row-size))}
.bp-table-grid [role="row"][data-bp-ground="emphasis"]{--bp-row-ground:var(--bp-emphasis)}.bp-table-grid [role="row"][data-bp-ground="band"]{--bp-row-ground:var(--bp-band)}
.bp-table-grid [role="row"]>*{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;min-width:0;padding:var(--bp-row-pad) var(--bp-cell-pad-x);background:var(--bp-row-ground);font-size:var(--bp-row-size);line-height:var(--bp-row-line);text-align:left;white-space:nowrap;overflow:hidden;transition:background-color var(--bp-motion-fade) var(--bp-motion-easing),opacity var(--bp-motion-fade) ease}
.bp-table-grid [data-bp-hidden]{padding-inline:0;opacity:0;border-inline-start-width:0}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"]>*{border-top:var(--bp-stroke-row) solid var(--bp-rule-row)}.bp-table-grid[data-bp-figures="off"] [data-bp-rowgroup="body"] [role="row"]>*{border-top-width:var(--bp-stroke-hair);border-top-color:var(--bp-grid)}.bp-table-grid :is([data-bp-rowgroup="body"],[data-bp-row-page="0"])>.bp-rowwrap:first-child>[role="row"]>*{border-top:0}
.bp-table-grid [role="row"][data-bp-spacer]{padding-top:var(--bp-row-spacer)}.bp-table-grid :is([data-bp-rowgroup="body"],[data-bp-row-page="0"])>.bp-rowwrap:first-child>[role="row"][data-bp-spacer]{padding-top:0}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-bp-spacer]:not(.bp-total)>*{border-top:0}
.bp-table-grid .bp-rowwrap:has(>.bp-total)+.bp-rowwrap>[role="row"]>*{border-top:0}
.bp-table-grid .bp-value,.bp-table-grid .bp-line{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.bp-table-grid:not([data-bp-label-lines="1"]) [role="rowheader"] .bp-value{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow-wrap:normal}.bp-table-grid [data-bp-wrap]{white-space:pre-line}.bp-table-grid [data-bp-wrap] .bp-value{overflow:visible;text-overflow:clip;line-height:round(up,1.2em,1px);padding-top:calc(round(up,calc(1em*var(--bp-line-ratio)),1px) - round(up,1.2em,1px))}
.bp-table-grid .bp-line{height:var(--bp-inline-box);margin-top:var(--bp-inline-gap);font-size:var(--bp-change-size);font-weight:${changeFace.weight};line-height:var(--bp-inline-box);color:var(--bp-ink-2);transition:height var(--bp-motion-layout) var(--bp-motion-easing),margin-top var(--bp-motion-layout) var(--bp-motion-easing),opacity var(--bp-motion-fade) ease}
.bp-table-grid [role="rowheader"] .bp-line{box-sizing:border-box;padding-inline-start:${INLINE_LABEL_INDENT}px}
.bp-table-grid .bp-line:not(.bp-line-off)~.bp-line,.bp-table-grid .bp-note-line~.bp-line,.bp-table-grid .bp-note-spacer~.bp-line{margin-top:0}
.bp-table-grid .bp-line[data-tone="good"]{color:var(--bp-good-text)}.bp-table-grid .bp-line[data-tone="bad"]{color:var(--bp-bad-text)}.bp-table-grid .bp-line[data-tone="warn"]{color:var(--bp-warn-text)}
.bp-table-grid .bp-line-off{height:0;margin-top:0;opacity:0}
.bp-table-grid .bp-children{overflow:clip;transition:max-height var(--bp-motion-layout) var(--bp-motion-easing),opacity var(--bp-motion-fade) ease}
.bp-table-grid .bp-children[data-bp-collapsed]{max-height:0;opacity:0;pointer-events:none}
.bp-table-grid [data-bp-rowgroup="head"] [role="row"]>*{font-size:var(--bp-header-size,var(--bp-head-size));font-weight:${cssValue(String(headFace.weight))};line-height:round(up,calc(var(--bp-header-size,var(--bp-head-size))*var(--bp-head-ratio) - ${LINE_BOX_EPSILON}px),1px);justify-content:flex-end;border-bottom:0;background:transparent;color:var(--bp-ink)}
.bp-table-grid [data-bp-rowgroup="head"]{border-bottom:${theme.table?.ruleWidths?.head ?? strokeToken(theme, 'hair')}px solid var(--bp-rule)}.bp-table-grid [data-bp-rowgroup="head"] .bp-columns>*{letter-spacing:var(--bp-header-tracking,normal)}
.bp-table-grid .bp-sort{min-width:24px;min-height:24px;display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:0;margin:0;color:inherit;background:transparent;border:0;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}.bp-table-grid .bp-sort>span{overflow:hidden;text-overflow:ellipsis}.bp-table-grid .bp-sort svg{flex:none;color:var(--bp-ink-2)}
.bp-table-grid [aria-sort="ascending"] .bp-sort,.bp-table-grid [aria-sort="descending"] .bp-sort{font-weight:${cssValue(String(headFace.weight))}}.bp-table-grid [aria-sort="ascending"] .bp-sort svg,.bp-table-grid [aria-sort="descending"] .bp-sort svg{color:var(--bp-ink)}
.bp-table-grid .bp-sort:focus-visible{outline:2px solid var(--bp-highlight);outline-offset:2px}
.bp-table-grid[data-bp-sort-indicator="sorted"] .bp-sort:not([data-bp-sort-direction]) svg{visibility:hidden}.bp-table-grid[data-bp-sort-indicator="sorted"] .bp-sort:not([data-bp-sort-direction]):hover svg,.bp-table-grid[data-bp-sort-indicator="sorted"] .bp-sort:not([data-bp-sort-direction]):focus-visible svg{visibility:visible}
.bp-table-grid .bp-head-sub{display:block;max-width:calc(100% + var(--bp-cell-pad-x));margin-inline-end:calc(-1*var(--bp-cell-pad-x));overflow:hidden;text-overflow:ellipsis;font-size:var(--bp-micro-size);font-weight:${(theme.type.micro ?? theme.type.footnote).weight};line-height:1.3;letter-spacing:normal;text-transform:none;color:var(--bp-ink)}.bp-table-grid .bp-num>.bp-head-sub{margin-inline-end:0;margin-inline-start:calc(-1*var(--bp-cell-pad-x))}.bp-table-grid .bp-center>.bp-head-sub{margin-inline:calc(-1*var(--bp-cell-pad-x));max-width:calc(100% + 2*var(--bp-cell-pad-x))}.bp-table-grid .bp-head-sub-spacer{height:calc(var(--bp-micro-size)*1.3)}
.bp-table-grid [data-bp-rowgroup="head"] .bp-groups>*{padding-bottom:.2em;align-items:safe center;font-size:var(--bp-group-head-size,var(--bp-group-size));line-height:round(up,calc(var(--bp-group-head-size,var(--bp-group-size))*var(--bp-head-ratio) - ${LINE_BOX_EPSILON}px),1px);font-weight:${theme.type.axis.weight};letter-spacing:var(--bp-group-head-tracking,.12em);color:var(--bp-ink)}.bp-table-grid .bp-groups>*>span{display:inline-block;border-bottom:var(--bp-stroke-row) solid var(--bp-rule-row);position:sticky;left:calc(var(--bp-pin-end,0px) + var(--bp-cell-pad-x));right:var(--bp-cell-pad-x)}.bp-table-grid [data-bp-rowgroup="head"] .bp-groups>*{overflow:clip}.bp-table-grid .bp-group-note{border-bottom:0;font-weight:${theme.type.label.weight};letter-spacing:normal;color:var(--bp-ink-2)}
.bp-table-grid:not([data-bp-group-align]) [data-bp-rowgroup="head"] .bp-groups>[data-bp-group-wide],.bp-table-grid[data-bp-group-align="left"] [data-bp-rowgroup="head"] .bp-groups>*{align-items:flex-start}@media print{.bp-table-grid:not([data-bp-group-align]) [data-bp-rowgroup="head"] .bp-groups>[data-bp-group-wide]{align-items:safe center}}.bp-table-grid[data-bp-group-align="right"] [data-bp-rowgroup="head"] .bp-groups>*{align-items:safe flex-end}.bp-table-grid[data-bp-group-rule="span"] .bp-groups>*>span{border-bottom-color:transparent}.bp-table-grid[data-bp-group-rule="span"] [data-bp-rowgroup="head"] .bp-groups>[data-group-id]{background-image:linear-gradient(var(--bp-rule-row),var(--bp-rule-row));background-repeat:no-repeat;background-origin:content-box;background-position:left bottom;background-size:100% var(--bp-stroke-row)}
.bp-table-grid [role="rowheader"]{position:relative;padding-inline-start:calc(var(--bp-cell-pad-x) + var(--bp-indent-base,24px) + var(--bp-level)*var(--bp-indent-step,16px));font-weight:${theme.type.label.weight}}
.bp-table-grid[data-bp-tree] .bp-columns>*:first-child{padding-inline-start:calc(var(--bp-cell-pad-x) + var(--bp-indent-base,24px))}
.bp-table-grid .bp-note-line{display:block;max-width:100%;height:var(--bp-inline-box);margin-top:var(--bp-inline-gap);overflow:hidden;text-overflow:ellipsis;font-size:var(--bp-inline-size);font-weight:${theme.type.label.weight};line-height:var(--bp-inline-box);color:var(--bp-ink-2)}
.bp-table-grid .bp-note-spacer{display:block;height:var(--bp-inline-box);margin-top:var(--bp-inline-gap)}
.bp-table-grid .bp-unit-affix{margin-inline-start:.35em;font-size:var(--bp-inline-size);font-weight:${theme.type.label.weight};line-height:0;color:var(--bp-ink-2);text-transform:none;letter-spacing:normal}
.bp-table-grid:not([data-bp-tree]) [role="rowheader"]{padding-inline-start:calc(var(--bp-cell-pad-x) + var(--bp-level)*1.15em)}
.bp-table-grid .bp-tree-toggle{position:absolute;inset-inline-start:calc(-1*min(24px,var(--bp-cell-pad-x) + var(--bp-indent-base,24px) + var(--bp-level)*var(--bp-indent-step,16px)));top:50%;display:grid;place-items:center;width:16px;height:16px;padding:0;transform:translateY(-50%);color:var(--bp-toggle);background:transparent;border:0;cursor:pointer;transition:color var(--bp-motion-fade) var(--bp-motion-easing)}.bp-table-grid .bp-tree-toggle svg{display:block;overflow:visible}
.bp-table-grid .bp-label-lead{display:inline-flex;align-items:center;flex:none;vertical-align:middle;overflow:hidden}.bp-table-grid .bp-tree-mark{position:absolute;inset-inline-start:calc(-1*min(24px,var(--bp-cell-pad-x) + var(--bp-indent-base,24px) + var(--bp-level)*var(--bp-indent-step,16px)));top:50%;display:grid;place-items:center;width:16px;height:16px;transform:translateY(-50%);color:var(--bp-toggle);pointer-events:none}.bp-table-grid .bp-tree-mark svg{display:block;overflow:visible}
.bp-table-grid:not([data-bp-wired]) .bp-tree-toggle{visibility:hidden}
.bp-table-grid[data-bp-wired][data-bp-tree]:not([data-bp-readonly]) [role="row"][data-has-children]{cursor:pointer}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-bp-selectable]{cursor:pointer}
.bp-table-grid [role="row"]>[data-bp-filler]{padding:0}
.bp-table-grid[data-bp-reach] [role="row"]>:first-child{--bp-cell-pad-x:var(--bp-reach-pad-x);padding-inline-end:var(--bp-pad-x-base)}
${theme.table?.ofWhich === 'ink' ? '' : '.bp-table-grid [role="row"][data-relation="ofWhich"]>*{color:var(--bp-ink-2)}\n'}.bp-table-grid .bp-hint{margin-inline-start:.4em;color:var(--bp-ink-2);font-size:var(--bp-group-size);font-weight:${theme.type.axis.weight};line-height:0;text-transform:none;letter-spacing:normal}
.bp-table-grid [role="row"][data-role="section"]>[role="rowheader"],.bp-table-grid [role="row"][data-role="section"]>[data-bp-section-rest]{position:relative;isolation:isolate}.bp-table-grid [role="row"][data-role="section"] .bp-section-rule{position:absolute;inset-block:calc(-1*var(--bp-stroke-hair)) 0;width:0;z-index:-1;border-inline-start:var(--bp-stroke-row) solid var(--bp-rule-row);pointer-events:none}
.bp-table-grid [role="row"][data-role="section"]>*{justify-content:flex-end;padding-block:var(--bp-pad-leaf);font-weight:${tableEmphasis(theme)};text-transform:uppercase;letter-spacing:.14em;color:var(--bp-ink)}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="section"]>*{padding-top:calc(var(--bp-pad-leaf) + var(--bp-section-space))}.bp-table-grid :is([data-bp-rowgroup="body"],[data-bp-row-page="0"])>.bp-rowwrap:first-child>[role="row"][data-role="section"]>*,.bp-table-grid [data-bp-rowgroup="body"]>.bp-section-scope:first-child>.bp-rowwrap:first-child>[role="row"][data-role="section"]>*{padding-top:calc(var(--bp-pad-leaf) + var(--bp-section-lead))}
.bp-table-grid [role="row"][data-bp-step="1"]{--bp-row-size:calc(var(--bp-level-1-size) + var(--bp-size-step))}.bp-table-grid [role="row"][data-bp-step="2"]{--bp-row-size:calc(var(--bp-level-2-size) + var(--bp-size-step))}.bp-table-grid [role="row"][data-bp-step="3"]{--bp-row-size:calc(var(--bp-level-3-size) + var(--bp-size-step))}.bp-table-grid [role="row"][data-role="section"]{--bp-row-size:calc(var(--bp-label-size) + var(--bp-size-step) - 1px)}
.bp-table-grid [role="row"][data-bp-step="1"]:not([data-has-children]),.bp-table-grid [role="row"][data-bp-step="2"]{--bp-row-pad:var(--bp-pad-leaf)}.bp-table-grid [role="row"][data-bp-step="3"]{--bp-row-pad:var(--bp-pad-deep)}
.bp-table-grid [role="row"][data-role="data"][data-bp-step]>*{font-weight:${theme.type.label.weight}}.bp-table-grid [role="row"][data-role="data"][data-bp-step][data-has-children]>*{font-weight:${tableEmphasis(theme)}}
.bp-table-grid [role="row"][data-bp-step="3"][data-role="data"] [role="rowheader"]{color:var(--bp-ink)}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind]>*{font-weight:${theme.type.label.weight}}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind][data-has-children]>*{font-weight:${tableEmphasis(theme)}}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind]>[data-emphasis="strong"]{font-weight:${theme.table?.weights?.block ?? tableEmphasis(theme)}}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind]>[data-emphasis="strong"].bp-muted{font-weight:${theme.type.label.weight}}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="member"]>[role="rowheader"]{font-weight:${cssValue(String(theme.table?.weights?.member ?? theme.type.label.weight))};color:var(--bp-ink)}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="member"][data-has-children]>[role="rowheader"]{font-weight:${cssValue(String(theme.table?.weights?.member ?? tableEmphasis(theme)))}}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="measure"]>[role="rowheader"]{font-weight:${cssValue(String(theme.table?.weights?.measure ?? theme.type.label.weight))};color:var(--bp-ink)}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="measure"][data-has-children]>[role="rowheader"]{font-weight:${cssValue(String(theme.table?.weights?.measure ?? tableEmphasis(theme)))}}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="detail"]>[role="rowheader"],.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="split"]>[role="rowheader"]{font-weight:${theme.type.label.weight};color:var(--bp-ink)}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="detail"][data-has-children]>[role="rowheader"]{font-weight:${tableEmphasis(theme)}}.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="data"][data-bp-step][data-bp-kind="split"][data-has-children]>[role="rowheader"]{font-weight:${tableEmphasis(theme)}}
.bp-table-grid [role="row"][data-role="total"].bp-total{--bp-row-size:calc(var(--bp-label-size) + var(--bp-size-step));--bp-row-pad:var(--bp-pad-total)}.bp-table-grid [role="row"][data-role="total"].bp-total>*{font-weight:${tableEmphasis(theme)};border-top:var(--bp-stroke-rule) solid var(--bp-rule);border-bottom:var(--bp-stroke-rule) solid var(--bp-rule)}
.bp-table-grid [data-bp-band]{background:var(--bp-emphasis)}.bp-table-grid [role="row"][data-bp-ground="emphasis"]>[data-bp-band]{background:var(--bp-column-band-strong)}.bp-table-grid [data-bp-group-start]{border-inline-start:var(--bp-stroke-row) solid var(--bp-rule-row)}.bp-table-grid [data-bp-group-end]{border-inline-end:var(--bp-stroke-row) solid var(--bp-rule-row)}
.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-toggle,.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-mark{box-sizing:border-box;width:${theme.table?.toggle?.size ?? 11}px;height:${theme.table?.toggle?.size ?? 11}px;inset-inline-start:-${theme.table?.toggle?.gap ?? 17}px;top:round(down,calc((var(--bp-row-line) - ${theme.table?.toggle?.size ?? 11}px)/2),1px);transform:none;border:var(--bp-stroke-hair) solid var(--bp-toggle);color:var(--bp-ink);background:linear-gradient(currentColor,currentColor) center/5px 1px no-repeat,var(--bp-background)}.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-toggle[aria-expanded="false"],.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-mark[data-bp-outline-mark="closed"]{background:linear-gradient(currentColor,currentColor) center/5px 1px no-repeat,linear-gradient(currentColor,currentColor) center/1px 5px no-repeat,var(--bp-background)}.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-toggle svg,.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-mark svg{display:none}
.bp-table-grid .bp-tree-toggle::after{content:"";position:absolute;inset:50% auto auto 50%;width:max(24px,100%);height:max(24px,100%);transform:translate(-50%,-50%)}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-bp-kind="member"]>*{border-top:var(--bp-stroke-rule) solid var(--bp-rule)}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-bp-kind="section"]>*{border-bottom:var(--bp-stroke-hair) solid var(--bp-rule)}
.bp-table-grid [data-bp-defer-row]{content-visibility:auto;contain-intrinsic-size:auto calc(var(--bp-label-size)*var(--bp-line-ratio) + 2*var(--bp-pad-anchor) + 1px + var(--bp-defer-lines,0)*(var(--bp-inline-box) + var(--bp-inline-gap)))}
.bp-table-grid [data-bp-member-open]>[role="gridcell"]>*,.bp-table-grid [data-bp-member-open] .bp-line,.bp-table-grid [data-bp-member-open] .bp-unit-affix{visibility:hidden}
.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-bp-divider]>*{border-top-color:var(--bp-rule)}
.bp-table-grid [role="row"]>[data-bp-bar]:not([data-bp-pin]){position:relative}.bp-table-grid [role="row"]>[data-bp-bar]>*{position:relative}.bp-table-grid [role="row"]>[data-bp-bar]::before{content:"";position:absolute;left:1px;top:calc(var(--bp-row-pad) + 2px);height:calc(var(--bp-row-line) - 4px);width:calc((100% - 1px)*var(--bp-bar,0));background:var(--bp-size-bar);pointer-events:none}.bp-table-grid [role="row"]>[data-bp-bar][data-emphasis="muted"]::before{background:var(--bp-size-bar-muted)}.bp-table-grid [role="row"][data-bp-member-open]>[data-bp-bar]::before{content:none}
.bp-table-grid[data-bp-end="grid"]{--bp-end-ink:var(--bp-rule-row)}.bp-table-grid[data-bp-end="rule"]{--bp-end-ink:var(--bp-rule)}.bp-table-grid[data-bp-end] [role="row"]{position:relative}.bp-table-grid[data-bp-end] [role="row"]::after{content:"";position:absolute;top:var(--bp-end-top,0px);bottom:0;inset-inline-end:0;width:var(--bp-stroke-hair);background:var(--bp-end-ink);pointer-events:none}.bp-table-grid[data-bp-end] [role="row"][data-bp-spacer]{--bp-end-top:var(--bp-row-spacer)}.bp-table-grid[data-bp-end] :is([data-bp-rowgroup="body"],[data-bp-row-page="0"])>.bp-rowwrap:first-child>[role="row"]{--bp-end-top:0px}.bp-table-grid[data-bp-end="grid"] [role="row"].bp-total::after{top:calc(var(--bp-end-top,0px) + 1px);bottom:1px}.bp-table-grid [data-emphasis="muted"]{color:var(--bp-ink-2)}.bp-table-grid [data-emphasis="strong"]{font-weight:${theme.table?.weights?.block ?? tableEmphasis(theme)}}
.bp-table-grid .bp-num{align-items:flex-end;text-align:right}.bp-table-grid .bp-figures{font-variant-numeric:${figures} lining-nums}.bp-table-grid .bp-center{align-items:center;text-align:center}.bp-table-grid [data-tone="good"]{color:var(--bp-good-text)}.bp-table-grid [data-tone="bad"]{color:var(--bp-bad-text)}.bp-table-grid [data-tone="warn"]{color:var(--bp-warn-text)}.bp-table-grid .bp-muted{color:var(--bp-ink-2)}.bp-table-grid .bp-note{margin-inline-start:.35em;color:var(--bp-ink-2);font-size:var(--bp-footnote-size);font-weight:var(--bp-footnote-weight);line-height:var(--bp-footnote-line-height)}
.bp-table-grid a{color:inherit;text-decoration-thickness:.08em;text-underline-offset:.14em}.bp-table-grid[data-bp-variant="status"] .bp-chip{border-radius:0}.bp-table-grid .bp-label-line{position:relative;align-self:stretch;max-width:100%;min-width:0}.bp-table-grid .bp-section-line{position:relative;align-self:stretch;display:flex;align-items:center;max-width:100%;min-width:0}.bp-table-grid .bp-num>.bp-section-line{justify-content:flex-end}.bp-table-grid .bp-center>.bp-section-line{justify-content:center}.bp-table-grid .bp-section-line>.bp-value{min-width:0}.bp-table-grid .bp-section-badge{display:flex;flex:none;margin-inline-start:8px;text-transform:none;letter-spacing:normal}.bp-table-grid .bp-chip{display:inline-block;vertical-align:top;padding:.16em .52em;border-radius:var(--bp-chip-radius);background:var(--bp-chip-neutral-bg);color:var(--bp-chip-neutral-ink);font-size:var(--bp-footnote-size);font-weight:${theme.type.label.weight};line-height:var(--bp-axis-line-height);white-space:nowrap;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis}${(['good', 'bad', 'warn'] as const).map((tone) => `.bp-table-grid [data-tone="${tone}"] .bp-chip{background:var(--bp-chip-${tone}-bg);color:var(--bp-chip-${tone}-ink)}`).join('')}.bp-table-grid .bp-status-mark{display:inline-flex;align-items:center;gap:.4em;max-width:100%;font-size:calc(var(--bp-label-size) + var(--bp-size-step));color:var(--bp-ink);font-weight:${theme.type.label.weight};white-space:nowrap}.bp-table-grid .bp-status-text{min-width:0;overflow:hidden;text-overflow:ellipsis}.bp-table-grid .bp-status-square{flex:none;width:.6em;height:.6em;background:var(--bp-ink-muted)}${(['good', 'bad', 'warn'] as const).map((tone) => `.bp-table-grid [data-tone="${tone}"] .bp-status-square{background:var(--bp-${tone})}`).join('')}
.bp-table-grid [role="gridcell"]:focus-visible,.bp-table-grid [role="rowheader"]:focus-visible{outline:2px solid var(--bp-highlight);outline-offset:-2px}
figure.bp-table>.bp-col-toolbar .bp-col-toggle:focus-visible,.bp-table .bp-col-toggle:focus-visible,.bp-table-grid .bp-tree-toggle:focus-visible,figure.bp-table>.bp-expand:focus-visible{outline:2px solid var(--bp-highlight);outline-offset:2px}
figure.bp-table>.bp-col-toolbar{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;align-items:center;margin:.15em 0 .6em;background:var(--bp-emphasis);isolation:isolate}figure.bp-table>.bp-col-toolbar .bp-col-toggle{margin-inline-start:0}.bp-table .bp-col-toggle{position:relative;margin-inline-start:.65em;padding:3px 10px;color:var(--bp-ink-muted);background:transparent;border:0;font:inherit;font-weight:${theme.type.axis.weight};font-size:var(--bp-axis-size);cursor:pointer;transition:background var(--bp-motion-fade) var(--bp-motion-easing),color var(--bp-motion-fade) var(--bp-motion-easing),box-shadow var(--bp-motion-fade) var(--bp-motion-easing)}.bp-table .bp-col-toggle[aria-pressed="true"]{color:var(--bp-background);background:var(--bp-ink);box-shadow:0 0 0 .5px var(--bp-grid),0 1px 2px var(--bp-tile-shadow)}@media (pointer:coarse){.bp-table .bp-col-toggle::before{content:"";position:absolute;z-index:-1;top:50%;left:50%;width:max(100%,44px);height:max(100%,44px);transform:translate(-50%,-50%)}}
.bp-table-grid[data-bp-sticky] [data-bp-rowgroup="head"]{position:sticky;top:0;z-index:3;background:var(--bp-background)}.bp-table-grid[data-bp-sticky] [data-bp-rowgroup="head"] [role="row"]>*{background:var(--bp-background)}.bp-table-grid[data-bp-sticky] [role="row"]>[data-bp-pin]{position:sticky;left:var(--bp-pin-left,0px);z-index:2;background:var(--bp-background)}.bp-table-grid[data-bp-sticky] [role="row"][data-bp-ground]>[data-bp-pin]{background:linear-gradient(var(--bp-row-ground),var(--bp-row-ground)),var(--bp-background)}.bp-table-grid[data-bp-sticky] [data-bp-rowgroup="head"] [role="row"]>[data-bp-pin]{z-index:4}.bp-table-grid[data-bp-sticky] [role="row"]>[data-bp-pin-last]{box-shadow:1px 0 0 var(--bp-rule-row)}.bp-table-grid[data-bp-sticky] [role="row"]>[data-bp-section-pin]{overflow:clip}.bp-table-grid[data-bp-sticky] [data-bp-section-pin]>*{position:sticky;left:calc(var(--bp-pin-left,0px) + var(--bp-cell-pad-x));align-self:flex-start}.bp-table-grid[data-bp-sticky] [role="row"][data-role="section"]>[data-bp-pin]{overflow:visible}.bp-table-grid[data-bp-sticky] [role="row"][data-role="section"]>[data-bp-pin]>:not(.bp-section-rule){align-self:flex-start;width:calc(100% + var(--bp-section-spill,0px));max-width:none}
.bp-table-grid[data-bp-sticky] [role="row"]>[data-bp-pin][data-bp-band]{background:var(--bp-emphasis)}
.bp-table-grid[data-bp-sticky] [role="row"][data-bp-ground="emphasis"]>[data-bp-pin][data-bp-band]{background:var(--bp-column-band-strong)}
.bp-table-grid [role="row"][data-bp-member-open][data-bp-ground]>*{background:var(--bp-band)}
.bp-table-grid[data-bp-sticky] [role="row"][data-bp-member-open]>[data-bp-pin][data-bp-band]{background:var(--bp-band)}
.bp-table-grid[data-bp-sticky]:not([data-bp-scrolled]) [role="row"]>[data-bp-pin-last]{box-shadow:none}
.bp-table-grid[data-bp-figures="off"] [data-bp-rowgroup="body"] [role="row"][data-role="data"]>*{box-sizing:content-box;height:max(14px,calc((var(--bp-label-size) + var(--bp-size-step))*var(--bp-line-ratio)));height:max(14px,round(up,calc((var(--bp-label-size) + var(--bp-size-step))*var(--bp-line-ratio)),1px));padding-top:0;padding-bottom:0}.bp-table-grid [data-bp-grounds-only]{padding-inline:0}
.bp-table .bp-footnotes{margin:.7em 0 0;padding-inline:var(--bp-note-indent,0);list-style:none;color:var(--bp-ink-muted);font-size:var(--bp-foot-size);font-weight:var(--bp-footnote-weight);line-height:var(--bp-footnote-line-height)}.bp-table .bp-notes{margin:.7em 0 0;padding-inline:var(--bp-note-indent,0);color:var(--bp-ink-muted);font-size:var(--bp-foot-size)}.bp-table .bp-notes .bp-footnotes{margin-top:.3em;padding-inline:0}.bp-table .bp-notes-print{display:none}@media print{.bp-table .bp-notes{display:none}.bp-table .bp-notes-print{display:block}}figure.bp-table>.bp-expand{display:none;margin-top:.7em;padding:.35em .65em;color:var(--bp-highlight);background:transparent;border:var(--bp-stroke-hair) solid var(--bp-highlight);font:inherit;cursor:pointer}figure.bp-table:has(>.bp-scroll>[data-bp-wired])>.bp-expand{display:inline-block}.bp-table [hidden]{display:none!important}
@media print{.bp-table .bp-tree-toggle,.bp-table .bp-col-toggle,figure.bp-table>.bp-col-toolbar,.bp-table .bp-sort svg{display:none!important}.bp-scroll,.bp-scroll:has(>[data-bp-sticky]){overflow:visible}.bp-table-grid{width:100%}.bp-table-grid [role="row"]{grid-template-columns:var(--bp-cols-print,var(--bp-cols))}.bp-table-grid .bp-children{max-height:none!important;opacity:1!important}}
@keyframes bp-rows-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}.bp-table[data-bp-mount="open"] .bp-children{animation:bp-rows-in var(--bp-motion-layout) var(--bp-motion-easing)}
@keyframes bp-card-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.bp-interaction-card-slot{animation:none!important}.bp-table-grid [role="row"],.bp-table-grid [role="row"]>*,.bp-table-grid .bp-line,.bp-table-grid .bp-children,.bp-table .bp-tree-toggle,.bp-table .bp-col-toggle{transition:none}}${tableRules}${headPadRules()}${featureStyles}${features.sticky ? STICKY_RULES : ''}
</style>`;
}

/**
 * The table conventions a theme sets, as rules after the defaults
 * they replace. A theme without `table` gets only the open-period ground,
 * which no cell carries unless its data says so.
 */
function renderTableConventions(theme: Theme, target: RenderTarget = DEFAULT_TARGET, statement = false, textScale = 1): string {
  const table = theme.table;
  const rules = [
    '.bp-table-grid [role="row"]>[data-state="open"]{background:var(--bp-band)}',
    // The unshaded baseline of a cohort grid (a muted M0 column) prints at the
    // body weight, as the SVG draws it.
    `.bp-table-grid[data-bp-density^="cohort"] [role="row"][data-role="data"]>[data-emphasis="muted"][data-state="value"]{font-weight:${theme.type.label.weight}}`,
  ];
  // A figure that prints as zero takes the tertiary ink, the muted
  // ink on a theme without one. Zero specificity: a tone, a muted column or
  // an ofWhich row still wins, as on the SVG, where the flag only replaces
  // the plain text colour.
  rules.push('.bp-table-grid :where([data-bp-zero]){color:var(--bp-ink-2)}');
  // State glyphs use tertiary ink, or muted ink when the theme has no tertiary ink.
  rules.push('.bp-table-grid [role="row"]>[data-state]:not([data-state="value"]),.bp-table-grid .bp-line[data-state]{color:var(--bp-ink-2)}');
  // A table's notes read in the tertiary ink too, as the SVG draws
  // them; a theme without the role keeps its stylesheet byte for byte.
  if (theme.color.inkMeta !== undefined) rules.push('.bp-table .bp-footnotes{color:var(--bp-ink-meta)}');
  const section = table?.section;
  const sectionFace = tableFonts(theme, levelLadder(theme, 'regular', target, textScale)).section;
  rules.push(`.bp-table-grid [role="row"][data-role="section"]{--bp-row-size:calc(${cssValue(`${sectionFace.size}px`)} + var(--bp-size-step))}`);
  if (section !== undefined) {
    const row: string[] = [];
    if (section.lineHeight !== undefined) {
      row.push(`--bp-row-line:round(up,calc(var(--bp-row-size)*${cssValue(String(section.lineHeight))} - ${LINE_BOX_EPSILON}px),1px)`);
    }
    const cell: string[] = [];
    if (section.weight !== undefined) cell.push(`font-weight:${cssValue(String(section.weight))}`);
    if (section.tracking !== undefined) cell.push(`letter-spacing:${cssValue(`${section.tracking}em`)}`);
    if (section.ink !== undefined) {
      cell.push(`color:${section.ink === 'ink' ? 'var(--bp-ink)' : section.ink === 'inkMeta' ? 'var(--bp-ink-meta,var(--bp-ink-muted))' : 'var(--bp-ink-muted)'}`);
    }
    if (row.length > 0) rules.push(`.bp-table-grid [role="row"][data-role="section"]{${row.join(';')}}`);
    if (cell.length > 0) rules.push(`.bp-table-grid [role="row"][data-role="section"]>*{${cell.join(';')}}`);
  }
  // Size bars (a cell's `bar`): the theme's grounds, else the ink washed far
  // toward the background, paler in a muted column.
  const paints = cellGrounds(theme);
  const paint = (value: string) => cssValue(checkedCssColor(value));
  rules.push(`.bp-table{--bp-size-bar:${paint(paints.bar)};--bp-size-bar-muted:${paint(paints.barMuted)}}`);
  const bodyRow = '.bp-table-grid [data-bp-rowgroup="body"] [role="row"]';
  const kinds = ['member', 'measure', 'subtotal', 'result'] as const;
  for (const kind of kinds) {
    if (!statement && (kind === 'subtotal' || kind === 'result')) continue;
    const figures = table?.weights?.figures?.[kind] ?? (kind === 'subtotal' || kind === 'result' ? tableEmphasis(theme) : undefined);
    const label = table?.weights?.[kind] ?? (kind === 'subtotal' || kind === 'result' ? tableEmphasis(theme) : undefined);
    const statementKind = kind === 'subtotal' || kind === 'result' ? '[data-role]' : '';
    if (figures !== undefined) rules.push(`${bodyRow}${statementKind}[data-bp-kind="${kind}"][data-bp-step]>[role="gridcell"]{font-weight:${figures}}`);
    if (label !== undefined && (kind === 'subtotal' || kind === 'result')) rules.push(`${bodyRow}${statementKind}[data-bp-kind="${kind}"][data-bp-step]>[role="rowheader"]{font-weight:${label}}`);
  }
  if (statement) {
    const resultRule = table?.resultRule ?? 'ink';
    rules.push(`${bodyRow}[data-role][data-row-id][data-bp-step][data-bp-kind="result"]>*{border-top:${resultRule === 'none' ? '0' : `1px solid var(--bp-${resultRule})`}}`);
    const finalRule = table?.finalRule ?? 'double';
    rules.push(`${bodyRow}[data-bp-final]>*{border-bottom:${finalRule === 'none' ? '0' : finalRule === 'double' ? '3px double var(--bp-ink)' : '1px solid var(--bp-rule)'}}`,
      '.bp-table-grid:has([data-bp-rowgroup="body"]>.bp-rowwrap:last-child>[data-bp-final]),.bp-table-grid:has([data-bp-rowgroup="body"]>[data-bp-row-page]:last-child>.bp-rowwrap:last-child>[data-bp-final]){border-bottom:0}',
      `.bp-table-grid .bp-rowwrap:has(>[data-bp-final])+.bp-rowwrap>[role="row"]>*,.bp-table-grid [data-bp-row-page]:has(>.bp-rowwrap:last-child>[data-bp-final])+[data-bp-row-page]>.bp-rowwrap:first-child>[role="row"]>*{border-top:0}`);
    const driverInk = table?.inks?.driver === undefined ? 'var(--bp-ink-2)' : paint(table.inks.driver);
    // Italic for every driver cell and line. The ink goes to all of them, except a toned figure of a
    // row that `options.driverTones` allows (`data-bp-driver-tone`): that one keeps its tone.
    const driverRow = `${bodyRow}[data-role][data-bp-kind="driver"][data-bp-step]`;
    rules.push(`${driverRow}>[role],${bodyRow}[data-bp-kind="driver"] .bp-line,${bodyRow} .bp-line[data-bp-kind="driver"]{font-style:${table?.driver?.italic === false ? 'normal' : 'italic'}}`,
      `${driverRow}:not([data-bp-driver-tone])>[role],${driverRow}[data-bp-driver-tone]>[role]:not([data-tone]),${bodyRow}[data-bp-kind="driver"] .bp-line:not([data-tone]),${bodyRow}[data-bp-kind="driver"]:not([data-bp-driver-tone]) .bp-line:not([data-bp-driver-tone]),${bodyRow} .bp-line[data-bp-kind="driver"]:not([data-tone]),${bodyRow} .bp-line[data-bp-kind="driver"]:not([data-bp-driver-tone]){color:${driverInk}}`);
  }
  // A row wash (highlight or anchor) paints over the authored ground, as on the SVG, so its row keeps the page's inks.
  const unwashed = ':not([data-highlight-tone]):not([data-anchor])';
  // Match the neutral grounds painted by renderTableStyle, regardless of the series palette.
  const surface = resolveSurface(theme);
  const totalGround = mixColors(theme.color.neutral, theme.color.background, Math.min(1, surface.bandTint * 2));
  for (const [selector, ground] of [
    [`${bodyRow}${unwashed}>[data-bp-band]`, { css: totalGround }],
    [`${bodyRow}[data-bp-ground="emphasis"]${unwashed}>[data-bp-band]`, { css: mixColors(theme.color.ink, totalGround, surface.bandTint) }],
  ] as const) {
    const inks = farGroundInks(theme, ground, false);
    // A tone fill has its own ink and must not inherit the column band's ink.
    const cells = table?.tones === 'fill' ? `${selector}:not([data-tone]),${selector.replace('[role="row"]', '[role="row"].bp-total')}` : selector;
    if (inks !== undefined) rules.push(`${cells}{${inks}}`, `:where(${cells}){color:var(--bp-ink)}`);
  }
  for (const kind of ['subtotal', 'total'] as const) {
    const ground = table?.grounds?.[kind];
    const row = `${bodyRow}[${kind === 'total' ? 'data-role' : 'data-bp-kind'}="${kind}"]`;
    // A pinned cell lays the ground over the page, so a transparent ground stays opaque while the grid scrolls.
    if (ground !== undefined) rules.push(`${row}{--bp-row-ground:${paint(ground)}}`, `${row}${unwashed}>*{background:${paint(ground)}}`, `${row}${unwashed}>[data-bp-pin]{background:linear-gradient(var(--bp-row-ground),var(--bp-row-ground)),var(--bp-background)}`);
  }
  const inkSelectors = {
    head: '.bp-table-grid [data-bp-rowgroup="head"] .bp-columns>*,.bp-table-grid [data-bp-rowgroup="head"] .bp-groups>*',
    subLabel: '.bp-table-grid .bp-head-sub',
    label: `${bodyRow}[data-bp-step][data-role]:not([data-role="section"]):not([data-bp-kind="driver"]):not([data-bp-kind="detail"]):not([data-bp-kind="split"])>[role="rowheader"]:not([data-emphasis="muted"])`,
    child: `${bodyRow}[data-role][data-bp-kind="detail"][data-bp-step]>[role="rowheader"],${bodyRow}[data-role][data-bp-kind="split"][data-bp-step]>[role="rowheader"]`,
    figure: `${bodyRow}:not([data-bp-kind="driver"])>[role="gridcell"]:not(.bp-muted):not([data-emphasis="muted"]):not([data-bp-zero]):not([data-state="missing"]):not([data-state="na"]):not([data-state="nm"]):not([data-state="suppressed"]):not([data-tone="good"]):not([data-tone="bad"]):not([data-tone="warn"])`,
    qualifier: '.bp-table-grid .bp-unit-affix',
    operator: '.bp-table-grid .bp-operator',
  };
  for (const [role, selector] of Object.entries(inkSelectors)) {
    const ink = table?.inks?.[role as keyof typeof inkSelectors];
    if (ink !== undefined) rules.push(`${selector}{color:${paint(ink)}}`);
  }
  // A total or subtotal ground on the other side of the page's lightness prints the row in its own inks, as the
  // SVG does (onTableGround); an authored ink of the page gives way there, the primary roles to the ink, the rest to the muted ink.
  for (const kind of ['subtotal', 'total'] as const) {
    const ground = table?.grounds?.[kind];
    const inks = ground === undefined ? undefined : farGroundInks(theme, { css: ground });
    if (inks === undefined) continue;
    const row = `${bodyRow}[${kind === 'total' ? 'data-role' : 'data-bp-kind'}="${kind}"]${unwashed}`;
    // The state glyphs take the tertiary ink there, as on the SVG, on a theme without one too.
    // A boxed outline mark keeps its page-coloured box, so its glyph keeps the page ink.
    rules.push(`${row}{${inks}}`, `${row}>[data-state]:not([data-state="value"]),${row} .bp-line[data-state]{color:var(--bp-ink-meta)}`,
      `${row.replace('.bp-table-grid', '.bp-table-grid[data-bp-mark-style="boxed"]')} :is(.bp-tree-toggle,.bp-tree-mark){color:${paint(theme.color.ink)}}`);
    const far = farGround(theme, { css: ground! }) !== undefined;
    for (const [role, selector] of Object.entries(inkSelectors)) {
      const authored = table?.inks?.[role as keyof typeof inkSelectors];
      if (role === 'head' || role === 'subLabel' || authored === undefined) continue;
      const scoped = selector.split(',').map((one) => one.startsWith(bodyRow) ? row + one.slice(bodyRow.length) : `${row} ${one.replace('.bp-table-grid ', '')}`);
      // A ground on the page's side keeps an authored ink that reads on it, as onTableGround does in the SVG.
      const color = far ? `var(${role === 'label' || role === 'figure' ? '--bp-ink' : '--bp-ink-muted'})`
        : paint(resolvePaint(onTableGround({ css: authored }, { css: ground! }), theme));
      rules.push(`${scoped.join(',')}{color:${color}}`);
    }
  }
  if (table?.inks?.toggle !== undefined) rules.push(`.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-toggle,.bp-table-grid[data-bp-mark-style="boxed"] .bp-tree-mark{border-color:${paint(table.inks.toggle)}}`);
  if (table?.section?.case !== undefined) rules.push(`${bodyRow}[data-role="section"]>*{text-transform:${table.section.case === 'asis' ? 'none' : 'uppercase'}}`);
  if (table?.qualifier !== undefined) rules.push(`.bp-table-grid .bp-unit-affix{font-size:max(1px,calc(var(--bp-row-size) + ${table.qualifier.sizeDelta ?? -2}px));margin-inline-start:${table.qualifier.gap ?? 4}px}`);
  if (statement) {
    const operatorSize = table?.operator?.width ?? 14;
    rules.push(`.bp-table-grid[data-bp-operators] .bp-columns>*:first-child{padding-inline-start:calc(var(--bp-cell-pad-x) + ${operatorSize}px)}.bp-table-grid[data-bp-operators][data-bp-tree] .bp-columns>*:first-child{padding-inline-start:calc(var(--bp-cell-pad-x) + var(--bp-indent-base,24px) + ${operatorSize}px)}`);
    rules.push(`.bp-table-grid .bp-operator{display:none}.bp-table-grid[data-bp-operators] [role="rowheader"]>.bp-value,.bp-table-grid[data-bp-operators] [role="rowheader"]>.bp-label-line>.bp-value{position:relative;padding-inline-start:${operatorSize}px;box-sizing:border-box}.bp-table-grid[data-bp-operators] .bp-operator{display:block;position:absolute;inset-inline-start:0;width:${operatorSize}px;color:${table?.inks?.operator === undefined ? 'var(--bp-ink-2)' : paint(table.inks.operator)}}`);
  }
  if (table?.rows !== undefined) {
    // One face for every rung (`table.rows`): the line box takes the theme's
    // ratio, a micro-pixel off before rounding up as the ladder does. A
    // section heading stands 14 px clear of the rows above it, 2 px at the top.
    const ratio = table.rows.lineHeight;
    if (ratio !== undefined) {
      rules.push(`.bp-table{--bp-line-ratio:${cssValue(String(ratio))}}`,
        `.bp-table-grid [role="row"]{--bp-row-line:round(up,calc(var(--bp-row-size)*${cssValue(String(ratio))} - ${LINE_BOX_EPSILON}px),1px)}`);
    }
    rules.push('.bp-table-grid [role="row"][data-role="section"]>*{padding-block:var(--bp-pad-leaf)}',
      '.bp-table-grid [data-bp-rowgroup="body"]>.bp-rowwrap:first-child>[role="row"][data-role="section"]>*{padding-block:var(--bp-pad-leaf)}');
  }
  // The badge reaches 6 px past its figure, as the SVG badge does; its cell value clips overflow,
  // so that box reaches as far, or the clip cuts the badge back to the figure.
  rules.push('.bp-table-grid .bp-polarity-badge{font:inherit;line-height:inherit;letter-spacing:inherit;padding:2px 6px;margin:-2px -6px;vertical-align:baseline;max-width:none;overflow:visible}',
    '.bp-table-grid .bp-value:has(>.bp-polarity-badge){padding:2px 6px;margin:-2px -6px}');
  if (table?.tones === 'fill') {
    // A judged cell paints its ground and keeps the figure in the text ink; a
    // ground stands 1 px inside the cell (`insetTint`), clear of the rules
    // and of its neighbours, as the SVG insets it. The
    // change lines under a value keep their ink, a watch line whispers. A total
    // row lays no tone ground and keeps its tone text, as on the SVG.
    rules.push(
      `.bp-table{--bp-ground-good:${paint(paints.good)};--bp-ground-good-strong:${paint(paints.goodStrong)};--bp-ground-warn:${paint(paints.warn)};--bp-ground-bad:${paint(paints.bad)}}`,
      '.bp-table-grid [data-bp-rowgroup="body"] [role="row"]:not(.bp-total)>[role="gridcell"][data-bp-figure][data-tone]{color:var(--bp-ink)}',
      // An open member row hides its figures, and their grounds with them.
      ...(['good', 'warn', 'bad'] as const).map((tone) => `.bp-table-grid [data-bp-rowgroup="body"] [role="row"]:not([data-bp-member-open]):not(.bp-total)>[role="gridcell"][data-bp-figure][data-tone="${tone}"]{${insetTintCss(`var(--bp-ground-${tone})`)}}`),
      `.bp-table-grid [data-bp-rowgroup="body"] [role="row"]:not([data-bp-member-open]):not(.bp-total)>[role="gridcell"][data-bp-figure][data-tone="good"][data-bp-strong]{${insetTintCss('var(--bp-ground-good-strong)')}}`,
      '.bp-table-grid .bp-line[data-tone="warn"]{color:var(--bp-ink-2)}',
    );
  }
  if (table?.headRule === 'ink') {
    // The head and every section heading close on the text ink; the row
    // under a heading takes no line of its own.
    rules.push('.bp-table-grid [data-bp-rowgroup="head"]{border-bottom-color:var(--bp-ink)}',
      '.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="section"]>*{border-bottom:var(--bp-stroke-hair) solid var(--bp-ink)}',
      '.bp-table-grid .bp-rowwrap:has(>[role="row"][data-role="section"])+.bp-rowwrap>[role="row"]>*,.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-role="section"]>*{border-top:0}');
  }
  if (table?.section?.rule !== 'hair') {
    // The heavy rule under a section label, in the section row as on the SVG
    // (the floating sticky label too); the row under it takes no line of its own.
    rules.push(`.bp-table-grid :is([data-bp-rowgroup="body"],.bp-section-float-inner) [role="row"][data-role="section"]>*{border-bottom:${cssValue(`${2 * strokeToken(theme, 'rule')}px`)} solid var(--bp-ink)}`,
      '.bp-table-grid .bp-rowwrap:has(>[role="row"][data-role="section"])+.bp-rowwrap>[role="row"]>*,.bp-table-grid [role="row"][data-role="section"]+.bp-children>.bp-rowwrap:first-child>[role="row"]>*{border-top:0}');
    // Where the theme draws no line, the heavy rule goes too, as on the SVG: under a last heading with
    // `closeRule: 'none'`, and over a result row with `resultRule: 'none'`.
    if (table?.closeRule === 'none') rules.push('.bp-table-grid :is([data-bp-rowgroup="body"]>.bp-rowwrap:last-child,[data-bp-rowgroup="body"]>.bp-section-scope:last-child>.bp-rowwrap:last-child)>[role="row"][data-role="section"]:not(:has(+.bp-children:not([data-bp-collapsed])))>*{border-bottom:0}');
    if (table?.resultRule === 'none') rules.push('.bp-table-grid .bp-rowwrap:has(+.bp-rowwrap>[role="row"][data-bp-kind="result"])>[role="row"][data-role="section"]>*,.bp-table-grid [role="row"][data-role="section"]:has(+.bp-children>.bp-rowwrap:first-child>[role="row"][data-bp-kind="result"])>*{border-bottom:0}');
  }
  if (table?.blockRule === 'rule') {
    // An open top-level block reads as one: the rule above its parent and
    // above the row after it, as on the SVG. A section heading has its own
    // rule and opens no block; column dividers keep the quiet rule.
    rules.push('.bp-table-grid [data-bp-rowgroup="body"]>.bp-rowwrap>[role="row"]:not([data-role="section"]):has(>[aria-expanded="true"])>*{border-top-color:var(--bp-rule);border-top-width:var(--bp-stroke-rule)}',
      '.bp-table-grid [data-bp-rowgroup="body"]>.bp-rowwrap:has(>[role="row"]:not([data-role="section"])+.bp-children:not([data-bp-collapsed]))+.bp-rowwrap>[role="row"]>*{border-top-color:var(--bp-rule);border-top-width:var(--bp-stroke-rule)}');
  }
  // The close of the table (`table.closeRule`) is the grid's bottom border:
  // in the row-hairline ink or none, as the SVG draws its rule:close. A
  // table that ends on its total keeps the total's own rule; the rule that
  // drops the border there outranks these.
  if (table?.closeRule === 'grid') rules.push('.bp-table-grid{border-bottom:var(--bp-stroke-row) solid var(--bp-rule-row)}');
  if (table?.closeRule === 'none') rules.push('.bp-table-grid{border-bottom:0}');
  if (textScale !== 1) {
    // The stylesheet's own px steps under `textScale`, as the SVG ladder scales them.
    const px = (value: number): string => cssValue(`${scaleTextPx(value, textScale)}px`);
    rules.push(
      `.bp-table-grid[data-bp-density="compact"],.bp-table-grid[data-bp-density="cohort"]{--bp-size-step:${px(-0.5)}}`,
      `.bp-table-grid[data-bp-density="cohort-small"]{--bp-size-step:${px(-1)}}`,
      `.bp-table-grid{--bp-inline-size:max(var(--bp-micro-size),calc(var(--bp-label-size) + var(--bp-size-step) - ${px(2)}))}`,
    );
  }
  if (table?.fixedType === true) {
    // Density moves air only; the closing row of a cohort grid keeps the
    // total face on its label while the matrix figures keep their step.
    const label = theme.type.label.size;
    rules.push(
      '.bp-table-grid[data-bp-density="compact"]{--bp-size-step:0px}',
      `.bp-table-grid[data-bp-density^="cohort"] [role="row"][data-role="total"].bp-total>[role="rowheader"]{font-size:${cssValue(`${label}px`)};line-height:${cssValue(`${levelLadder(theme, 'regular', target, textScale).lineBox(label)}px`)}}`,
    );
  }
  if (table?.inks?.figure !== undefined && table.tones === 'fill') rules.push(`${bodyRow}:not(.bp-total)>[role="gridcell"][data-bp-figure][data-tone]{color:${paint(table.inks.figure)}}`);
  if (table?.tones === 'fill') {
    // A tone fill on the other side of the page's lightness prints its cell in its own inks, as the SVG does.
    for (const [tone, strong] of [['good', false], ['good', true], ['warn', false], ['bad', false]] as const) {
      const inks = farGroundInks(theme, tableGround(strong ? 'goodStrong' : tone));
      if (inks !== undefined) rules.push(`${bodyRow}:not([data-bp-member-open]):not(.bp-total)>[role="gridcell"][data-bp-figure][data-tone="${tone}"]${strong ? '[data-bp-strong]' : ':not([data-bp-strong])'}{${inks}}`);
    }
  }
  if (statement) {
    const ink = table?.inks?.driver === undefined ? 'var(--bp-ink-2)' : paint(table.inks.driver);
    const driverRow = `${bodyRow}[data-role][data-bp-kind="driver"][data-bp-step]`;
    rules.push(`${driverRow}:not([data-bp-driver-tone])>[role],${driverRow}[data-bp-driver-tone]>[role]:not([data-tone]),${bodyRow}[data-bp-kind="driver"] .bp-unit-affix{color:${ink}}`);
  }
  return `\n${rules.join('\n')}`;
}

function renderFeatureStyles(
  theme: Theme,
  features: TableStyleFeatures,
): string {
  const styles: string[] = [];
  const { anchorTint, rowTint } = resolveSurface(theme);
  // The row under the pointer: the ink at the zebra weight over the
  // background (6% by default), a wash a reader sees on every theme. The
  // anchor wash below is not the hover wash: at 3% of a theme's neutral it
  // is not visible on a theme whose neutral is close to its background.
  const hoverWash = cssValue(checkedCssColor(mixColors(theme.color.ink, theme.color.background, 1 - rowTint)));
  styles.push(
    `.bp-table{--bp-hover-wash:${hoverWash}}`,
    `@media (hover:hover){.bp-table-grid [data-bp-rowgroup="body"] [role="row"]:hover>*{background:var(--bp-hover-wash)}}`,
  );
  if (features.anchorWash) {
    const anchorWash = cssValue(checkedCssColor(mixColors(theme.color.neutral, theme.color.background, 1 - anchorTint)));
    styles.push(
      `.bp-table{--bp-anchor-wash:${anchorWash}}`,
      `.bp-table-grid [role="row"][data-anchor]>*{background:var(--bp-anchor-wash)}`,
    );
  }
  if (features.rowHighlight) {
    const rowTint = resolveSurface(theme).rowTint;
    const toneWeight = 1 - rowTint;
    const wash = (tone: string) => cssValue(checkedCssColor(mixColors(tone, theme.color.background, toneWeight)));
    // The highlighted row takes the focus colour where the theme sets one.
    const focusEdge = theme.color.focus === undefined ? 'var(--bp-highlight)' : cssValue(checkedCssColor(theme.color.focus));
    styles.push(
      `.bp-table{--bp-row-highlight-wash:${wash(theme.color.focus ?? theme.color.highlight)};--bp-row-good-wash:${wash(theme.color.goodFill ?? theme.color.good)};--bp-row-bad-wash:${wash(theme.color.badFill ?? theme.color.bad)};--bp-row-warn-wash:${wash(theme.color.warnFill ?? warnColor(theme))}}`,
      `.bp-table-grid [data-highlight-tone="highlight"]>*{background:var(--bp-row-highlight-wash)}.bp-table-grid [data-highlight-tone="good"]>*{background:var(--bp-row-good-wash)}.bp-table-grid [data-highlight-tone="bad"]>*{background:var(--bp-row-bad-wash)}.bp-table-grid [data-highlight-tone="warn"]>*{background:var(--bp-row-warn-wash)}`,
      `.bp-table-grid [data-highlight-tone="highlight"]>:first-child{box-shadow:inset 3px 0 ${focusEdge}}.bp-table-grid [data-highlight-tone="good"]>:first-child{box-shadow:inset 3px 0 var(--bp-good)}.bp-table-grid [data-highlight-tone="bad"]>:first-child{box-shadow:inset 3px 0 var(--bp-bad)}.bp-table-grid [data-highlight-tone="warn"]>:first-child{box-shadow:inset 3px 0 var(--bp-warn)}`,
    );
  }
  if (features.inCellBar) {
    const barWeight = 0.45;
    const barPaint = (fallback: string) =>
      cssValue(checkedCssColor(mixColors(fallback, theme.color.background, barWeight)));
    styles.push(
      // The bar is a large fill: the focus and the bad fill, as in the SVG.
      `.bp-table{--bp-bar-positive:${barPaint(theme.color.focus ?? theme.color.highlight)};--bp-bar-negative:${barPaint(theme.color.badFill ?? theme.color.bad)}}`,
      `.bp-table-grid .bp-in-cell-bar{display:grid;grid-template-columns:minmax(3em,1fr) max-content;column-gap:.5em;align-items:center;width:100%}.bp-table-grid .bp-in-cell-track{display:block;height:.62em}.bp-table-grid .bp-in-cell-fill{display:block;height:100%;background:var(--bp-bar-positive)}.bp-table-grid .bp-in-cell-bar[data-bar-sign="negative"] .bp-in-cell-fill{background:var(--bp-bar-negative)}.bp-table-grid .bp-in-cell-value{text-align:right}`,
    );
  }
  return styles.length === 0 ? '' : `\n${styles.join('\n')}`;
}

/** The cell's reading roles on its actual ground, shared by heat cells and stylesheet grounds. */
export function tableGroundTextStyle(theme: Theme, ground: Paint): Readonly<Record<string, string>> {
  // The cells of one heat band share their ground object, so the six contrast picks run once per band.
  let byGround = GROUND_TEXT_STYLES.get(theme);
  if (!byGround) GROUND_TEXT_STYLES.set(theme, byGround = new WeakMap());
  const known = byGround.get(ground);
  if (known !== undefined && sameRecipe(known.ground, ground)) return known.style;
  const css = (ink: Paint, tone?: 'good' | 'bad' | 'warn') => checkedCssColor(resolvePaint(onTableGround(ink, ground, tone), theme));
  const style = {
    '--bp-ink': css({ token: 'ink' }),
    '--bp-ink-muted': css({ token: 'inkMuted' }),
    '--bp-ink-meta': css({ token: 'inkMeta' }),
    '--bp-ink-2': css(tableInk('secondary')),
    ...Object.fromEntries((['good', 'bad', 'warn'] as const).map(tone => [`--bp-${tone}-text`, css(toneTextPaint(theme, tone), tone)])),
  };
  byGround.set(ground, { ground: structuredClone(ground), style });
  return style;
}

const GROUND_TEXT_STYLES = new WeakMap<Theme, WeakMap<Paint, { ground: Paint; style: Readonly<Record<string, string>> }>>();

/** Reading roles that need a ground-specific ink, serialized for the table stylesheet. */
function farGroundInks(theme: Theme, ground: Paint, textColor = true): string | undefined {
  const background = compositeColor(resolvePaint(ground, theme), theme.color.background);
  if (farGround(theme, ground) === undefined && [theme.color.inkMuted, theme.color.inkMeta ?? theme.color.inkMuted].every(ink => contrastRatio(ink, background) >= 4.5)) return undefined;
  return [
    ...Object.entries(tableGroundTextStyle(theme, ground)).map(([key, value]) => `${key}:${cssValue(value)}`),
    ...(textColor ? ['color:var(--bp-ink)'] : []),
  ].join(';');
}

/** Only SVG-safe colours reach the HTML paint boundary. */
function checkedCssColor(value: string): string {
  const color = value.trim();
  if (!isSafeSvgColor(color)) {
    throw new Error(
      `invalid theme color '${color.slice(0, 80)}' — CSS paint accepts hex, rgb()/rgba(), and the shared color keywords only`,
    );
  }
  return color;
}

/**
 * Last-line escaping for values that already cleared an allowlist. Escapes
 * markup AND the CSS structural characters `;{}`: without those a value could
 * close its own declaration and open a rule against the HOST page
 * (`...;} html{display:none} .x{a:b`). Parentheses are deliberately NOT
 * escaped — rgba() paints legitimately contain them, and the allowlist above
 * is what bounds their shape.
 */
function cssValue(value: string): string {
  return value
    .replaceAll('\\', '\\5c ')
    .replaceAll('<', '\\3c ')
    .replaceAll('>', '\\3e ')
    .replaceAll('&', '\\26 ')
    .replaceAll(';', '\\3b ')
    .replaceAll('{', '\\7b ')
    .replaceAll('}', '\\7d ')
    .replaceAll('\u0000', '\uFFFD')
    .replace(/[\r\n\f]/g, ' ');
}
