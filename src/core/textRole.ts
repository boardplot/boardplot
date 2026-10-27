/**
 * Text roles. Every text node the serializers emit carries
 * `data-bp-role`, and only the numeric roles carry tabular figures. With
 * fonts whose tabular set also widens spaces and punctuation,
 * tabular figures on a title or a category name read as typewriter spacing.
 *
 * The role follows from the node's `part`. A node sets `role` itself only
 * where one part mixes names and numbers: table cells, hover card rows,
 * scatter point names, and annotation labels that print a number.
 *
 * a part alone cannot say which of the two a node holds, because
 * the same part carries "80" on one chart and "Display 80 (20%)" on the
 * next. Every site that COMPOSES a label out of a name and a number asks
 * `composedTextRole` instead, and the answer follows the string: a bare
 * number is a value, a sentence is prose.
 */

import type { SceneNode, TextRole, TypographyMetadata, TypographyRole } from './types/scene';
import type { Theme } from './types/theme';


type TextNode = Extract<SceneNode, { t: 'text' }>;

/** Shared label kinds have stable typography roles. Family-specific text sets
 * typeRole explicitly. External text without metadata uses the label floor.
 */
export function labelTypeRole(label: TypographyMetadata & { kind: string }): TypographyRole {
  if (label.typeRole !== undefined) return label.typeRole;
  switch (label.kind) {
    case 'title': return 'title';
    case 'subtitle': return 'subtitle';
    case 'source':
    case 'footnote': return 'footnote';
    case 'tick':
    case 'category':
    case 'axisTitle':
    case 'tableHeader':
    case 'tableHeaderSub':
    case 'tableGroupHeader': return 'axis';
    default: return 'label';
  }
}

/**
 * Parts that are not numbers, by role. Every other part is a value (data
 * labels, totals, table numbers, KPI values, hover card values), which keeps
 * a part added later on the tabular figures. `title`,
 * `subtitle` and `source` are parts named like their role.
 *
 * `annotation` is a note: most annotation labels are prose (callouts, notes,
 * event and target labels, authored overrides). The ones that print a
 * computed number (delta, abs, cagr, diff, bullet deltas, box n, event marker
 * numbers, integrated variance) set `role: 'value'` on their request.
 */
const NAMED_PARTS: readonly (readonly [TextRole, string])[] = [
  ['note', 'footnote tableCellNote annotation'],
  ['caption', 'axisTitle panelTitle panelCaption tierCaption diagramCaption'],
  ['axis', 'tick scale'],
  ['category', 'category series legendLabel legendHeading activity item tableHeader tableHeaderSub tableGroupHeader diagramNode diagramSecondary diagramEdge diagramGroup diagramLane overlayLabel'],
];
const PART_ROLES = new Map<string, TextRole>(NAMED_PARTS.flatMap(([role, parts]) => parts.split(' ').map((part) => [part, role] as const)));
const ROLES: ReadonlySet<string> = new Set<TextRole>(['title', 'subtitle', 'value', 'axis', 'category', 'caption', 'note', 'source']);

/**
 * The role a text node reports. Geometry can come from a host, so an unknown
 * `role` string is ignored rather than written into an attribute.
 */
export function textRole(node: TextNode): TextRole {
  if (node.role !== undefined && ROLES.has(node.role)) return node.role;
  if (node.part === 'title' || node.part === 'subtitle' || node.part === 'source') return node.part;
  // A map credit is part of the source credit (footer rule), not a value.
  if (node.part === 'credit') return 'source';
  return PART_ROLES.get(node.part) ?? 'value';
}

