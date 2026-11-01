/**
 * The story layer (options.story): a sequence of steps over one laid-out
 * chart. A step fades every mark it does not name and sets the names it
 * does in bold; a panel holds the step's title and body. Positions never
 * change between steps: the chart is laid out once, the panel is placed
 * once, at the size the longest step needs, and a step changes paint only.
 *
 * The scene carries the static step (`story.step`), so SVG, PNG and a server
 * render draw it with no further work. `storyScene` turns that scene into
 * any other step for an interactive renderer.
 */

import type { Rect } from './geometry';
import { STORY_NAVIGATION, copyFrame, footerPlans } from './footer';
import { interactionTokens } from './a11y/theme';
import { strokeToken, canvasMargin, panelTypeClass, resolveTargetTheme, themeForWidth, typeWidthClass } from './theme';
import { DEFAULT_TARGET } from './target';
import { textScaleOf, textSizeOf } from './typeFloors';
import { presentationInfo } from './themeGeometry';
import { defaultMeasurer, graphemes, wrapText, type FontSpec, type TextMeasurer } from './text';
import type { Id, OwnerRef } from './types/cell';
import type { BaseOptions, LocaleSpec, RenderTarget, StorySpec, StringsSpec } from './types/options';
import { localeStrings } from './strings';
import { sizeRefusal } from './sizing';
import { isRefused } from './schema/refusals';
import type { Geometry, LayoutResult, LintWarning, SceneNode, StoryGeometry, StoryStepGeometry } from './types/scene';
import type { ThemeRef } from './types/theme';
import { maxOf, pushAll } from './arrays';

/** Owner keys a step id can name. */
const DATA_KEYS = ['pointId', 'seriesId', 'categoryId', 'segmentId', 'rowId'] as const satisfies readonly (keyof OwnerRef)[];
/** The key stays readable in every step: it explains the colours. */
const KEY_PARTS: ReadonlySet<string> = new Set(['swatch', 'legendLabel']);
const STORY = 'story:';

interface StoryOptions extends Pick<BaseOptions, 'margin' | 'canvas'> {
  story?: StorySpec;
  locale?: LocaleSpec;
  theme?: ThemeRef;
  target?: RenderTarget;
  [STORY_NAVIGATION]?: boolean;
  measure?: TextMeasurer;
  strings?: StringsSpec;
  size?: { width?: number; height?: number };
}

/** The chart's layout without the story pass, to lay it out again at another size. */
type Relayout = (data: unknown, options: object) => LayoutResult;

const asList = (ids: Id | Id[] | undefined): Id[] => (ids === undefined ? [] : Array.isArray(ids) ? ids : [ids]);

/** The counter wording of step `index` of `count`. */
function storyCounter(template: string, index: number, count: number): string {
  return template.replace('{step}', String(index + 1)).replace('{count}', String(count));
}

function error(code: string, message: string, suggest: string, field: (string | number)[]): LintWarning {
  return { code, severity: 'error', message, suggest, field: ['options', 'story', ...field] };
}

/** Which nodes each step brings forward and which it fades; errors for ids no mark carries. */
function stepSets(geo: Geometry<object, object>, data: unknown, spec: StorySpec): { sets: { focus: string[]; dim: string[] }[]; errors: LintWarning[] } {
  const errors: LintWarning[] = [];
  const nodes = geo.scene.filter(node => !KEY_PARTS.has(node.part) && !node.id.startsWith(STORY));
  const known = new Set(nodes.flatMap(node => DATA_KEYS.map(key => node.owner?.[key]).filter((id): id is string => id !== undefined)));
  // A scatter group names its points: no mark owns the group id itself.
  const groups = new Map<string, string[]>();
  const points = (data as { points?: { id?: unknown; group?: unknown }[] } | undefined)?.points;
  if (Array.isArray(points)) {
    for (const point of points) {
      if (typeof point?.group !== 'string' || typeof point.id !== 'string') continue;
      groups.set(point.group, [...groups.get(point.group) ?? [], point.id]);
    }
  }
  const sets = spec.steps.map((step, index) => {
    const asked = asList(step.highlight);
    const unknown = asked.filter(id => !known.has(id) && !groups.has(id));
    if (unknown.length) {
      errors.push(error('story-unknown-id',
        `story step '${step.id}' highlights ${unknown.map(id => `'${id}'`).join(', ')}, which no mark of this chart carries`,
        `Name a point, group, series, category or segment id of this chart; ids here: ${[...known, ...groups.keys()].slice(0, 20).join(', ')}`,
        ['steps', index, 'highlight']));
    }
    if (asked.length === 0) return { focus: [], dim: [] };
    const ids = new Set(asked.flatMap(id => groups.get(id) ?? [id]));
    const keys = DATA_KEYS.filter(key => nodes.some(node => ids.has(node.owner?.[key] as string)));
    const focus: string[] = [];
    const dim: string[] = [];
    for (const node of nodes) {
      const carried = keys.filter(key => node.owner?.[key] !== undefined);
      if (carried.length === 0) continue;
      (carried.some(key => ids.has(node.owner[key] as string)) ? focus : dim).push(node.id);
    }
    return { focus, dim };
  });
  return { sets, errors };
}

