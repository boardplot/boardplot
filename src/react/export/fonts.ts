const unquote = (name: string) => name.trim().replace(/^(['"])(.*)\1$/, '$2');
/** Family names match without case, as CSS matches them. */
const familyKey = (name: string) => unquote(name).toLowerCase();

const warnedFonts = new WeakMap<FontFaceSet, Set<string>>();

/** Use the export's existing warning channel, once per page and font stack. */
function warnUnloadedFont(family: string): void {
  if (typeof document === 'undefined' || !document.fonts?.check) return;
  const fonts = document.fonts;
  if (fonts.check(`12px ${family}`)) return;
  const warned = warnedFonts.get(fonts) ?? new Set<string>();
  if (warned.has(family)) return;
  warned.add(family);
  warnedFonts.set(fonts, warned);
  console.warn(`Boardplot export: the theme font '${family}' is not loaded in the page, so the SVG and PNG carry no copy of it and draw a fallback face. Load the font before exporting, for example with document.fonts.load().`);
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Every @font-face rule of the page's readable style sheets, inside @media, @supports, @layer and @import too. */
function fontFaceRules(sheets: StyleSheetList): Array<{ rule: CSSFontFaceRule; base: string }> {
  const found: Array<{ rule: CSSFontFaceRule; base: string }> = [];
  const visit = (sheet: CSSStyleSheet) => {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { return; } // another origin's sheet
    const walk = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSFontFaceRule) found.push({ rule, base: sheet.href ?? document.baseURI });
        else if (rule instanceof CSSImportRule && rule.styleSheet) visit(rule.styleSheet);
        else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    walk(rules);
  };
  for (const sheet of Array.from(sheets)) visit(sheet);
  return found;
}

const decode = (text: string) => text
  .replace(/<[^>]*>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
  .replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]!);

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

interface FamilyUse { styles: Map<string, Set<number>>; chars: Set<number> }

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|math|emoji|fangsong|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/;

/**
 * Whether the page draws with a family that has no loaded web face: a generic
 * family, or an installed one, whose width differs from both fallbacks.
 * Without a canvas to measure with, it counts as installed.
 */
function installedProbe(): (name: string) => boolean {
  const context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  const width = (font: string) => { context!.font = `72px ${font}`; return context!.measureText('mmmmmmmmmmlli10WQ@').width; };
  return (name) => GENERIC.test(familyKey(name)) || !context
    || ['monospace', 'serif'].some((fallback) => width(`"${unquote(name)}", ${fallback}`) !== width(fallback));
}

/**
 * The weights, styles and characters each family of the SVG's text draws
 * with. A family the machine lacks is skipped. An installed system family
 * ends the stack for text it surely covers (Latin-1, general punctuation,
 * the euro), so a later web font such as a Roboto the host loaded for
 * itself behind Helvetica is not copied; other text keeps the later web
 * fonts, which draw the glyphs the system family lacks.
 */
function familyUses(svg: string, rootFamily: string, loaded: Set<string>): Map<string, FamilyUse> {
  const installed = installedProbe();
  const uses = new Map<string, FamilyUse>();
  for (const [, open = '', body = ''] of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const style = attr(open, 'font-style') ?? 'normal';
    const weights = [Number(attr(open, 'font-weight') ?? 400), ...[...body.matchAll(/<tspan\b[^>]*\sfont-weight="([^"]*)"/g)].map((m) => Number(m[1]))];
    const chars = [...decode(body)].map((c) => c.codePointAt(0)!);
    const basic = chars.every((c) => c <= 0xff || (c >= 0x2000 && c <= 0x206f) || c === 0x20ac);
    for (const name of decode(attr(open, 'font-family') ?? rootFamily).split(',')) {
      const key = familyKey(name);
      if (!loaded.has(key)) {
        if (basic && installed(name)) break;
        continue;
      }
      const use = uses.get(key) ?? { styles: new Map(), chars: new Set() };
      const set = use.styles.get(style) ?? new Set<number>();
      for (const weight of weights) set.add(weight);
      use.styles.set(style, set);
      for (const char of chars) use.chars.add(char);
      uses.set(key, use);
    }
  }
  return uses;
}

interface Face { rule: CSSFontFaceRule; base: string; min: number; max: number; style: string; stretch: [number, number]; ranges?: Array<[number, number]> }

const STRETCH: Record<string, number> = {
  'ultra-condensed': 50, 'extra-condensed': 62.5, condensed: 75, 'semi-condensed': 87.5, normal: 100,
  'semi-expanded': 112.5, expanded: 125, 'extra-expanded': 150, 'ultra-expanded': 200, auto: 100, '': 100,
};

function face(rule: CSSFontFaceRule, base: string): Face {
  const weight = rule.style.getPropertyValue('font-weight').trim();
  // CSS matches `auto` as normal weight.
  const [min, max = min] = weight === 'bold' ? [700] : weight === '' || weight === 'normal' || weight === 'auto' ? [400] : weight.split(/\s+/).map(Number);
  const stretches = rule.style.getPropertyValue('font-stretch').trim().split(/\s+/).map((v) => STRETCH[v] ?? parseFloat(v));
  const stretch: [number, number] = [stretches[0]!, stretches[1] ?? stretches[0]!];
  const style = rule.style.getPropertyValue('font-style').trim().split(/\s/)[0] || 'normal';
  const range = rule.style.getPropertyValue('unicode-range').trim();
  const ranges = range === '' ? undefined : [...range.matchAll(/U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/gi)].map(([, lo = '', hi]): [number, number] => [
    parseInt(lo.replace(/\?/g, '0'), 16),
    parseInt(hi ?? lo.replace(/\?/g, 'f'), 16),
  ]);
  return { rule, base, min: min!, max: max!, style, stretch, ranges };
}

/** CSS Fonts 4 style matching: the wanted style, then the nearest slant, then any. */
function styleTier(want: string, has: string): number {
  if (want === has) return 0;
  const order = want === 'normal' ? ['oblique', 'italic'] : want === 'italic' ? ['oblique', 'normal'] : ['italic', 'normal'];
  return 1 + order.indexOf(has);
}

/** CSS Fonts 4 weight matching, as (tier, distance): the face the browser draws a weight with. */
function weightRank(want: number, { min, max }: Face): [number, number] {
  if (min <= want && want <= max) return [0, 0];
  const above = min > want;
  const distance = above ? min - want : want - max;
  if (want >= 400 && want <= 500) return [above ? (min <= 500 ? 1 : 3) : 2, distance];
  return [want < 400 ? (above ? 2 : 1) : (above ? 1 : 2), distance];
}

/** CSS Fonts 4 width matching for the normal width the SVG draws: covering, then narrower, then wider. */
function stretchRank({ stretch: [min, max] }: Face): [number, number] {
  return min <= 100 && 100 <= max ? [0, 0] : max < 100 ? [1, 100 - max] : [2, min - 100];
}

const better = (a: [number, number], b: [number, number]) => b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]);

/** The faces a family draws its weights, styles and characters with: what the browser would load for them. */
function facesFor(all: Face[], use: FamilyUse): Set<Face> {
  const chosen = new Set<Face>();
  if (all.length === 0) return chosen;
  // Width comes first in CSS matching, then style, then weight.
  const width = all.map(stretchRank).reduce((a, b) => (better(a, b) ? b : a));
  const faces = all.filter((f) => { const r = stretchRank(f); return r[0] === width[0] && r[1] === width[1]; });
  for (const [style, weights] of use.styles) {
    const tier = Math.min(...faces.map((f) => styleTier(style, f.style)));
    const styled = faces.filter((f) => styleTier(style, f.style) === tier);
    for (const weight of weights) {
      const ranked = styled.map((f) => ({ f, rank: weightRank(weight, f) }));
      const best = ranked.reduce((a, b) => (better(a.rank, b.rank) ? b : a), ranked[0]!);
      for (const { f, rank } of ranked) {
        if (rank[0] !== best.rank[0] || rank[1] !== best.rank[1] || f.min !== best.f.min || f.max !== best.f.max) continue;
        if (!f.ranges || [...use.chars].some((c) => f.ranges!.some(([lo, hi]) => lo <= c && c <= hi))) chosen.add(f);
      }
    }
  }
  return chosen;
}

/** Every descriptor of a rule but its src, so size-adjust and the rest draw as on the page. */
function descriptors(rule: CSSFontFaceRule): string {
  const names = new Set(Array.from({ length: rule.style.length ?? 0 }, (_, i) => rule.style.item(i)));
  for (const name of ['font-family', 'font-weight', 'font-style', 'font-stretch', 'unicode-range']) names.add(name);
  names.delete('src');
  return [...names].map((name) => [name, rule.style.getPropertyValue(name).trim()]).filter(([, value]) => value !== '').map(([name, value]) => `${name}:${value};`).join('');
}

/**
 * The SVG with the page's web fonts its text draws with, as data:
 * @font-face rules: only the families, weights, styles and unicode-range
 * slices the text uses, each a whole font file. An SVG opened elsewhere or
 * drawn through an image loads nothing outside itself, so it drew a fallback
 * face where the page used the web font. A loaded face whose
 * file cannot be read (another origin's sheet, a FontFace built in script)
 * is named in a console warning.
 */
export async function withPageFonts(svg: string, family: string): Promise<string> {
  if (typeof document === 'undefined' || document.fonts === undefined) return svg;
  warnUnloadedFont(family);
  const loaded = new Map<string, string>();
  document.fonts.forEach((face) => { if (face.status === 'loaded') loaded.set(familyKey(face.family), unquote(face.family)); });
  if (loaded.size === 0) return svg;
  const rootFamily = attr(/<svg\b[^>]*>/.exec(svg)?.[0] ?? '', 'font-family') ?? family;
  const uses = familyUses(svg, rootFamily, new Set(loaded.keys()));
  if (uses.size === 0) return svg;
  const byFamily = new Map<string, Face[]>();
  for (const { rule, base } of fontFaceRules(document.styleSheets)) {
    const key = familyKey(rule.style.getPropertyValue('font-family'));
    if (uses.has(key)) byFamily.set(key, [...byFamily.get(key) ?? [], face(rule, base)]);
  }
  const chosen = new Set<Face>();
  for (const [key, use] of uses) for (const f of facesFor(byFamily.get(key) ?? [], use)) chosen.add(f);
  const faces: string[] = [];
  for (const f of [...byFamily.values()].flat().filter((f) => chosen.has(f))) {
    const name = familyKey(f.rule.style.getPropertyValue('font-family'));
    const url = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(f.rule.style.getPropertyValue('src'))?.[2];
    if (!url) continue;
    try {
      let source = url;
      if (!url.startsWith('data:')) {
        const response = await fetch(new URL(url, f.base));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        source = await dataUrl(await response.blob());
      }
      faces.push(`@font-face{${descriptors(f.rule)}src:url("${source}");}`);
    } catch (error) {
      console.warn(`Boardplot export could not read the font file ${url} of '${loaded.get(name)}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A family with no readable rule: another origin's sheet, or a FontFace built in script.
  for (const key of uses.keys()) {
    if (!byFamily.has(key)) console.warn(`Boardplot export could not read the font face '${loaded.get(key)}'; the SVG and PNG draw a fallback face.`);
  }
  if (faces.length === 0) return svg;
  const style = `<style>${faces.join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</style>`;
  return svg.replace(/<svg\b[^>]*>/, (open) => open + style);
}
