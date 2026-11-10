import { DEFAULT_THEME } from '../themeDefault';
import { toJsonPointer } from '../diagnostics/jsonPatch';
import type { LintWarning } from '../types/scene';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** An object with only overrides supplies the default preset implicitly. */
export function themeShape<T>(value: T): T {
  return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'overrides')
    ? { preset: DEFAULT_THEME, ...value } as T : value;
}

/** The accepted short forms become the same values as their object forms. */
export function optionShape(key: string, value: unknown): unknown {
  if (key === 'footnotes' && typeof value === 'string') return [value];
  if (key === 'source' && Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join('; ');
  if (key === 'locale' && typeof value === 'string') return { language: value };
  if (key === 'sort') {
    if (value === true) return { categories: 'desc' };
    if (typeof value === 'string' && ['sheet', 'asc', 'desc', 'reverse'].includes(value)) return { categories: value };
  }
  if (key === 'topN' && typeof value === 'number' && Number.isInteger(value) && value > 0) return { n: value };
  return key === 'theme' ? themeShape(value) : value;
}

/** Normalize input once before validation or layout, including grid children. */
export function normalizeOptionShapes<C extends { options?: unknown; data?: unknown; annotations?: unknown }>(
  type: string, input: C, canonical: (name: string) => string | undefined = name => name,
): { chart: C; warnings: LintWarning[] } {
  const warnings: LintWarning[] = [];
  let chart = input;
  const annotations = (raw: unknown, field: (string | number)[]): unknown => {
    if (!Array.isArray(raw)) return raw;
    let changed = false;
    const next = raw.map((item, index) => {
      // These kinds print label and no text, so a text caption is read as their label.
      if (!isRecord(item) || !['valueLine', 'band', 'event'].includes(item.kind as string) || typeof item.text !== 'string'
        || (Object.hasOwn(item, 'label') && item.label !== item.text)) return item;
      const { text, ...rest } = item;
      const at = [...field, index];
      const path = toJsonPointer(at);
      const renamed = { ...rest, label: text };
      warnings.push({ code: 'annotation-text-as-label', severity: 'info', field: [...at, 'text'],
        message: `${item.kind} text was read as label.`,
        suggest: `Use label for the ${item.kind} caption.`,
        fix: [{ op: 'test', path, value: item }, { op: 'replace', path, value: renamed }] });
      changed = true;
      return renamed;
    });
    return changed ? next : raw;
  };
  if (isRecord(input.options)) {
    let options = input.options;
    for (const key of ['footnotes', 'source', 'locale', 'sort', 'topN', 'theme', 'annotations']) {
      if (!Object.hasOwn(options, key)) continue;
      const value = key === 'annotations' ? annotations(options[key], ['options', key]) : optionShape(key, options[key]);
      if (value !== options[key]) options = { ...options, [key]: value };
    }
    if (options !== input.options) chart = { ...chart, options };
  }
  const topAnnotations = annotations(input.annotations, ['annotations']);
  if (topAnnotations !== input.annotations) chart = { ...chart, annotations: topAnnotations };
  if (type === 'grid' && isRecord(input.data)) {
    const child = (raw: unknown, field: (string | number)[]) => {
      if (!isRecord(raw) || typeof raw.type !== 'string') return raw;
      const normalized = normalizeOptionShapes(canonical(raw.type) ?? raw.type, raw, canonical);
      for (const warning of normalized.warnings) warnings.push({ ...warning,
        field: [...field, ...warning.field!],
        fix: warning.fix?.map(operation => ({ ...operation, path: toJsonPointer(field) + operation.path })) });
      return normalized.chart;
    };
    const data = input.data;
    const panels = Array.isArray(data.panels) ? data.panels.map((panel, index) => child(panel, ['data', 'panels', index])) : data.panels;
    const template = child(data.template, ['data', 'template']);
    if ((Array.isArray(panels) && panels.some((panel, index) => panel !== (data.panels as unknown[])[index])) || template !== data.template) {
      chart = { ...chart, data: { ...data, ...(panels === undefined ? {} : { panels }), ...(template === undefined ? {} : { template }) } };
    }
  }
  return { chart, warnings };
}
