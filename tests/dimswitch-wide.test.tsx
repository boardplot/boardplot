// @vitest-environment jsdom
/** The work and DOM of a 27 x 287-day dimswitch follow the periods drawn, not the periods in the data (counts, invented data). */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { DimSwitchChart } from '../src/react/DimSwitchChart';
import { defaultMeasurer, type TextMeasurer } from '../src/core/text';
import type { DimSwitchData } from '../src/core/charts/dimswitch/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 27 measures (counts, money, unit values) by `days` day periods, a Total and five channel members. */
function days(count: number): DimSwitchData {
  const members = [{ id: 'paid', label: 'Paid' }, { id: 's1', label: 'Search A', parentId: 'paid' }, { id: 's2', label: 'Search B', parentId: 'paid' }, { id: 'social', label: 'Social' }, { id: 'organic', label: 'Organic' }];
  const measures = Array.from({ length: 27 }, (_, i) => i % 3 === 0
    ? { id: `m${i}`, scale: 'count' as const, label: `Count measure ${i}`, value: { field: `f${i}` } }
    : { id: `m${i}`, scale: (i % 3 === 1 ? 'money' : 'perUnit') as 'money' | 'perUnit', label: `Money measure ${i}`, value: { field: `f${i}` }, format: '$1.2', unit: '$' });
  const start = Date.UTC(2026, 0, 1);
  const periods = [{ id: 'range', label: 'Range', kind: 'range' as const }, { id: 'prior', label: 'Prior', kind: 'prior' as const },
    ...Array.from({ length: count }, (_, i) => ({ id: `d${i}`, label: new Date(start + i * 86_400_000).toISOString().slice(5, 10) }))];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const facts = ['total', ...members.map((m) => m.id)].flatMap((memberId) => periods.map((p) => {
    const sums: Record<string, number> = {}, ref: Record<string, number> = {};
    for (const m of measures) { const base = 100 + random() * 900; sums[m.value.field] = Math.round(base); ref[m.value.field] = Math.round(base * 0.9); }
    return { memberId, periodId: p.id, sums, ref };
  }));
  return { dimension: { label: 'Channel', total: { id: 'total', label: 'Total' }, members, headline: ['m0', 'm1', 'm2'] }, measures, periods, facts } as DimSwitchData;
}

const options = { title: 'Daily performance', variant: 'by-measure', depth: 2, show: 'always' } as const;

/** The text measurements one static layout takes: the work grows with the cells laid out. */
function measured(data: DimSwitchData, size?: { width: number }) {
  let calls = 0;
  const counting: TextMeasurer = Object.assign((text: string, font: Parameters<TextMeasurer>[1]) => { calls++; return defaultMeasurer(text, font); }, { capHeight: defaultMeasurer.capHeight });
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'dimswitch', data, target: 'report', options: { ...options, notes: { show: ['note', 'disclosure'] }, ...(size ? { size } : {}), measure: counting } } as never)) as any;
  const notes = geometry.scene.filter((node: any) => node.t === 'text').map((node: any) => node.lines.join(' ')).filter((text: string) => text.includes('not shown'));
  const periods: string[] = geometry.marks.columns.filter((column: any) => /^d\d+$/.test(column.id)).map((column: any) => column.id);
  return { calls, width: geometry.size.width as number, periods, notes: notes as string[] };
}

// jsdom builds a grid slowly (about 3 s for 287 periods, 60 s timeout on CI): 120 periods are still far wider than the ~35 columns near the viewport.
const WIDE = 120, FEW = 48, LAST = '04-30', MIDDLE = '04-01';