interface PanelFonts { title: FontSpec; body: FontSpec; nav: FontSpec; counter: FontSpec }

/** Control text has no line cap. Split oversized words without losing letters. */
function controlLines(text: string, font: FontSpec, width: number, measure: TextMeasurer): string[] {
  const split = text.split(/(\s+)/).map(word => {
    if (measure(word, font).width <= width) return word;
    const lines: string[] = [];
    let line = '';
    for (const letter of graphemes(word)) {
      if (line && measure(line + letter, font).width > width) { lines.push(line); line = ''; }
      line += letter;
    }
    return [...lines, line].join('\n');
  }).join('');
  return wrapText(split, font, width, Infinity, measure).lines;
}

/** Measure every step and control before assigning any position. */
function panelLayout(spec: StorySpec, width: number, fonts: PanelFonts, space: number, strings: Required<Pick<StringsSpec, 'storyBack' | 'storyNext' | 'storyCounter'>>, measure: TextMeasurer, limits = { title: 4, body: 10 }) {
  const pad = space * 4;
  const inner = Math.max(1, width - pad * 2);
  const gap = 8;
  const lineH = (font: FontSpec) => font.size * (font.lineHeight ?? 1.2);
  const texts = spec.steps.map(step => {
    const title = wrapText(step.title, fonts.title, inner, limits.title, measure);
    const body = step.body ? wrapText(step.body, fonts.body, inner, limits.body, measure) : undefined;
    return { title: title.lines, body: body?.lines ?? [], titleTruncated: title.truncated, bodyTruncated: body?.truncated ?? false };
  });
  const textH = maxOf(texts.map(text => text.title.length * lineH(fonts.title) + (text.body.length ? space * 2 + text.body.length * lineH(fonts.body) : 0)));
  let controlPad = space * 2;
  const controlFloor = Math.max(44, ...graphemes(strings.storyBack + strings.storyNext).map(letter => measure(letter, fonts.nav).width + controlPad * 2));
  let navPad = Math.min(pad, Math.max(0, (width - controlFloor * 2 - gap) / 2));
  let navWidth = width - navPad * 2;
  const naturalW = (text: string) => Math.max(44, ...text.split('\n').map(line => measure(line, fonts.nav).width + controlPad * 2));
  let backW = Math.min(naturalW(strings.storyBack), (navWidth - gap) / 2);
  let nextW = Math.min(naturalW(strings.storyNext), navWidth - gap - backW);
  const wordW = (text: string) => Math.max(...text.split(/\s+/).map(word => measure(word, fonts.nav).width));
  const backTextW = wordW(strings.storyBack);
  const nextTextW = wordW(strings.storyNext);
  controlPad = Math.max(space, Math.min(controlPad, (backW - backTextW) / 2, (nextW - nextTextW) / 2));
  const stacked = backW < backTextW + controlPad * 2 || nextW < nextTextW + controlPad * 2;
  if (stacked) {
    navPad = 0;
    navWidth = backW = nextW = width;
    controlPad = Math.max(space, Math.min(space * 2, (width - Math.max(backTextW, nextTextW)) / 2));
  }
  const backLines = controlLines(strings.storyBack, fonts.nav, backW - controlPad * 2, measure);
  const nextLines = controlLines(strings.storyNext, fonts.nav, nextW - controlPad * 2, measure);
  // A deterministic 44 px floor works on both touch and fine pointers.
  const buttonH = Math.max(44, Math.max(backLines.length, nextLines.length) * lineH(fonts.nav) + controlPad * 2);
  const counters = spec.steps.map((_, index) => controlLines(storyCounter(strings.storyCounter, index, spec.steps.length), fonts.counter, navWidth, measure));
  const counterW = maxOf(counters.flat().map(line => measure(line, fonts.counter).width));
  const counterH = maxOf(counters.map(lines => lines.length)) * lineH(fonts.counter);
  const counterAbove = stacked || counterH > buttonH || counterW + gap + backW + gap + nextW > navWidth;
  const buttonsH = stacked ? buttonH * 2 + gap : buttonH;
  const navH = buttonsH + (counterAbove ? counterH + gap : 0);
  const staticHeight = pad + textH + pad;
  return { texts, limits, pad, height: staticHeight + (spec.steps.length > 1 ? navH + pad : 0), staticHeight,
    navPad, stacked, buttonsH, buttonH, backW, nextW, backLines, nextLines, counters, counterAbove, counterH, gap, lineH };
}

