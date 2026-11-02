import './helpers/link-core';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { layoutWithStaticFooter } from '../src/core/staticFooter';
import { solveFrame, type FrameInput } from '../src/core/frame';
import { boldMeasurer, hasBold, markBold, plainText, splitBoldLines } from '../src/core/inlineBold';
import { createOccupiedIndex } from '../src/core/label/occupied';
import { chartNotes } from '../src/core/notes';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import { defaultMeasurer, type TextMeasurer } from '../src/core/text';
import { emphasisWeight, resolveTheme } from '../src/core/theme';
import type { Geometry, SceneNode } from '../src/core/types/scene';
import { ChartFooter } from '../src/react/ChartFooter';
import { SceneRenderer } from '../src/react/SceneRenderer';

type TextNode = Extract<SceneNode, { t: 'text' }>;
const textNodes = (nodes: SceneNode[]) => nodes.filter((node): node is TextNode => node.t === 'text');
const frame = (options: Partial<FrameInput>) => solveFrame({
  size: { width: 320, height: 800 }, margin: { top: 20, right: 20, bottom: 20, left: 20 },
  theme: resolveTheme(), measure: defaultMeasurer, ...options,
}, createOccupiedIndex({ x: 0, y: 0, w: 320, h: 800 }));
const data = { categories: ['2022', '2023', '2024'], series: [{ id: 'a', label: 'Revenue', values: [10, 12, 15] }] };

// A wrapped title or mixed-weight subtitle must keep every word and measure bold text at its drawn weight.
it('wraps titles and subtitles into plain lines with the correct bold runs and widths', () => {
  const theme = structuredClone(resolveTheme());
  theme.type.title.weight = 400;
  const calls: { text: string; weight: number }[] = [];
  const measure: TextMeasurer = (text, font) => {
    calls.push({ text, weight: font.weight });
    return { width: text.length * (font.weight === emphasisWeight(theme) ? 12 : 6), height: font.size * 1.3, ascent: font.size * 0.8 };
  };
  const title = 'Revenue grows **40%** across northern markets since 2022';
  const result = frame({ theme, measure, title, subtitle: {
    company: 'Acme (**International**) group', measure: 'Net **revenue** by division', period: 'FY2022 to **FY2024**',
  } });
  const nodes = textNodes(result.nodes);
  const drawnTitle = nodes.find(node => node.part === 'title')!;
  const subtitle = nodes.filter(node => node.part === 'subtitle');
  expect(drawnTitle.lines.length).toBeGreaterThan(1);
  expect(drawnTitle.lines.join(' ')).toBe(plainText(title));
  expect(drawnTitle.lineRuns?.flat().find(run => run.text === '40%')?.weight).toBe(emphasisWeight(theme));
  expect(subtitle.length).toBeGreaterThan(1);
  expect(subtitle.flatMap(node => node.runs ?? []).filter(run => run.weight).map(run => run.text).join(' ')).toContain('International');
  expect(subtitle.flatMap(node => node.runs ?? []).find(run => run.text.includes('Net revenue'))?.weight).toBe(emphasisWeight(theme));
  expect(subtitle.flatMap(node => node.runs ?? []).find(run => run.text.includes('FY2024'))?.weight).toBe(emphasisWeight(theme));
  for (const node of [drawnTitle, ...subtitle]) {
    const lines = node.lineRuns ?? [node.runs!];
    expect(lines.map(runs => runs.map(run => run.text).join(''))).toEqual(node.lines);
    expect(node.lines.join(' ')).not.toMatch(/\*\*|[\uE000\uE001]/);
  }
  expect(calls).toContainEqual({ text: '40%', weight: emphasisWeight(theme) });
  expect(calls).not.toContainEqual({ text: '40%', weight: 400 });
  expect(calls.some(call => /[\uE000\uE001]/.test(call.text))).toBe(false);
  const font = { size: 20, weight: 400, letterSpacing: 1 };
  expect(boldMeasurer(measure, 700)(markBold('A **40%**'), font).width).toBe(measure('A ', font).width + measure('40%', { ...font, weight: 700 }).width + 1);
  expect(boldMeasurer(measure, 700)('40%\uE001', font).width).toBe(measure('40%', { ...font, weight: 700 }).width);
  expect(boldMeasurer(measure, 700)('\uE00040%', font).width).toBe(measure('40%', { ...font, weight: 700 }).width);
  const defaultTitle = textNodes(frame({ title: 'Growth is **40%**' }).nodes).find(node => node.part === 'title')!;
  expect(defaultTitle.lines).toEqual(['Growth is 40%']);
  expect(defaultTitle.lineRuns).toBeUndefined();
});

