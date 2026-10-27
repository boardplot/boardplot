import { chartSizing } from '../../sizing';
/** Zod-free likert chart registration. */

import type { ChartCore } from '../../registry';
import {
  layoutLikert,
  type LikertData,
  type LikertDerived,
  type LikertMarks,
  type LikertOptions,
} from './layout';

export const likertCore: ChartCore<
  LikertData,
  LikertOptions,
  LikertMarks,
  LikertDerived
> = {
  type: 'likert',
  sizing: chartSizing('likert'),
  title: 'Likert (diverging survey)',
  summary:
    'Agreement across statements as a diverging stacked bar centred on the declared neutral midpoint — shares, sign, segment order and net score all derived, and the neutral convention stated rather than assumed',
  aliases: ['diverging-stacked'],
  layout: layoutLikert,
  defaults: { neutral: 'split', summary: 'net', sortBy: 'sheet' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout']
};