const snapPixel = (value: number): number => (Math.abs(value - Math.round(value)) < 1e-6 ? Math.round(value) : value);

/** Insert space before the footer so React's footer crop keeps the whole panel. */
function growBeforeFooter(geo: Geometry<object, object>, height: number): Geometry<object, object> {
  const footer = geo.frame?.footerRect;
  const ids = new Set([...(geo.frame?.footnoteNodeIds ?? []), geo.frame?.sourceNodeId, geo.frame?.creditNodeId]);
  const shift = (rect: Rect) => ({ ...rect, y: rect.y + height });
  const frame = footer ? copyFrame(geo.frame, { footerRect: shift(footer) }) : geo.frame;
  return { ...geo, size: { ...geo.size, height: geo.size.height + height },
    // A reserve taken off and added back can leave the height a few ULPs above its integer; keep whole pixels whole.
    ...(geo.sizing ? { sizing: { ...geo.sizing, naturalHeight: snapPixel(geo.sizing.naturalHeight + height) } } : {}),
    ...(footer ? {
      frame,
      scene: geo.scene.map(node => ids.has(node.id) ? (node.t === 'text' ? { ...node, y: node.y + height } : { ...node, ty: (node.ty ?? 0) + height }) : node),
      labels: geo.labels.map(label => ids.has(label.nodeId) ? { ...label, rect: shift(label.rect) } : label),
      debug: { ...geo.debug, occupied: geo.debug.occupied.map(item => item.rect.y >= footer.y ? { ...item, rect: shift(item.rect) } : item) },
    } : {}),
  };
}

/**
 * The story pass. `relayout` lays the chart out again at another canvas size,
 * to reserve a right column or a block below the x axis.
 */
