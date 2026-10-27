// @vitest-environment jsdom
import { act } from 'react';
import { contrastRatio } from '../src/core/color';
import { resolveTheme } from '../src/core/theme';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { BoardplotTheme, useBoardplotTheme, type BoardplotThemeProps } from '../src/react/BoardplotTheme';
import { useResolvedChartLayout } from '../src/react/useResolvedChartLayout';
import { ColumnChart } from '../src/react/charts/column';
import { LineChart } from '../src/react/charts/line';
import { TableChart } from '../src/react/TableChart';
import * as tableResolver from '../src/core/charts/table/resolve';
import { boardplotThemeOptionsSchema } from '../src/core/schema/react';
import fixture from './fixtures/theme-provider.json';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mounted() {
  const container = document.createElement('div');
  const root = createRoot(container);
  return { container, render: (node: React.ReactNode) => act(() => root.render(node)), close: () => act(() => root.unmount()) };
}

describe('BoardplotTheme', () => {
  // Applying or removing an authored size equal to a default must update a mounted chart exactly as a fresh mount does.
  it('relayouts authored font sizes like a fresh mount with and without a provider', () => {
    const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 's', values: [40, 25] }] };
    for (const provider of [false, true]) {
      const view = mounted();
      const onGeometry = vi.fn();
      const chart = (size: number | undefined, callback: typeof onGeometry) => {
        const theme: BoardplotThemeProps['theme'] = size === undefined ? 'boardroom'
          : { preset: 'boardroom', overrides: { type: { footnote: { size } } } };
        const column = <ColumnChart data={data} size={{ width: 900, height: 600 }} target="dashboard"
          source="Invented data" theme={provider ? undefined : theme} onGeometry={callback} />;
        return provider ? <BoardplotTheme theme={theme}>{column}</BoardplotTheme> : column;
      };
      try {
        for (const [index, size] of [undefined, 12, 13, 12, undefined].entries()) {
          const fresh = mounted();
          const freshGeometry = vi.fn();
          try {
            view.render(chart(size, onGeometry));
            fresh.render(chart(size, freshGeometry));
            expect(onGeometry, `provider=${provider}, size=${size}`).toHaveBeenCalledTimes(index + 1);
            expect(freshGeometry).toHaveBeenCalledTimes(1);
            expect(onGeometry.mock.lastCall![0].scene).toEqual(freshGeometry.mock.lastCall![0].scene);
            view.render(chart(size, onGeometry));
            expect(onGeometry).toHaveBeenCalledTimes(index + 1);
          } finally { fresh.close(); }
        }
      } finally { view.close(); }
    }
  });

  it('updates mounted line widths and dashes when provider tokens change', () => {
    const view = mounted();
    const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 's', values: [1, 2], scenario: 'FC' as const, lineStyle: 'dashed' as const }] };
    const render = (width: number, dash: number[]) => view.render(<BoardplotTheme theme={{ preset: 'boardroom', overrides: { stroke: { data: width }, dash: { reference: dash } } }}>
      <LineChart data={data} />
    </BoardplotTheme>);
    const line = () => view.container.querySelector('path[data-part="line"]')!;
    try {
      render(2, [2, 3]);
      expect(line().getAttribute('stroke-width')).toBe('2');
      expect(line().getAttribute('stroke-dasharray')).toBe('2 3');
      render(6, [2, 3]);
      expect(line().getAttribute('stroke-width')).toBe('6');
      render(6, [6, 3]);
      expect(line().getAttribute('stroke-width')).toBe('6');
      expect(line().getAttribute('stroke-dasharray')).toBe('6 3');
    } finally { view.close(); }
  });

  // A provider switch of a baked label ink or grid dash once only repainted, so the old ink and dash stayed until a relayout.
  it('relayouts when the provider switches labels.ink or valueAxis.gridDash', () => {
    const view = mounted();
    const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 's', values: [10, 20] }] };
    const render = (ink: 'ink' | 'muted', gridDash: 'solid' | 'dotted') => view.render(<BoardplotTheme theme={{ preset: 'boardroom', overrides: { labels: { ink }, valueAxis: { gridDash } } }}>
      <ColumnChart data={data} valueAxis={{ show: true, gridlines: true }} />
    </BoardplotTheme>);
    const snapshot = () => view.container.innerHTML;
    try {
      render('ink', 'solid');
      const before = snapshot();
      render('muted', 'solid');
      const muted = snapshot();
      expect(muted).not.toBe(before);
      render('muted', 'dotted');
      expect(snapshot()).not.toBe(muted);
    } finally { view.close(); }
  });

  // A provider switch of theme.marks (markers, carets, bar label side) only repainted, so the old marks stayed.
  it('relayouts when the provider switches a theme.marks key', () => {
    const view = mounted();
    const data = { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], series: [{ id: 's', values: [1, 3, 2] }] };
    const render = (lineMarkers: 'auto' | 'none') => view.render(<BoardplotTheme theme={{ preset: 'boardroom', overrides: { marks: { lineMarkers } } }}>
      <LineChart data={data} />
    </BoardplotTheme>);
    try {
      render('auto');
      const before = view.container.innerHTML;
      render('none');
      expect(view.container.innerHTML).not.toBe(before);
    } finally { view.close(); }
  });

  it('inherits settings, merges nested strings and gives direct chart props precedence', () => {
    const settings: ReturnType<typeof useBoardplotTheme>[] = [];
    const requests: ReturnType<typeof useResolvedChartLayout>[] = [];
    function Probe({ direct = false }) {
      settings.push(useBoardplotTheme());
      requests.push(useResolvedChartLayout({ ...fixture.chart, ...(direct ? { theme: 'capital', locale: 'fr' } : {}) }));
      return null;
    }
    renderToStaticMarkup(<BoardplotTheme {...fixture.provider as BoardplotThemeProps}>
      <Probe />
      <BoardplotTheme theme="studio" direction="ltr" strings={{ total: 'Sum', others: undefined }}><Probe direct /></BoardplotTheme>
    </BoardplotTheme>);
    expect(settings[0]).toMatchObject(fixture.provider);
    expect(settings[1]!.direction).toBe('ltr');
    expect(settings[1]!.strings).toEqual({ ...fixture.provider.strings, total: 'Sum' });
    expect(requests[0]!.request.theme.name).toBe('standard');
    expect(requests[1]!.request.theme.name).toBe('capital');
    // The resolved tag carries the chart's number marks (numberMarks.ts).
    expect(requests[1]!.request.locale?.language).toBe('fr-x-marks-pc');
    expect(boardplotThemeOptionsSchema.safeParse(fixture.provider).success).toBe(true);
    expect(boardplotThemeOptionsSchema.safeParse({ motion: 'bounce' }).success).toBe(false);
    expect(boardplotThemeOptionsSchema.safeParse({ direction: 'sideways' }).success).toBe(false);
  });

  it('changes local CSS variables while retaining SVG elements and authored colours', () => {
    const view = mounted();
    const data = { categories: [{ id: 'a' }], series: [{ id: 's', values: [{ number: 4, fill: '#123456' }] }] };
    try {
      const render = (theme: string) => view.render(<BoardplotTheme theme={theme}><ColumnChart data={data} /></BoardplotTheme>);
      render('standard');
      const svg = view.container.querySelector('svg')!;
      const variables = svg.getAttribute('style');
      expect(variables).toContain('--bp-paint-');
      expect(view.container.innerHTML).toContain('#123456');
      render('standard-dark');
      expect(view.container.querySelector('svg')).toBe(svg);
      expect(svg.getAttribute('style')).not.toBe(variables);
      expect(view.container.innerHTML).toContain('#123456');
    } finally { view.close(); }
  });

  it('isolates table themes and skips cell resolution for colour-only changes', () => {
    const view = mounted();
    const resolve = vi.spyOn(tableResolver, 'resolveTable');
    const data = { columns: [{ id: 'name', kind: 'rowLabel' as const }, { id: 'n', kind: 'value' as const }], rows: [{ id: 'a', cells: { name: 'A', n: 12.5 } }] };
    const render = (theme: string) => view.render(<BoardplotTheme theme={theme} locale="de" density="compact">
      <TableChart data={data} /><TableChart data={data} theme="capital" density="relaxed" />
    </BoardplotTheme>);
    try {
      render('standard');
      const before = resolve.mock.calls.length;
      const scopes = Array.from(view.container.querySelectorAll('figure')).map(node => node.getAttribute('data-bp-table-theme'));
      expect(scopes[0]).not.toBe(scopes[1]);
      expect(resolve.mock.calls[0]![1]).toMatchObject({ density: 'compact', locale: { language: 'de-x-marks-pc' } });
      expect(resolve.mock.calls[1]![1]).toMatchObject({ density: 'relaxed' });
      render('standard-dark');
      expect(resolve).toHaveBeenCalledTimes(before);
      const styles = Array.from(document.querySelectorAll('style[data-bp-table-theme]')).map(node => node.textContent).join('');
      expect(styles).toContain(`.bp-table[data-bp-table-theme="${scopes[1]}"]`);
    } finally { view.close(); resolve.mockRestore(); }
  });
});