// Notes and sources must draw bold in SVG and HTML while exports retain the full authored text.
it('draws bold footnotes and source in SVG and React without changing stored notes', () => {
  const title = 'Revenue grows **40%** since 2022';
  const footnotes = ['*Excludes M&A', 'Restated, **audited** figures', '**ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ**'];
  const source = 'Source: **Acme** annual report';
  const spec = { type: 'column', data, options: { title, footnotes, source, size: { width: 320 } } };
  const theme = resolveTheme();
  const weight = emphasisWeight(theme);
  const output = render({ spec, format: 'svg', return: ['svg', 'reading'] }).body as { svg: string; reading: { title: string; notes: { text: string }[]; omissions: { labelId: string }[] } };
  expect(output.svg).toContain(`font-weight="${weight}">audited</tspan>`);
  expect(output.svg).toContain(`font-weight="${weight}">Acme</tspan>`);
  expect(output.svg).toContain('*Excludes M&amp;A');
  expect(output.svg).not.toMatch(/\*\*|[\uE000\uE001]/);
  expect(output.reading.title).toBe(title);
  expect(output.reading.notes.map(note => note.text)).toEqual(expect.arrayContaining([...footnotes, source]));
  expect(output.reading.omissions.some(item => item.labelId === 'frame:source' || item.labelId.includes('title'))).toBe(false);
  const request = resolveChartRequest(spec as never);
  const geometry = layoutWithStaticFooter(() => layoutResolvedRequest(request), data, spec.options, 'column') as Geometry;
  expect(geometry.refused).not.toBe(true);
  const notes = chartNotes(geometry);
  for (const asDrawn of [false, true]) {
    const html = renderToStaticMarkup(<ChartFooter geometry={geometry} notes={notes} theme={theme} asDrawn={asDrawn} />);
    expect(html).toContain(`<strong style="font-weight:${weight}">audited</strong>`);
    expect(html).toContain(`<strong style="font-weight:${weight}">Acme</strong>`);
    expect(html).not.toMatch(/\*\*|[\uE000\uE001]/);
  }
  const reactSvg = renderToStaticMarkup(<SceneRenderer geometry={geometry} theme={theme} />);
  expect(reactSvg).toContain(`font-weight="${weight}">audited</tspan>`);
  expect(reactSvg).not.toMatch(/\*\*|[\uE000\uE001]/);
  const longNote = textNodes(geometry.scene).find(node => node.lines.join('').includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))!;
  expect(longNote.lines.length).toBeGreaterThan(1);
  expect(longNote.lines.join('').replace(/^\d+\)\s*/, '')).toBe(plainText(footnotes[2]!));
  expect(longNote.lineRuns?.every(runs => runs.some(run => run.weight === weight))).toBe(true);
});

// Significance marks, unmatched delimiters and ordinary text must retain their literal characters and original scene shape.
it('keeps text without a valid pair unchanged', () => {
  const literals = ['Revenue grows 40% since 2022', 'p<0.05**', '** p<0.01', '*** p<0.001', '*Excludes M&A', '**unmatched', '**across\nlines**', 'a**word**', '**word**2'];
  for (const text of literals) {
    expect(hasBold(text)).toBe(false);
    expect(markBold(text)).toBe(text);
    expect(plainText(text)).toBe(text);
    const lines = [text];
    expect(splitBoldLines(lines, 700, 400)).toEqual({ lines });
    expect(splitBoldLines(lines, 700, 400).lines).toBe(lines);
  }
  expect(plainText('(**word**)')).toBe('(word)');
  const options = { title: 'Revenue grows 40% since 2022', subtitle: { measure: 'Net revenue' }, footnotes: ['** p<0.01', '*Excludes M&A'], source: 'Annual report' };
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options } as never)) as Geometry;
  expect(textNodes(geometry.scene).every(node => node.lineRuns === undefined)).toBe(true);
  const svg = renderSvg(geometry, resolveTheme());
  expect(svg).toContain('** p&lt;0.01');
  expect(svg).toContain('*Excludes M&amp;A');
});