export function applyStory(geo: Geometry<object, object>, data: unknown, options: StoryOptions, relayout: Relayout): LayoutResult<object, object> {
  const spec = options.story;
  if (!spec) return geo;
  if (panelTypeClass(options) !== undefined) return { ...geo, warnings: [...geo.warnings, error('story-in-grid-panel', 'a grid panel cannot carry a story: the panels share one canvas and one reading order', 'Drop story from the panel options, or draw the chart on its own.', [])] };
  const again = (size: { width: number; height?: number }) => {
    const next = relayout(data, { ...options, size });
    return isRefused(next) ? undefined : next as Geometry<object, object>;
  };
  const errors: LintWarning[] = [];
  const seen = new Set<string>();
  spec.steps.forEach((step, index) => {
    if (seen.has(step.id)) errors.push(error('story-duplicate-step', `story step id '${step.id}' is used twice`, 'Give every step its own id.', ['steps', index, 'id']));
    seen.add(step.id);
  });
  const staticStep = spec.step === undefined ? 0 : spec.steps.findIndex(step => step.id === spec.step);
  if (staticStep < 0) {
    errors.push(error('story-unknown-step', `story.step names '${spec.step}', which is not a step id`,
      `Use one of: ${spec.steps.map(step => step.id).join(', ')}.`, ['step']));
  }
  const first = stepSets(geo, data, spec);
  pushAll(errors, first.errors);
  if (errors.length) return { ...geo, warnings: [...geo.warnings, ...errors] };

  const target = options.target ?? DEFAULT_TARGET;
  const theme = themeForWidth(resolveTargetTheme(options.theme, target, textScaleOf(options), textSizeOf(options)), geo.size.width);
  const measure = options.measure ?? defaultMeasurer;
  const family = theme.type.family;
  const fonts: PanelFonts = {
    // No display face in the chart tokens: the title takes the title role.
    title: { family, ...theme.type.title },
    body: { family, ...theme.type.subtitle },
    nav: { family, ...theme.type.subtitle },
    counter: { family, ...theme.type.footnote },
  };
  const strings = { ...localeStrings(options.locale?.language), ...pickDefined(options.strings) };
  const space = theme.space.labelPad;
  const gap = Math.max(12, space * 3);
  const margin = { ...canvasMargin(theme, geo.size.width), ...options.margin, ...options.canvas?.margin };
  const fixed = typeof options.size === 'string' || options.size?.height !== undefined;
  // Only React draws the Back and Next row. Static output reserves the text panel alone, so the source line sits one gap below it.
  const navigation = options[STORY_NAVIGATION] === true;
  const laidOut = (width: number, limits?: { title: number; body: number }) => {
    const layout = panelLayout(spec, width, fonts, space, strings, measure, limits);
    return navigation ? layout : { ...layout, height: layout.staticHeight };
  };
  let placed: { geo: Geometry<object, object>; rect: Rect; placement: StoryGeometry['placement']; layout: ReturnType<typeof panelLayout> } | undefined;
  // A side column must leave a chart that still meets its measured floor.
  if (typeWidthClass(geo.size.width) !== 'S') {
    const sideW = Math.min(320, Math.max(240, Math.round(geo.size.width * 0.3)));
    const side = laidOut(sideW);
    const chartW = geo.size.width - sideW - margin.right - gap;
    const narrowed = chartW >= (geo.sizing?.minWidth ?? 0) ? again({ width: chartW, ...(fixed ? { height: geo.size.height } : {}) }) : undefined;
    if (narrowed) {
      const end = narrowed.frame?.footerRect?.y ?? narrowed.size.height - margin.bottom;
      const extra = Math.max(0, narrowed.plot.y + side.height + gap - end);
      if (!fixed || extra === 0) {
        const base = growBeforeFooter(narrowed, extra);
        const sizing = base.sizing ? { ...base.sizing, naturalWidth: geo.size.width + Math.max(0, base.sizing.naturalWidth - Math.ceil(chartW)) } : base.sizing;
        placed = { geo: { ...base, sizing, size: { ...base.size, width: geo.size.width } }, placement: 'right', layout: side,
          rect: { x: chartW + gap, y: base.plot.y, w: sideW, h: side.height } };
      }
    }
  }
  if (!placed) {
    let base = geo;
    let below = laidOut(base.plot.w);
    let reserve = below.height + gap;
    if (fixed) {
      // First let the plot shrink. At its floor, remove body lines, then
      // clamp the title to one line. Keep the whole navigation row.
      let widthPass = 0;
      for (;;) {
        // Reserve inside the fixed canvas, so the standalone canvas minimum
        // is not charged again to the chart above the story panel.
        const footer = geo.frame?.footerRect;
        const bottom = footer ? geo.size.height - footer.y - footer.h : margin.bottom;
        const result = relayout(data, { ...options, size: geo.size,
          canvas: { margin: { ...options.canvas?.margin, bottom: bottom + reserve } } });
        if (!result.refused) {
          // The story reserve is not canvas margin; the static footer must not add it again.
          const plan = footerPlans.get(result.frame);
          if (plan) footerPlans.set(result.frame, { ...plan, margin: { ...plan.margin, bottom: plan.margin.bottom - reserve } });
          base = { ...result, size: { ...result.size, height: result.size.height - reserve },
            ...(result.sizing ? { sizing: { ...result.sizing, naturalHeight: result.sizing.naturalHeight - reserve } } : {}),
          } as Geometry<object, object>;
          below = laidOut(base.plot.w, below.limits);
          if (below.height + gap <= reserve + 0.01) break;
          reserve = below.height + gap;
          if (++widthPass < 4) continue;
        }
        const bodyLines = maxOf(below.texts.map(text => text.body.length));
        if (bodyLines === 0 && below.limits.title === 1) {
          const sizing = result.sizing ?? geo.sizing!;
          return sizeRefusal(geo.type, geo.a11y.title, geo.size, sizing);
        }
        const limits = bodyLines > 0 ? { ...below.limits, body: bodyLines - 1 } : { title: 1, body: 0 };
        below = laidOut(base.plot.w, limits);
        reserve = below.height + gap;
        widthPass = 0;
      }
    }
    const y = base.frame?.footerRect?.y ?? base.size.height - margin.bottom;
    const extra = fixed ? geo.size.height - base.size.height : below.height + gap;
    if (fixed && below.height + gap > extra + 0.01) return sizeRefusal(geo.type, geo.a11y.title, geo.size, {
      ...base.sizing!, minHeight: Math.ceil(base.size.height + below.height + gap),
    });
    const grown = growBeforeFooter(base, extra);
    placed = { geo: grown, placement: 'below', layout: below,
      rect: { x: base.plot.x, y, w: base.plot.w, h: below.height } };
  }
  const { rect, layout, placement } = placed;
  const truncations: LintWarning[] = [];
  layout.texts.forEach((text, index) => {
    for (const [field, truncated, limit] of [['title', text.titleTruncated, layout.limits.title], ['body', text.bodyTruncated, layout.limits.body]] as const) {
      if (truncated) truncations.push({ code: 'story-text-truncated', severity: 'warn',
        message: limit === 0 ? `Story step '${spec.steps[index]!.id}' ${field} is omitted to fit the fixed frame.`
          : `Story step '${spec.steps[index]!.id}' ${field} is cut at its ${limit}-line limit.`,
        suggest: limit === 0 ? `Give the fixed frame more height to show this step's ${field}.`
          : `Shorten this step's ${field} to fit within ${limit} ${limit === 1 ? 'line' : 'lines'}, or give the story panel more width.`,
        field: ['options', 'story', 'steps', index, field] });
    }
  });
  // A relaid chart carries other node ids for the same marks only in theory; read its sets again.
  const sets = placed.geo === geo ? first.sets : stepSets(placed.geo, data, spec).sets;
  // Static output has no row: the button rects collapse to the panel edge, and only React reads them.
  const navY = navigation ? rect.y + rect.h - layout.pad - layout.buttonsH : rect.y + rect.h;
  const buttonH = navigation ? layout.buttonH : 0;
  const next = { x: rect.x + rect.w - layout.navPad - layout.nextW, y: navY + (layout.stacked ? buttonH + layout.gap : 0), w: layout.nextW, h: buttonH };
  const back = { x: layout.stacked ? rect.x : next.x - layout.gap - layout.backW, y: navY, w: layout.backW, h: buttonH };
  const textY = (font: FontSpec, box: Rect, lines = 1) => box.y + (box.h - lines * layout.lineH(font)) / 2;
  const button = (id: 'back' | 'next', box: Rect, lines: string[]): SceneNode[] => [
    { t: 'rect', id: `${STORY}${id}`, rect: box, radius: 6, fill: { token: id === 'next' ? 'ink' : 'background' }, stroke: { token: 'ink' }, strokeWidth: strokeToken(theme, 'hair'), owner: {}, part: 'storyButton' },
    { t: 'text', id: `${STORY}${id}:label`, x: box.x + box.w / 2, y: textY(fonts.nav, box, lines.length), lines, title: id === 'next' ? strings.storyNext : strings.storyBack, align: 'middle', font: fonts.nav, ink: { token: id === 'next' ? 'background' : 'ink' }, owner: {}, role: 'caption', part: 'storyButtonLabel' },
  ];
  const steps: StoryStepGeometry[] = spec.steps.map((step, index) => {
    const text = layout.texts[index]!;
    const titleY = rect.y + layout.pad;
    const bodyY = titleY + text.title.length * layout.lineH(fonts.title) + space * 2;
    const counterLines = layout.counters[index]!;
    const counterBox = { x: rect.x + layout.navPad, y: layout.counterAbove ? navY - layout.gap - layout.counterH : navY, w: rect.w - layout.navPad * 2, h: layout.counterAbove ? layout.counterH : layout.buttonH };
    return {
      id: step.id, title: step.title, body: step.body ?? '',
      nodes: [
        { t: 'text', id: `${STORY}title`, x: rect.x + layout.pad, y: titleY, lines: text.title, align: 'start', font: fonts.title, ink: { token: 'ink' }, owner: {}, role: 'caption', part: 'storyTitle' },
        ...(text.body.length ? [{ t: 'text', id: `${STORY}body`, x: rect.x + layout.pad, y: bodyY, lines: text.body, align: 'start', font: fonts.body, ink: { token: 'ink' }, owner: {}, role: 'caption', part: 'storyBody' } as SceneNode] : []),
      ],
      counter: { t: 'text', id: `${STORY}counter`, x: counterBox.x, y: textY(fonts.counter, counterBox, counterLines.length), lines: counterLines, align: 'start', font: fonts.counter, ink: { token: 'inkMuted' }, owner: {}, role: 'value', part: 'storyCounter' },
      ...sets[index]!,
    };
  });
  const touched = new Set(steps.flatMap(step => [...step.focus, ...step.dim]));
  const base: StoryGeometry['base'] = {};
  for (const node of placed.geo.scene) {
    if (!touched.has(node.id)) continue;
    base[node.id] = { ...(node.opacity === undefined ? {} : { opacity: node.opacity }), ...(node.t === 'text' ? { weight: node.font.weight } : {}) };
  }
  const story: StoryGeometry = {
    stepLabel: strings.storyStep,
    step: staticStep, placement, panel: rect, staticPanel: { ...rect, h: layout.staticHeight },
    nav: { back, next, nodes: navigation && spec.steps.length > 1 ? [...button('back', back, layout.backLines), ...button('next', next, layout.nextLines)] : [] },
    steps, base, desc: placed.geo.a11y.desc, bold: theme.type.title.weight, dim: interactionTokens(theme).dim,
  };
  const panel: SceneNode = { t: 'rect', id: `${STORY}panel`, rect, radius: 6, fill: { token: 'background' }, stroke: { token: 'grid' }, strokeWidth: strokeToken(theme, 'hair'), owner: {}, part: 'storyPanel' };
  const withStory = { ...placed.geo, story, scene: [...placed.geo.scene, panel], warnings: [...placed.geo.warnings, ...truncations] };
  // The canvas and the scene changed: the natural output size follows them.
  withStory.presentation = presentationInfo(withStory, withStory.presentation?.target ?? target, panelTypeClass(options), textScaleOf(options));
  return { ...withStory, ...storyView(withStory, staticStep, false) };
}

