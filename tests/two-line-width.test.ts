/** twoLineWidth follows wrapText: the width it returns holds the text on two lines, and half a pixel less does not. */
import { describe, expect, it } from 'vitest';
import { defaultMeasurer as measure, twoLineWidth, wrapText } from '../src/core/text';

const font = { family: 'Helvetica', size: 10.5, weight: 400 };

describe('twoLineWidth', () => {
  it('breaks where wrapText breaks: spaces, tabs and an explicit newline', () => {
    for (const text of ['Machine setup errors on the press line', 'Machine\tsetup errors on the press line', 'Late\nsupplier deliveries']) {
      const width = twoLineWidth(text, font, measure);
      expect(wrapText(text, font, width, 2, measure).truncated, text).toBe(false);
      expect(wrapText(text, font, width - 0.5, 2, measure).truncated, text).toBe(true);
    }
  });
});
