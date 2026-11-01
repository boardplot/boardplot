import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures } from '../src/fixtures';

// A creative card was refused with "size-below-floor" at a full and a half slide canvas (888 × 396 pt and
// 432 × 396 pt), although its content fits once it takes three columns or moves its method lines to frame.notes.
const { data, options } = getFixtures('creative').find((entry) => entry.id === 'creative-image-fatigue')!;
const draw = (width: string, height: string) => render({ spec: { type: 'creative', data, options }, format: 'svg', target: 'slide', width, height }).body as any;

describe('creative card on a short slide canvas', () => {
  it('draws the full slide in three columns with every label', () => {
    const body = draw('888pt', '396pt');
    expect(body.ok).toBe(true);
    expect(body.warnings.filter((warning: any) => warning.code === 'label-hidden')).toEqual([]);
    expect(body.reading.omissions ?? []).toEqual([]);
  });

  it('draws the half slide with its method lines in the notes', () => {
    const body = draw('432pt', '396pt');
    expect(body.ok).toBe(true);
    expect(body.warnings.filter((warning: any) => warning.code === 'label-hidden')).toEqual([]);
    expect(body.notes.some((note: any) => note.kind === 'method')).toBe(true);
  });

  // A narrower fallback column can overflow its text; that threw creative-text-overflow where main returns a size refusal with a repair.
  it('refuses with a size repair when a fallback column overflows its text', () => {
    const body = render({ spec: { type: 'creative', data, options: { ...options, textScale: 1.5 } }, format: 'svg', target: 'slide', width: '900', height: '800' }).body as any;
    expect(body.errors.map((error: any) => error.code)).toEqual(['size-below-floor']);
  });

  it('keeps the two-column form where it fits', () => {
    const body = draw('720pt', '560pt');
    expect(body.ok).toBe(true);
    expect(body.notes.some((note: any) => note.kind === 'method')).toBe(false);
  });
});
