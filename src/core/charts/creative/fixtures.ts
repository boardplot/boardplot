import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { CreativeData, CreativeOptions } from './types';

/** Synthetic observations; no customer data or media. */
export const creativePlaceholderFixture: Fixture<CreativeData, CreativeOptions> = {
  id: 'creative-placeholder',
  title: 'Creative observations with placeholder media',
  kind: 'example', tags: ['interaction'], hover: { owner: { seriesId: 'ctr', categoryId: 'creative-a' } },
  data: {
    id: 'creative-a',
    media: { kind: 'placeholder', aspect: '4:5', alt: 'Placeholder for an ad creative' },
    facts: {
      name: 'Illustrative product demonstration', format: 'Video', currency: 'USD',
      spendToDate: 240, launchDate: '2026-09-01', endDate: null, asOf: '2026-09-03',
    },
    comparison: { startDate: '2026-09-01', endDate: '2026-09-03', population: 'Illustrative account creatives active in this period' },
    definitions: 'Hook rate: 3-second video views per impression. Hold rate: 15-second views per 3-second view.',
    metrics: {
      ctr: { value: 1.8, accountMedian: 1.5 }, cpa: { value: 24, accountMedian: 28 },
      roas: { value: 2.4, accountMedian: 2.1 }, hookRate: { value: 32, accountMedian: 30 },
      holdRate: { value: null, accountMedian: null }, frequency: { value: 1.4, accountMedian: 1.5 },
    },
    observations: [
      { date: '2026-09-01', spend: 60, cpa: 30, ctr: 2.1 },
      { date: '2026-09-02', spend: 80, cpa: 20, ctr: 1.9 },
      { date: '2026-09-03', spend: 100, cpa: 25, ctr: 1.6 },
    ],
  },
  options: { title: 'Creative review', source: 'Illustrative data; no fatigue conclusion' },
};

const syntheticCreativeImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABkCAIAAACemCBBAAAAkElEQVR4nO3PMQ2AMAAAwSpBIguWGVjwgAW2pt9LXsDfuN9nq8b0A2BgYGBgYOBtAq4HXA+4HnA94HrAvzvOa27AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAq4MXDbgecD3gesD1gOsB1wOuB1wPuB5wve3AH0JPkW81weO0AAAAAElFTkSuQmCC';

const creativeImageFixture: Fixture<CreativeData, CreativeOptions> = {
  ...creativePlaceholderFixture,
  id: 'creative-image-fatigue', title: 'Creative image with an explicit CTR screening rule',
  data: {
    ...creativePlaceholderFixture.data,
    media: { kind: 'image', aspect: '4:5', src: syntheticCreativeImage, alt: 'Synthetic teal product silhouette on a pale background' },
    facts: { ...creativePlaceholderFixture.data.facts, asOf: '2026-09-06', spendToDate: 500 },
    observations: [
      { date: '2026-09-01', spend: 60, cpa: 20, ctr: 2.2 },
      { date: '2026-09-02', spend: 80, cpa: 22, ctr: 2.0 },
      { date: '2026-09-03', spend: 100, cpa: 21, ctr: 1.8 },
      { date: '2026-09-04', spend: 80, cpa: 25, ctr: 1.6 },
      { date: '2026-09-05', spend: 80, cpa: 28, ctr: 1.5 },
      { date: '2026-09-06', spend: 100, cpa: 30, ctr: 1.4 },
    ],
    fatigueRule: { metric: 'ctr', direction: 'higherIsBetter',
      baseline: { startDate: '2026-09-01', endDate: '2026-09-03' },
      current: { startDate: '2026-09-04', endDate: '2026-09-06' },
      minObservations: 3, thresholdPct: 20, missingData: 'unavailable' },
  },
  options: { title: 'Creative review', source: 'Synthetic data; screening rule is illustrative' },
};
/**
 * A host card: `footnotes: false` moves the source and the method
 * lines to frame.source and frame.notes, the status line stays, and the
 * trends end in the sparkline ring.
 */
const creativeHostFixture: Fixture<CreativeData, CreativeOptions> = {
  ...creativeImageFixture,
  id: 'creative-host-card',
  title: 'Creative card in a host frame: no method lines, trends ending in a ring',
  options: {
    ...creativeImageFixture.options,
    footnotes: false,
    theme: { preset: 'standard', overrides: { marks: { sparkEnd: 'ring' } } },
  },
};
/** a square video creative, drawn from its poster. */
const creativeVideoFixture: Fixture<CreativeData, CreativeOptions> = {
  ...creativeImageFixture,
  id: 'creative-video-poster',
  title: 'Square video creative drawn from its poster',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    ...creativeImageFixture.data,
    media: { kind: 'video', aspect: '1:1', poster: syntheticCreativeImage, alt: 'Poster frame of a synthetic product video' },
  },
};
registerFixtures('creative', [creativePlaceholderFixture, creativeImageFixture, creativeHostFixture, creativeVideoFixture]);
