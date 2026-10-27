import { resolveChartRequest, type ChartRequest, type ResolvedChartRequest } from '../core/request';
import { themeForDensity } from '../core/themeDensity';
import type { BoardplotThemeOptions } from './themeContext';

/** Same inherited options for a provider and an explicitly prepared server request. */
export function resolveThemeRequest(request: ChartRequest, settings: BoardplotThemeOptions): ResolvedChartRequest {
  const result = resolveChartRequest(request, settings);
  if (result.type === 'table' && (request.options as { density?: string } | undefined)?.density === undefined && settings.density) {
    Object.assign(result.options, { density: settings.density === 'compact' ? 'compact' : 'regular' });
  }
  const theme = themeForDensity(result.theme, settings.density === 'compact' ? 'compact' : 'comfortable');
  return theme === result.theme ? result : { ...result, theme };
}
