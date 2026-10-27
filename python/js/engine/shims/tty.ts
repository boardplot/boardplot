/** node:tty for the Python engine: only the CLI's stdin spec reader asks, and the engine never reads stdin. */
import { unavailable } from './unavailable';

export function isatty(_fd: number): never {
  return unavailable('tty.isatty');
}