// A provider repaint must update both the figure ink and the note ink on a mid-tone heat cell.
it('keeps heat figures and notes readable through a provider repaint', () => {
  const view = mounted();
  const data = { columns: [{ id: 'l', kind: 'rowLabel' as const }, { id: 'v', kind: 'value' as const, noteLine: true }], rows: [0, 1, 2, 3, 4].map(i => ({ id: `r${i}`, label: `Group ${i}`, cells: { v: { v: 10 + i, note: 'Estimate' } } })) };
  const encodings = { v: { type: 'heat' as const, steps: 5 } };
  try {
    for (const preset of ['standard', 'standard-dark', 'standard']) {
      view.render(<BoardplotTheme theme={preset}><TableChart data={data} encodings={encodings} size={{ width: 480 }} /></BoardplotTheme>);
      const cell = view.container.querySelector<HTMLElement>('[data-bp-mark="r3:v"]')!;
      const ground = cell.style.backgroundImage.match(/linear-gradient\((rgba?\([^)]+\)|#[a-f\d]+)/i)![1]!;
      const theme = resolveTheme(preset);
      for (const ink of [cell.style.color || theme.color.ink, cell.style.getPropertyValue('--bp-ink-muted') || theme.color.inkMuted]) {
        expect(contrastRatio(ink, ground), preset).toBeGreaterThanOrEqual(4.5);
      }
    }
  } finally { view.close(); }
});
