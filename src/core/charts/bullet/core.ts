import { CARD_MIN_WIDTH, chartSizing } from '../../sizing';
/** Zod-free bullet chart registration. */

import type { ChartCore } from '../../registry';
import type { BulletData } from '../../types/data';
import type { BulletOptions } from '../../types/options';
import { layoutBullet, type BulletDerived, type BulletMarks } from './layout';

export const bulletCore: ChartCore<BulletData, BulletOptions, BulletMarks, BulletDerived> = {
  type: 'bullet',
  // The percent-of-target rows stack down to a 320 px card; the other bullet
  // layouts report their own 480 px floor (layout.ts).
  sizing: { ...chartSizing('bullet'), minWidth: CARD_MIN_WIDTH },
  title: 'Bullet (KPI rows)',
  summary: 'Bullet-graph KPI rows — qualitative bands, dark measure bar, target tick, delta vs target',
  layout: layoutBullet,
  defaults: {},
  annotationKinds: ['callout', 'note', 'delta', 'abs', 'diff', 'cagr', 'valueLine', 'band']
};
