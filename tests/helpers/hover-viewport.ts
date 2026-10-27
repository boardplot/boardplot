import { afterEach, beforeEach, vi } from 'vitest';

// jsdom has no SVG layout. Model the chart at its authored size unless a
// test supplies its own scaled or offset box.
beforeEach(() => {
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: SVGSVGElement) {
    const [, , width = 0, height = 0] = (this.getAttribute('viewBox') ?? '').split(' ').map(Number);
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  });
});
afterEach(() => vi.restoreAllMocks());