/** Currency symbols the formatters set before or after the digits. */
const CURRENCY_SIGN = '$€£¥₹₽¢₩';
/** ISO codes an authored `prefix` or `suffix` carries instead of a symbol. */
const CURRENCY_CODE = 'EUR|USD|GBP|CHF|JPY|CNY|SEK|NOK|DKK|PLN|CZK|HUF|CAD|AUD|NZD|INR|BRL|MXN|ZAR|SGD|HKD|KRW';
/** `format.ts` magnitudes, their capitals, and the German short scale. */
const MAGNITUDE = '(?:k|K|m|M|bn|Bn|BN|b|B|t|T|Mio|Mrd)';
const CURRENCY = `(?:[${CURRENCY_SIGN}]|(?:${CURRENCY_CODE})\\b)`;
/**
 * Digits and their separators as `Intl.NumberFormat` emits them, which is
 * not the ASCII set: `ar-EG` prints ١٬٢٣٤٫٥ and `fa-IR` ۱٬۲۳۴٫۵, with the
 * Arabic thousands and decimal separators between them. `\\p{Nd}` is every
 * decimal digit Unicode defines, which is what the formatter can reach.
 */
const DIGITS = "\\p{Nd}[\\p{Nd}.,'’  ٫٬، ]*";
/**
 * The sign, ahead of the number. `ar-EG` and `fa-IR` mark it with a bidi
 * control (U+061C, U+200E, U+200F) beside the minus, and the formatters
 * reach the Unicode minus as well as the hyphen.
 */
const SIGN = '[+\\-–−؜‎‏]*';
const PERCENT = '(?:%|٪|‰|pp|x|×)';
const ONE_NUMBER = `${SIGN}\\s?${CURRENCY}?\\s?${SIGN}${DIGITS}${MAGNITUDE}?\\s?${PERCENT}?[؜‎‏]?\\s?${CURRENCY}?\\s?${MAGNITUDE}?`;
/**
 * One number, or one number with its share behind it the way a slice
 * prints "35.6M (37%)", or one number in brackets, which is how the
 * accounting sign writes a negative: "($1,200,000.00)".
 */
const NUMBER_ALONE = new RegExp(
  `^(?:${ONE_NUMBER}(?:\\s?\\(${ONE_NUMBER}\\))?|\\(${ONE_NUMBER}\\))$`,
  'u',
);
/**
 * What the engine prints where a number could not be computed. It stands in
 * a value slot and has no digits to align, so it counts as a number rather
 * than pushing a whole column into prose.
 */
const NUMBER_PLACEHOLDER = /^(?:n\/a|n\.m\.|[-–—])$/;

/**
 * Whether a drawn string IS one number: an optional sign, a currency symbol
 * or ISO code, digits with separators, one magnitude suffix, a percent or
 * percentage-point unit, optionally a second number in brackets — and
 * nothing else. A name beside the number, a comparison word ("vs target"),
 * a month name or an arrow makes the string prose.
 */
export function isNumberAlone(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return true;
  return NUMBER_PLACEHOLDER.test(trimmed) || NUMBER_ALONE.test(trimmed);
}

/**
 * The role of a label the ENGINE composed from a name and a number — a
 * funnel step caption, a pie slice label, a KPI comparison chip, a value
 * line tag. A sentence is prose whatever part carries it; the same label
 * reduced to its bare number is a value again. `prose` is the role
 * the part reads as when it is not a number: a caption for a label on the
 * plot, a note for one that sits with the annotations.
 */
export function composedTextRole(text: string, prose: 'caption' | 'note' = 'caption'): TextRole {
  return isNumberAlone(text) ? 'value' : prose;
}

/**
 * The role of an annotation label that shows a computed number unless the
 * author replaced it: the number is a value, the replacement is the author's
 * text and reads as a note. A computed text that is itself a sentence —
 * "n = 44", "−10 vs target", "+26.0% p.a." — is a note too.
 */
export function computedTextRole(text: string, computed: string): 'value' | 'note' {
  return text === computed && isNumberAlone(text) ? 'value' : 'note';
}

/** Only these roles set figures; every other role leaves the font's default. */
function isNumericRole(role: TextRole): boolean {
  return role === 'value' || role === 'axis';
}

/** The `font-variant-numeric` value for a role, or undefined for no declaration. */
export function numericVariant(role: TextRole, theme: Theme): 'tabular-nums' | 'proportional-nums' | undefined {
  if (!isNumericRole(role)) return undefined;
  return theme.type.numeric === 'proportional' ? 'proportional-nums' : 'tabular-nums';
}
