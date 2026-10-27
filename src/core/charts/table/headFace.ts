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

/**
 * A field head's text: in capitals, unless `table.head.case` is 'asis'. The
 * comma and a unit after the last one ("Revenue, $bn", "Power,mW") stay as
 * written, so "mW" never reads as "MW".
 */
export function fieldHeadText(label: string, theme: Pick<Theme, 'table'>): string {
  if (theme.table?.head?.case === 'asis') return label;
  const cut = label.lastIndexOf(',');
  return cut < 0 ? label.toUpperCase() : `${label.slice(0, cut).toUpperCase()}${label.slice(cut)}`;
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
