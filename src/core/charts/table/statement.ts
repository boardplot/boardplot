/** Shared table text roles and statement spacing. */
import type { FontSpec } from '../../text';
import type { Paint } from '../../types/scene';
import type { ResolvedRow } from '../../types/table';
import type { Theme, ThemeTable } from '../../types/theme';

export function tableInk(role: keyof NonNullable<ThemeTable['inks']>): Paint {
  // The colour is decided in the theme the scene is painted in, so a repaint follows the client's inks.
  const token = ['qualifier', 'operator', 'driver', 'toggle', 'secondary'].includes(role) ? 'inkMuted' : 'ink';
  return { token, theme: { kind: 'table-ink', role } };
}

/** The quiet table rule (`table.ruleInk`): row rules, the column-group rule and the column dividers. */
export function tableRuleInk(): Paint {
  return { token: 'grid', theme: { kind: 'table-ink', role: 'rule' } };
}

export function operatorWidth(rows: readonly ResolvedRow[], theme: Theme): number {
  return rows.some(row => row.inline !== true && row.operator !== undefined) ? theme.table?.operator?.width ?? 14 : 0;
}

export function qualifierFont(font: FontSpec, theme: Theme): FontSpec {
  return { ...font, size: Math.max(1, font.size + (theme.table?.qualifier?.sizeDelta ?? -2)), weight: theme.type.label.weight };
}
