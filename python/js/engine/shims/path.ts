/** node:path for the Python engine: only outDir, rowsFile and font-table files use it, and none exists here. */
import { unavailable } from './unavailable';

const call = (name: string) => (..._args: unknown[]): never => unavailable(`path.${name}`);

export const basename = call('basename');
export const dirname = call('dirname');
export const extname = call('extname');
export const isAbsolute = call('isAbsolute');
export const join = call('join');
export const resolve = call('resolve');
