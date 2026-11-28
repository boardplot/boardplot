import { describe, expect, it } from 'vitest';
import { callTool } from '../src/mcp/server';
import { getFixtures } from '../src/fixtures';

// A chart in another language could replace 117 of its built-in words only: any other key (here the waffle's
// own key word) was refused. Every key of the word tables is now accepted, and a misspelt key still names the nearest key.
describe('options.strings takes every built-in word', () => {
  const waffle = getFixtures('waffle')[0]!;
  const render = (strings: Record<string, string>) => JSON.parse(callTool('boardplot_render', {
    spec: { type: 'waffle', data: waffle.data, options: { ...waffle.options, variant: 'square', reference: { categoryId: (waffle.data as { categories: { id: string }[] }).categories[0]!.id, label: 'Headcount' }, strings } }, return: ['svg'],
  }).text) as { ok: boolean; svg?: string; errors: { message: string }[] };

  it('draws the key of a word that the schema does not document', () => {
    const result = render({ referenceKey: 'Gestrichelt = Ziel' });
    expect(result.ok).toBe(true);
    expect(result.svg).toContain('Gestrichelt = Ziel');
  });

  it('refuses a misspelt key with the nearest key as the hint', () => {
    const result = render({ otehrs: 'Andere' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toContain('try: others');
  });
});