function pickDefined(strings: StringsSpec | undefined): Partial<StringsSpec> {
  return Object.fromEntries(Object.entries(strings ?? {}).filter(([, value]) => value !== undefined));
}

/**
 * The scene and description of step `index`, from a scene that shows any
 * step. `interactive` adds the button row and the counter. Paint and text
 * weight change; no position does.
 */
export function storyView(geometry: Pick<Geometry, 'scene' | 'a11y' | 'story'>, index: number, interactive: boolean): Pick<Geometry, 'scene' | 'a11y'> {
  const story = geometry.story;
  if (!story) return { scene: geometry.scene, a11y: geometry.a11y };
  const { bold, dim } = story;
  const step = story.steps[index] ?? story.steps[story.step]!;
  const focus = new Set(step.focus), faded = new Set(step.dim);
  const scene = geometry.scene.filter(node => !node.id.startsWith(STORY)).map(node => {
    const base = story.base[node.id];
    if (!base) return node;
    const { opacity: _opacity, ...rest } = node;
    const opacity = faded.has(node.id) ? dim * (base.opacity ?? 1) : base.opacity;
    const restored = { ...rest, ...(opacity === undefined ? {} : { opacity }) } as SceneNode;
    if (restored.t !== 'text') return restored;
    const weight = focus.has(node.id) ? Math.max(bold, base.weight ?? 0) : base.weight ?? restored.font.weight;
    return weight === restored.font.weight ? restored : { ...restored, font: { ...restored.font, weight } };
  });
  const priorPanel = geometry.scene.find(node => node.id === `${STORY}panel`);
  const panel: SceneNode = { t: 'rect', id: `${STORY}panel`, radius: 6, fill: { token: 'background' }, stroke: { token: 'grid' }, owner: {}, part: 'storyPanel',
    ...(priorPanel?.t === 'rect' ? priorPanel : {}), rect: interactive ? story.panel : story.staticPanel };
  const first = index <= 0, last = index >= story.steps.length - 1;
  const nav = interactive && story.steps.length > 1 ? [
    ...story.nav.nodes.map(node => ((first && node.id.startsWith(`${STORY}back`)) || (last && node.id.startsWith(`${STORY}next`)) ? { ...node, opacity: dim } : node)),
    step.counter,
  ] : [];
  const text = [step.title, step.body].filter(Boolean).join(' ');
  return {
    scene: [...scene, panel, ...step.nodes, ...nav],
    a11y: { ...geometry.a11y, desc: `${story.desc} Story step ${index + 1} of ${story.steps.length}: ${text}` },
  };
}
