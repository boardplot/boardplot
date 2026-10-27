/** Zod-free sankey chart registration. */

import type { ChartCore } from '../../registry';
import { CARD_MIN_WIDTH, chartSizing } from '../../sizing';
import { layoutSankey, sankeyDefaultStrings } from './layout';
import type { SankeyData, SankeyDerived, SankeyMarks, SankeyOptions } from './types';

export const sankeyCore: ChartCore<SankeyData, SankeyOptions, SankeyMarks, SankeyDerived> = {
  type: 'sankey',
  // No compact floor: the layout measures its own floor from the column gaps its labels need,
  // and sets a narrow chart's labels inside the plot before it asks for more width.
  sizing: { ...chartSizing('sankey'), compactFloor: undefined, minWidth: CARD_MIN_WIDTH },
  title: 'Sankey',
  summary: 'Flows from sources to targets in stages (channel to page to purchase, budget to departments, segment moves month to month): rows of source, target and value; node height and ribbon width are the flow. Deterministic crossing reduction, links coloured by source or target, small nodes folded into Other, stage-qualified nodes for repeat visits',
  layout: (data, options) => layoutSankey(data, options),
  defaultStrings: sankeyDefaultStrings,
  // Every node must stay identifiable: the note of names that do not fit lists them all.
  defaults: { notes: { maxListed: 'all' } },
  annotationKinds: [],
};
