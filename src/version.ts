import { version as API_VERSION } from '../package.json';

/** The package's API version, without the build identity a packaged build adds. */
export { API_VERSION };

/** Source API version; packaged builds inject their deterministic distribution version. */
declare const __BOARDPLOT_BUILD_VERSION__: string | undefined;
export const BOARDPLOT_VERSION = typeof __BOARDPLOT_BUILD_VERSION__ === 'string'
  ? __BOARDPLOT_BUILD_VERSION__
  : API_VERSION;
