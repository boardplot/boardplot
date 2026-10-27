import type { ChartCore } from '../../registry';
import { creativeSizing, layoutCreative, type CreativeDerived, type CreativeMarks } from './layout';
import type { CreativeData, CreativeOptions } from './types';

export const creativeCore: ChartCore<CreativeData, CreativeOptions, CreativeMarks, CreativeDerived> = {
  type: 'creative', title: 'Creative exhibit',
  summary: 'Early alpha: an ad-creative review card with the creative media, observed metrics, account medians, daily trends and an optional authored fatigue threshold.',
  sizing: creativeSizing, layout: layoutCreative, defaults: {}, annotationKinds: [],
};
