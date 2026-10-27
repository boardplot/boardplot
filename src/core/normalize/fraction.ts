import { normalizeCell, normalizedNumber, NormalizeError } from './shared';
import type { Annotation } from '../types/annotations';
import type { LintWarning } from '../types/scene';
import type { RangeCell } from '../types/cell';

/** Shift the authored decimal two places without introducing a multiplication residue. */
function percentValue(value: number, path: string): number {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const pct = Number(`${mantissa}e${Number(exponent) + 2}`);
  normalizedNumber(pct, `${path}.pct`); // Keep the shared finite-number and magnitude limits after conversion.
  return pct;
}

/** Convert only numeric fraction cells. An explicit pct cell already states its unit. */
function fractionCell(raw: unknown, path: string): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw === 'object' && 'categoryId' in raw && 'value' in raw) {
    return { ...raw, value: fractionCell(raw.value, `${path}.value`) };
  }
  const cell = normalizeCell(raw, path) as Exclude<RangeCell, number>;
  if (cell === null || 'pct' in cell) return cell;
  if ('date' in cell) throw new NormalizeError('invalid-data', path, 'fraction values must be numeric or null');
  const { number, range, ...meta } = cell;
  const pct = percentValue(number, path);
  return {
    ...meta, pct,
    ...(range ? { range: {
      low: percentValue(range.low, `${path}.range.low`), high: percentValue(range.high, `${path}.range.high`),
      ...(range.mid === undefined ? {} : { mid: percentValue(range.mid, `${path}.range.mid`) }),
    } } : {}),
  };
}

/** Input preparation shared by the CLI and React. Removing the declaration makes this idempotent. */
export function prepareFractionData<T>(data: T): T {
  if (typeof data !== 'object' || data === null) return data;
  const input = data as { valueKind?: string; values?: unknown[]; series?: Array<{ valueKind?: string; values: unknown[] }> };
  const checkKind = (kind: string | undefined, path: string) => {
    if (kind !== undefined && kind !== 'fraction') throw new NormalizeError('invalid-data', path, "valueKind must be 'fraction'");
  };
  checkKind(input.valueKind, 'valueKind');
  let declared = input.valueKind !== undefined;
  input.series?.forEach((series, index) => {
    checkKind(series.valueKind, `series[${index}].valueKind`);
    declared ||= series.valueKind !== undefined;
  });
  if (!declared) return data;
  const { valueKind, ...rest } = input;
  if (input.series) {
    return { ...rest, series: input.series.map((series, index) => {
      if ((series.valueKind ?? valueKind) !== 'fraction') return series;
      const { valueKind: _kind, ...fields } = series;
      const negative = (series as { negative?: unknown }).negative; // slope variant 'diverging'
      return { ...fields, values: series.values.map((cell, ci) => fractionCell(cell, `series[${index}].values[${ci}]`)),
        ...(Array.isArray(negative) ? { negative: negative.map((cell, ci) => fractionCell(cell, `series[${index}].negative[${ci}]`)) } : {}) };
    }) } as T;
  }
  return { ...rest, values: input.values?.map((cell, index) => fractionCell(cell, `values[${index}]`)) } as T;
}

/** Numeric value lines declare fractions independently of the series' units. */
export function prepareFractionAnnotations(annotations: Annotation[] | undefined): Annotation[] | undefined {
  if (!annotations?.some(ann => ann.kind === 'valueLine' && ann.valueKind !== undefined)) return annotations;
  return annotations.map((ann, index) => {
    if (ann.kind !== 'valueLine' || ann.valueKind === undefined) return ann;
    const path = `options.annotations[${index}]`;
    if (ann.valueKind !== 'fraction' || typeof ann.value !== 'number') {
      throw new NormalizeError('invalid-annotation', `${path}.valueKind`, "valueLine valueKind 'fraction' needs a numeric value");
    }
    const { valueKind: _kind, ...rest } = ann;
    const tolerance = ann.tolerance;
    return { ...rest, value: percentValue(ann.value, `${path}.value`),
      ...(tolerance === undefined ? {} : { tolerance: typeof tolerance === 'number'
        ? percentValue(tolerance, `${path}.tolerance`)
        : { low: percentValue(tolerance.low, `${path}.tolerance.low`), high: percentValue(tolerance.high, `${path}.tolerance.high`) } }),
    };
  });
}

/** A percent claim on fraction-sized values needs a scale declaration, never an inferred conversion. */
export function percentScaleWarnings(data: unknown, options: { format?: string; variant?: unknown; valueAxis?: { percent?: boolean } }, type: string): LintWarning[] {
  // Composition inputs are weights: 0.2 and 0.8 draw 20% and 80%, without a fraction declaration.
  if (type === 'pie' || type === 'waffle' || (type === 'mekko' && (options.variant ?? 'stacked100') === 'stacked100') ||
    (['bar', 'column', 'line'].includes(type) && (options.valueAxis?.percent || options.variant === 'stacked100' || options.variant === 'stacked100-area'))) return [];
  const input = data as { valueKind?: string; values?: unknown[]; series?: { id?: string; label?: string; valueKind?: string; format?: string; values?: unknown[] }[] } | null;
  const seriesInputs = Array.isArray(input?.series) ? input.series
    : type === 'sparkline' && Array.isArray(input?.values) ? [{ id: 'sparkline', values: input.values, valueKind: input.valueKind }] : [];
  return seriesInputs.flatMap(series => {
    if (!Array.isArray(series.values) || (series.valueKind ?? input?.valueKind) === 'fraction') return [];
    let percent = (series.format ?? options.format)?.includes('%') ?? false;
    const values = series.values.flatMap(raw => {
      const cell = raw && typeof raw === 'object' && 'categoryId' in raw && 'value' in raw ? raw.value : raw;
      if (typeof cell === 'number') return [cell];
      if (!cell || typeof cell !== 'object') return [];
      if ('pct' in cell || ('format' in cell && typeof cell.format === 'string' && cell.format.includes('%')) ||
        ('label' in cell && typeof cell.label === 'string' && cell.label.includes('%'))) percent = true;
      const value = 'pct' in cell ? cell.pct : 'number' in cell ? cell.number : undefined;
      return typeof value === 'number' ? [value] : [];
    });
    if (!percent || !values.some(value => value !== 0) || !values.every(value => Number.isFinite(value) && Math.abs(value) <= 1)) return [];
    return [{ code: 'percent-scale-suspect', severity: 'warn' as const, owner: { seriesId: series.id },
      message: `series '${series.label ?? series.id}': every value is within ±1, but its format, cell kind or label claims percent units. Percent values use points: 0.33 prints 0.33%, not 33%. Authored labels do not change the axis scale.`,
      suggest: "For fractions, use numeric cells with data.valueKind: 'fraction' (or series.valueKind). For small percent-point values, keep the values as authored.",
    }];
  });
}