describe('dimswitch with many periods', () => {
  it('lays out 287 day periods with about the work of 32 at 1216 px', () => {
    // Different values need different widths, so compare the same tail values in both inputs.
    const data = days(287), periods = [...data.periods.slice(0, 2), ...data.periods.slice(-32)];
    const ids = new Set(periods.map(period => period.id));
    const tail = { ...data, periods, facts: data.facts.filter(fact => ids.has(fact.periodId)) };
    const many = measured(data, { width: 1216 }), few = measured(tail, { width: 1216 });
    expect(many.periods).toEqual(few.periods);
    expect(many.periods.at(-1)).toBe('d286');
    expect(many.calls).toBeLessThan(few.calls * 1.5);
    expect(many.notes).toHaveLength(1);
    expect(many.notes[0]).toBe(`01-01, 01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, and ${287 - many.periods.length - 8} more not shown at this width.`);
  });

  it('builds the scrolling React grid for the columns near its viewport, and every period stays reachable', async () => {
    // jsdom has no layout: the scroll box is 1216 px wide and keeps the scroll offset it is given.
    const proto = HTMLElement.prototype, lefts = new WeakMap<HTMLElement, number>();
    const saved = ['clientWidth', 'scrollLeft'].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('bp-scroll') ? 1216 : 0; } });
    Object.defineProperty(proto, 'scrollLeft', { configurable: true, get(this: HTMLElement) { return lefts.get(this) ?? 0; }, set(this: HTMLElement, value: number) { lefts.set(this, value); } });
    try {
      const draw = async (data: DimSwitchData, scrollTo?: number, rtl = false, print = false) => {
        const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
        act(() => root.render(<DimSwitchChart data={data} {...options} size={{ width: 1216 }} />));
        if (scrollTo !== undefined) {
          const scroller = host.querySelector<HTMLElement>('.bp-scroll')!;
          // jsdom does not inherit direction into computed style: the scroll box itself is set right to left.
          if (rtl) scroller.style.direction = 'rtl';
          scroller.scrollLeft = scrollTo;
          await act(async () => { scroller.dispatchEvent(new Event('scroll')); await new Promise((resolve) => setTimeout(resolve, 50)); });
        }
        const drawnHeads = () => Array.from(host.querySelectorAll('.bp-columns [role="columnheader"]:not([data-bp-lite])')).map((head) => head.textContent ?? '');
        const count = host.querySelectorAll('*:not([data-bp-lite]):not([data-bp-lite] *)').length;
        const heads = drawnHeads();
        const allText = host.textContent ?? '';
        const colcount = host.querySelector('.bp-table-grid')!.getAttribute('aria-colcount');
        // Print draws every column.
        let printed = 0;
        if (print) { act(() => { window.dispatchEvent(new Event('beforeprint')); }); printed = drawnHeads().length; act(() => { window.dispatchEvent(new Event('afterprint')); }); }
        act(() => root.unmount()); host.remove();
        return { count, heads, colcount, allText, printed };
      };
      const many = await draw(days(WIDE)), few = await draw(days(FEW), undefined, false, true);
      // The drawn DOM follows the viewport, not the periods in the data; the table still names all 290 columns.
      expect(many.count).toBe(few.count);
      expect(many.colcount).toBe(String(WIDE + 3));
      expect(many.heads.length).toBeLessThan(40);
      expect(many.heads.slice(0, 3)).toEqual(['KPI', 'RANGE', 'PRIOR']);
      // Every cell's text stays in the page as light text, for find in page and screen readers; print draws all.
      expect(many.allText).toContain(MIDDLE);
      expect(few.printed).toBe(FEW + 3);
      // Scrolled to the end, the latest period is built, with the pinned label and Range block; under RTL too.
      for (const end of [await draw(days(WIDE), WIDE * 94), await draw(days(WIDE), -WIDE * 94, true)]) {
        expect(end.heads.slice(0, 3)).toEqual(['KPI', 'RANGE', 'PRIOR']);
        expect(end.heads.at(-1)).toBe(LAST);
        expect(end.count).toBeLessThan(many.count * 1.5);
      }

      // In a container, the table waits for its width and fits and measures its cells once, not first at the fallback
      // width's type and then again (the measure calls of a fixed 1216 px mount, within 10 %).
      const measures = (container: boolean) => {
        let calls = 0;
        const counting: TextMeasurer = Object.assign((text: string, font: Parameters<TextMeasurer>[1]) => { calls++; return defaultMeasurer(text, font); }, { capHeight: defaultMeasurer.capHeight });
        const observed: { target: Element; report: ResizeObserverCallback }[] = [];
        const globals = globalThis as typeof globalThis & { ResizeObserver?: unknown };
        const savedObserver = globals.ResizeObserver, savedFrame = globalThis.requestAnimationFrame;
        globals.ResizeObserver = class {
          constructor(private readonly report: ResizeObserverCallback) {}
          observe(target: Element) { observed.push({ target, report: this.report }); }
          unobserve() { /* the hook only disconnects */ }
          disconnect() { /* nothing to release */ }
        } as unknown as typeof ResizeObserver;
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 1; }) as typeof requestAnimationFrame;
        const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
        try {
          act(() => root.render(<DimSwitchChart data={days(WIDE)} {...options} fontMetrics={counting} {...(container ? { size: 'container' as const, fillHeight: true } : { size: { width: 1216 } })} />));
          act(() => { for (const { target, report } of observed) report([{ target, contentRect: { width: 1216, height: 800 } } as unknown as ResizeObserverEntry], {} as ResizeObserver); });
          return { calls, built: host.querySelectorAll('[role="row"]').length };
        } finally {
          act(() => root.unmount()); host.remove();
          globals.ResizeObserver = savedObserver; globalThis.requestAnimationFrame = savedFrame;
        }
      };
      const fixed = measures(false), contained = measures(true);
      expect(contained.built).toBe(fixed.built);
      expect(contained.calls).toBeLessThan(fixed.calls * 1.1);
    } finally {
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(proto, key, descriptor); else delete (proto as unknown as Record<string, unknown>)[key]; }
    }
    // jsdom builds each wide grid in seconds; the case draws six.
  }, 60_000);
});
