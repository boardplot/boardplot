/**
 * The rows chunk: the one rows transform (`core/rows`, which `specFromRows`
 * and the CLI's `rows` run) for the `rows` and `columns` props. Every chart
 * component fetches it with `import()` when a host passes rows, so a page
 * without rows never loads it; `react/prepare` links it statically.
 */
import { InputError } from '../core/inputError';
import { adaptRows, rewriteRowsDiagnostics, type RowsPathMap } from '../core/rows';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { LintWarning } from '../core/types/scene';
import { publishRowsModule, type MappedRows } from './rowsStore';

/** Pointer `/rows/3/revenue` as the chart card's dotted path `rows.3.revenue`. */
const dotted = (pointer: string) => pointer.replace(/^\//, '').split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).join('.');

/** The rows as the chart's data, or the InputError they refuse with, as the spec card and the chart card show it. */
function mapRows(spec: unknown, columns: unknown, rows: unknown): MappedRows {
  try {
    const adapted = adaptRows(spec, columns, { argument: '/rows', load: () => ({ rows }) });
    return { spec: adapted.spec, pathMap: adapted.pathMap, reading: { rows: adapted.rows, ignoredColumns: adapted.ignoredColumns, states: adapted.states } };
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const details = error.details as Partial<DocumentFinding>;
    const path = details.path ?? '';
    return {
      refusal: { code: error.code, message: error.message, ...details, path },
      refusals: [{ code: error.code, message: error.message, path: dotted(path), ...(details.suggest ? { suggest: details.suggest } : {}) }],
    };
  }
}

/**
 * Layout warnings at a mapped data field (`data.series.0.values.2`) at the
 * rows field it came from (`rows.5.revenue`), as the CLI rewrites its findings.
 */
function rewriteWarningFields(warnings: LintWarning[], pathMap: RowsPathMap): LintWarning[] {
  return warnings.map((warning) => {
    if (!warning.field?.length) return warning;
    const pointer = `/${warning.field.join('/')}`;
    const [moved] = rewriteRowsDiagnostics([{ path: pointer }], pathMap);
    if (moved!.path === pointer) return warning;
    return { ...warning, field: moved!.path!.slice(1).split('/').map(part => (/^\d+$/.test(part) ? Number(part) : part)) };
  });
}

export const rowsModule = { adaptRows, mapRows, rewriteRowsDiagnostics, rewriteWarningFields };
export type RowsModule = typeof rowsModule;

publishRowsModule(rowsModule);
