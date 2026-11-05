import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';

const drawn = (id: string) => {
  const { data, options } = getFixtures('diagram').find((entry) => entry.id === id)!;
  return render({ spec: { type: 'diagram', data, options } as any, format: 'svg', return: ['svg'] } as any).body as any;
};

describe('customer journey, serpentine flow', () => {
  // The wrapped path swapped the card styling for the older full journey look (dashed tiles, leaders, tall red blocks); it must only change the reading path.
  it('keeps the compact card look of the columns flow', () => {
    const columns = drawn('onboarding-journey');
    const wrapped = drawn('onboarding-journey-serpentine');
    expect(wrapped.svg).not.toContain('diagramJourneyLeader');
    expect(wrapped.svg).not.toContain('stroke-dasharray');
    expect(wrapped.svg.match(/diagramNode/g)!.length).toBe(columns.svg.match(/diagramNode/g)!.length);
  });
});
