/** ./raster for the Python engine: PNG output is a later step, so the engine draws SVG only. */
import { unavailable } from './unavailable';

export function rasterize(..._args: unknown[]): never {
  return unavailable('PNG rendering');
}
