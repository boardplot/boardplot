import type { DrawnChart } from '../exportLink';
import type { ExportInput } from './types';

/** Set by `useExport` when a chart holds the handle: what that chart drew. */
export const DRAWN: unique symbol = Symbol('drawn') as never;
export type DrawnExportInput = ExportInput & { [DRAWN]?: DrawnChart };
