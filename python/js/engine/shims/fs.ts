/**
 * node:fs for the Python engine. The in-memory render, rows, describe and list
 * paths never touch the file system; each call names itself and throws.
 */
import { unavailable } from './unavailable';

const call = (name: string) => (..._args: unknown[]): never => unavailable(`fs.${name}`);

export const closeSync = call('closeSync');
export const existsSync = call('existsSync');
export const lstatSync = call('lstatSync');
export const mkdirSync = call('mkdirSync');
export const mkdtempSync = call('mkdtempSync');
export const openSync = call('openSync');
export const readdirSync = call('readdirSync');
export const readFileSync = call('readFileSync');
export const realpathSync = call('realpathSync');
export const rmSync = call('rmSync');
export const statSync = call('statSync');
export const writeFileSync = call('writeFileSync');
/** Open flags exist only for writes to outDir; reading one throws too. */
export const constants: Record<string, number> = new Proxy({}, { get: (_target, key) => unavailable(`fs.constants.${String(key)}`) });
