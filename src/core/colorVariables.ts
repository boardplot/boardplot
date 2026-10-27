import { literalColor } from './colorLiteral';
import type { LintWarning } from './types/scene';

const VARIABLE = /^\s*var\(\s*(--[a-z_][a-z0-9_-]*)\s*,/i;
// A host redraws with the same data object; its fills are read once.
const dataFills = new WeakMap<object, Found[]>();

interface Found { field: (string | number)[]; variable: string; painted: string }

/**
 * Boardplot paints the fallback of `var(--token, fallback)` and never reads the page.
 * Tell the author once per variable and painted colour, so a chart that does not
 * follow the page is never a silent surprise. Theme values and data `fill` fields count.
 */
export function colorVariableWarnings(data: unknown, theme: unknown, themeField: readonly (string | number)[] = ['options', 'theme']): LintWarning[] {
  let fills = data && typeof data === 'object' ? dataFills.get(data) : undefined;
  if (!fills) {
    fills = scan(data, ['data'], false);
    if (data && typeof data === 'object') dataFills.set(data, fills);
  }
  const groups = new Map<string, { first: Found; count: number }>();
  for (const item of [...(theme && typeof theme === 'object' ? scan(theme, [...themeField], true) : []), ...fills]) {
    const key = `${item.variable}\0${item.painted}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { first: item, count: 1 });
  }
  return [...groups.values()].map(({ first, count }) => ({
    code: 'css-var-fallback-used', severity: 'warn' as const, field: first.field,
    message: `Boardplot does not read var(${first.variable}); it paints the fallback ${first.painted}${count > 1 ? ` in ${count} fields` : ''}.`,
    suggest: `Pass the literal colour. If CSS owns ${first.variable}, read getComputedStyle(element).getPropertyValue('${first.variable}').trim() after the page theme applies, pass that value, and read it again on each theme switch.`,
  }));
}

/** The path is one shared stack, copied only for a match, so large tables stay cheap. */
function scan(value: unknown, field: (string | number)[], colour: boolean, found: Found[] = []): Found[] {
  if (typeof value === 'string') {
    const variable = colour ? VARIABLE.exec(value)?.[1] : undefined;
    const painted = variable === undefined ? null : literalColor(value);
    if (variable !== undefined && painted !== null) found.push({ field: [...field], variable, painted });
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const child: unknown = value[i];
      if (child === null || (typeof child !== 'object' && typeof child !== 'string')) continue;
      field.push(i); scan(child, field, colour, found); field.pop();
    }
  } else if (value && typeof value === 'object') {
    for (const key in value) {
      // Table cells are keyed by column id, so a column named 'fill' holds text, not a colour.
      if (!Object.hasOwn(value, key) || (key === 'cells' && !colour)) continue;
      field.push(key); scan((value as Record<string, unknown>)[key], field, colour || key === 'fill' || key === 'theme', found); field.pop();
    }
  }
  return found;
}
