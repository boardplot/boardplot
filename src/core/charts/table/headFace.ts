/**
 * The table family's head, for the charts that draw report columns beside
 * the table: the cohort exhibit and the bar table. One face, one rule and
 * one total ground, read from `theme.table`, so a theme that restyles the
 * table head restyles theirs.
 */
import type { FontSpec } from '../../text';
import type { Paint } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { resolveSurface, semanticPalettePaint, strokeToken } from '../../theme';
import { tableInk } from './statement';

/** A head that holds a bracket or a word with a capital after a lowercase letter (mW, kWh, eBay) needs the careful path. */
const HEAD_KEEPS = /[([]|\p{Ll}\p{Lu}/u;
const INNER_CAPITAL = /\p{Ll}\p{Lu}/u;
const HEAD_PARTS = /[^\s,]+|[\s,]+/gu;

/**
 * A field head's text: in capitals, unless `table.head.case` is 'asis'. Case
 * carries meaning in a unit, so three parts stay as written: the text after
 * the last comma ("Revenue, $bn"), text in parentheses or square brackets
 * ("Standby power (mW)"), and a word with a capital after a lowercase letter
 * ("kWh", "eBay"). "mW" never reads as "MW", nor "Mb" as "MB".
 */
export function fieldHeadText(label: string, theme: Pick<Theme, 'table'>): string {
  if (theme.table?.head?.case === 'asis') return label;
  const cut = label.lastIndexOf(',');
  const head = cut < 0 ? label : label.slice(0, cut);
  const tail = cut < 0 ? '' : label.slice(cut);
  if (!HEAD_KEEPS.test(head)) return head.toUpperCase() + tail;
  let depth = 0;
  let text = '';
  for (const part of head.match(HEAD_PARTS) ?? []) {
    const keep = INNER_CAPITAL.test(part);
    for (const char of part) {
      if (char === '(' || char === '[') depth++;
      text += keep || depth > 0 ? char : char.toUpperCase();
      if ((char === ')' || char === ']') && depth > 0) depth--;
    }
  }
  return text + tail;
}

/** The field-head face: `table.head` over the axis role, with no tracking where the theme names none. */
export function fieldHeadFont(theme: Theme): FontSpec {
  const head = theme.table?.head;
  const size = head?.size ?? theme.type.axis.size;
  const tracking = (head?.tracking ?? 0) * size;
  return {
    family: theme.type.family,
    ...theme.type.axis,
    size,
    weight: head?.weight ?? theme.type.axis.weight,
    ...(tracking === 0 ? {} : { letterSpacing: tracking }),
  };
}

/**
 * The column-head ink of the whole table family: `table.inks.head`, else the
 * muted ink, decided in the theme the scene is painted in.
 */
export function headInk(): Paint {
  return tableInk('head');
}

/** True for the plain text ink a label solver gives every label it has no other ink for. */
export function plainInk(ink: Paint): boolean {
  return 'token' in ink && ink.token === 'ink' && Object.keys(ink).length === 1;
}

/** The rule under the head block: `table.ruleWidths.head` in the ink `table.headRule` picks. */
export function headRule(theme: Theme): { stroke: Paint; width: number } {
  return {
    stroke: { token: theme.table?.headRule === 'ink' ? 'ink' : 'rule' },
    width: theme.table?.ruleWidths?.head ?? strokeToken(theme, 'hair'),
  };
}

/** The rule above and below a total row: 1 px in the rule ink, as the table draws it. */
export function totalRule(theme: Theme): { stroke: Paint; width: number } {
  return { stroke: { token: 'rule' }, width: strokeToken(theme, 'rule') };
}

/** The ground of a total row: `table.grounds.total` (transparent: the page), else the table's total ground (twice the band tint). */
export function totalGround(theme: Theme, palette?: string): Paint {
  const authored = theme.table?.grounds?.total;
  if (authored !== undefined) return authored.trim().toLowerCase() === 'transparent' ? { token: 'background' } : { css: authored };
  return semanticPalettePaint(theme, palette, 'neutral', 1 - Math.min(1, resolveSurface(theme).bandTint * 2));
}
