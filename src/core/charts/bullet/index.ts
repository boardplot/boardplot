/** Bullet chart registration (KPI rows). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { BulletData } from '../../types/data';
import type { BulletOptions } from '../../types/options';
import type { BulletDerived, BulletMarks } from './layout';
import { bulletCore } from './core';
import { COMPACT_BULLET_REFUSALS } from './refusals';
import { bulletDataSchema, bulletOptionsSchema } from './schema';

export { bulletDataSchema, bulletOptionsSchema };

export const bulletDefinition: ChartDefinition<BulletData, BulletOptions, BulletMarks, BulletDerived> = {
  ...bulletCore,
  discovery: {
    example: {
      data: { rows: [{ id: 'orders', label: 'Orders', value: 85, target: 100 }] },
      options: { unit: 'orders', title: 'Orders reach 85 against a target of 100', source: 'Illustrative data' },
    },
    densities: { compact: COMPACT_BULLET_REFUSALS },
  },
  normalize: (raw) => parseData(bulletDataSchema, raw),
  dataSchema: bulletDataSchema,
  optionsSchema: bulletOptionsSchema,
};
