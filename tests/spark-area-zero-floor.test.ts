/**
 * An area spark encodes each value as a filled height. A floor at the
 * series minimum drew the first point with no height, so a rise of 50%
 * read as growth from nothing. Its floor is zero; a line keeps min-max.
 */
import { describe, expect, it } from 'vitest';
import { sparklineDomain } from '../src/core/charts/sparkline/layout';

describe('area spark domain', () => {
  const rise = [121, 150, 182];
  it('starts an area spark at zero and keeps a line spark on its min-max range', () => {
    expect(sparklineDomain([rise], 'area')).toEqual({ min: 0, max: 182 });
    expect(sparklineDomain([rise], 'line')).toEqual({ min: 121, max: 182 });
  });
});
