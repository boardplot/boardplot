// @vitest-environment jsdom
/**
 * Story stepper (options.story): a step repaints and reweights marks but never
 * moves one; step ids are checked; the React buttons and a controlled `step`
 * move through the steps.
 */
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import { storyView } from '../src/core/story';
import '../src/core/storyLayer';
import type { Geometry, SceneNode } from '../src/core/types/scene';
import { getFixtures } from '../src/fixtures';
import { measure } from '../src/cli/measure';
import { ScatterChart as PlainScatter } from '../src/react/charts/scatter';
import { withStory } from '../src/react/story';
import { StoryFrame } from '../src/react/StoryFrame';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { prepareChart } from '../src/react/prepare';
import { resolveTheme } from '../src/core/theme';
import { render } from '../src/cli/render';
import type { ChartReading } from '../src/core/reading';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fixture = getFixtures('scatter').find(item => item.id === 'story-use-case-matrix')!;
const options = fixture.options as Record<string, unknown> & { story: { steps: { id: string; title: string; highlight?: string[] }[] } };
const layout = (opts: object) => getChart('scatter')!.layout(fixture.data as never, opts as never) as Geometry;

describe('story layout', () => {
  // Story text cut at a line limit must stay in the returned notes and omissions, including inactive steps.
  it('retains the full text of cut story steps in notes and omissions', () => {
    const story = structuredClone(options.story);
    const title = 'An invented long story title '.repeat(16).trim();
    story.steps[1]!.title = title;
    const result = render({ spec: { type: 'scatter', data: fixture.data, options: { ...options, story } }, return: ['reading'] }).body as {
      reading: ChartReading; notes: { text: string }[];
    };
    expect(result.reading.labelsTruncated).toContainEqual(expect.objectContaining({ text: title }));
    expect(result.reading.omissions).toContainEqual(expect.objectContaining({ text: title, reason: 'truncated' }));
    expect(result.notes.some(note => note.text.includes(title))).toBe(true);
    const shown = render({ spec: { type: 'scatter', data: fixture.data,
      options: { ...options, story, notes: { show: ['disclosure'], maxListed: 'all' } } }, return: ['reading'] }).body as {
        reading: ChartReading; notes: { text: string; inFrame: boolean }[];
      };
    expect(shown.reading.size).toEqual(result.reading.size);
    expect(shown.reading.labelsTruncated.map(label => label.labelId)).toEqual(result.reading.labelsTruncated.map(label => label.labelId));
  });
  it('keeps every mark in place across all steps', () => {
    const geo = layout(options);
    expect(geo.story!.steps.length).toBe(6);
    const shape = (node: SceneNode) => { const { opacity: _o, ...rest } = node as SceneNode & { opacity?: number }; return rest.t === 'text' ? { ...rest, font: { ...rest.font, weight: 0 } } : rest; };
    const marks = (index: number) => storyView(geo, index, true).scene.filter(node => !node.id.startsWith('story:')).map(shape);
    const first = marks(0);
    for (let index = 1; index < 6; index++) expect(marks(index)).toEqual(first);
    // ...and a focus step does change the paint.
    expect(storyView(geo, 1, true).scene.some(node => (node as { opacity?: number }).opacity !== undefined)).toBe(true);
  });

  it('refuses an unknown highlight id and an unknown start step', () => {
    const steps = options.story.steps.map((step, at) => (at === 1 ? { ...step, highlight: ['no-such-point'] } : step));
    const bad = layout({ ...options, story: { steps } });
    expect(bad.warnings.find(entry => entry.code === 'story-unknown-id')).toMatchObject({ severity: 'error', field: ['options', 'story', 'steps', 1, 'highlight'] });
    const badStep = layout({ ...options, story: { ...options.story, step: 'nope' } });
    expect(badStep.warnings.some(entry => entry.code === 'story-unknown-step' && entry.severity === 'error')).toBe(true);
  });

  it('warns once per cut field at the chosen panel width and keeps the full text', () => {
    const title = Array(5).fill('Title').join('\n');
    const body = Array(11).fill('Body').join('\n');
    const geo = layout({ ...options, story: { steps: [{ id: 'long', title, body }] } });
    expect(geo.warnings.filter(entry => entry.code === 'story-text-truncated')).toEqual([
      expect.objectContaining({ severity: 'warn', field: ['options', 'story', 'steps', 0, 'title'], message: "Story step 'long' title is cut at its 4-line limit.", suggest: expect.stringContaining('4 lines') }),
      expect.objectContaining({ severity: 'warn', field: ['options', 'story', 'steps', 0, 'body'], message: "Story step 'long' body is cut at its 10-line limit.", suggest: expect.stringContaining('10 lines') }),
    ]);
    expect(geo.story!.steps[0]).toMatchObject({ title, body });
    expect(layout(options).warnings.some(entry => entry.code === 'story-text-truncated')).toBe(false);
  });
});

let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); });

const ScatterChart = withStory(PlainScatter);
const props = { data: fixture.data, ...options } as unknown as ComponentProps<typeof ScatterChart>;
const counter = () => host.querySelector('[data-id="story:counter"]')?.textContent;
const click = (which: 'back' | 'next') => act(() => (host.querySelector(`[data-bp-story-button=${which}]`) as HTMLButtonElement).click());

describe('story below the chart', () => {
  it('measure() reports the height the geometry has, panel included', () => {
    const size = { width: 360 };
    const geo = layout({ ...options, size });
    expect(geo.story!.placement).toBe('below');
    const spec = { type: 'scatter', data: fixture.data, options: { ...options, size } };
    const body = (measure({ spec, width: 360 }) as unknown as { body: { size: { height: number }; naturalSize: { height: number }; naturalHeight: number } }).body;
    expect(body.size.height).toBe(geo.size.height);
    expect(body.naturalSize.height).toBe(geo.size.height);
    expect(body.naturalHeight).toBeGreaterThanOrEqual(geo.size.height);
  });
});

describe('story beside the chart', () => {
  it('measure() reports the full width, panel included', () => {
    // A wide canvas reserves a right column outside the chart.
    const size = { width: 1280, height: 720 };
    const geo = layout({ ...options, size });
    expect(geo.story!.placement).toBe('right');
    const spec = { type: 'scatter', data: fixture.data, options: { ...options, size } };
    const body = (measure({ spec, width: 1280 }) as unknown as { body: { size: { width: number }; naturalSize: { width: number }; naturalWidth: number } }).body;
    expect(body.size.width).toBe(geo.size.width);
    expect(body.naturalSize.width).toBe(geo.size.width);
    expect(body.naturalWidth).toBe(geo.size.width);
  });
});

describe('story React', () => {
  it('Next and Back move an uncontrolled story and stop at the ends', () => {
    root = createRoot(host);
    act(() => root!.render(<ScatterChart {...props} />));
    expect(counter()).toBe('1 / 6');
    click('back');
    expect(counter()).toBe('1 / 6');
    click('next');
    expect(counter()).toBe('2 / 6');
    expect(host.querySelector('[role=status]')!.textContent).toMatch(/^Step 2 of 6: Customer onboarding guide\./);
    click('back');
    expect(counter()).toBe('1 / 6');
  });

  it('a controlled step follows the prop and reports moves', () => {
    const moves: string[] = [];
    root = createRoot(host);
    const draw = (step: string) => act(() => root!.render(<ScatterChart {...props} step={step} onStepChange={next => moves.push(next)} />));
    draw('routes');
    expect(counter()).toBe('5 / 6');
    click('next');
    expect(moves).toEqual(['invoices']);
    expect(counter()).toBe('5 / 6');
    draw('invoices');
    expect(counter()).toBe('6 / 6');
  });

  it('shows the keyboard focus rule, declares arrow keys and keeps focus while stepping', () => {
    root = createRoot(host);
    act(() => root!.render(<ScatterChart {...props} />));
    const group = host.querySelector<HTMLDivElement>('[data-bp-story]')!;
    expect(group.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft ArrowRight');
    expect(group.style.outline).toBe('');
    const css = group.querySelector('style')!.textContent!;
    expect(css).toContain(']:focus-visible,');
    expect(css).toContain(`button:focus-visible{outline:2px solid ${resolveTheme().color.ink};outline-offset:2px}`);
    group.focus();
    const press = (key: string) => act(() => group.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    press('ArrowLeft');
    expect(counter()).toBe('1 / 6');
    press('ArrowRight');
    expect(counter()).toBe('2 / 6');
    expect(document.activeElement).toBe(group);
    const next = host.querySelector<HTMLButtonElement>('[data-bp-story-button=next]')!;
    next.focus();
    for (let i = 0; i < 6; i++) click('next');
    expect(counter()).toBe('6 / 6');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(next);
  });

  // An arrow key that a part inside the chart took (the hover record stops) or that carries a browser shortcut (Alt+Arrow is Back) must not also step the story.
  it('leaves an arrow key to the part that took it and to browser shortcuts', () => {
    root = createRoot(host);
    act(() => root!.render(<ScatterChart {...props} />));
    const group = host.querySelector<HTMLDivElement>('[data-bp-story]')!;
    const press = (init: KeyboardEventInit, target: Element = group) => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...init });
      act(() => { target.dispatchEvent(event); });
      return event;
    };
    for (const init of [{ altKey: true }, { metaKey: true }, { ctrlKey: true }]) expect(press(init).defaultPrevented).toBe(false);
    const inner = group.appendChild(document.createElement('div'));
    inner.addEventListener('keydown', event => event.preventDefault());
    press({}, inner);
    expect(counter()).toBe('1 / 6');
    expect(press({}).defaultPrevented).toBe(true);
    expect(counter()).toBe('2 / 6');
  });

  it('keeps at least 44 px hit boxes apart as the SVG shrinks', () => {
    root = createRoot(host);
    act(() => root!.render(<ScatterChart {...props} />));
    const back = host.querySelector<HTMLButtonElement>('[data-bp-story-button=back]')!.style;
    const next = host.querySelector<HTMLButtonElement>('[data-bp-story-button=next]')!.style;
    for (const style of [back, next]) {
      expect(style.minWidth).toBe('44px');
      expect(style.minHeight).toBe('44px');
      expect(style.boxSizing).toBe('border-box');
      expect(style.transform).toBe('translateY(-50%)');
    }
    expect(back.left).toBe('');
    expect(next.right).toBe('');
    for (const width of [80, 320, 400, 960]) {
      const backRight = width * (1 - parseFloat(back.right) / 100);
      const nextLeft = width * parseFloat(next.left) / 100;
      expect(backRight).toBeLessThan(nextLeft);
    }
  });

  it('splits intersecting prepared hit boxes at a shared boundary', () => {
    const geo = layout(options);
    const story = { ...geo.story!, nav: { ...geo.story!.nav,
      back: { x: 200, y: 200, w: 170, h: 44 }, next: { x: 340, y: 200, w: 160, h: 44 } } };
    root = createRoot(host);
    act(() => root!.render(<StoryFrame geometry={{ ...geo, story }} theme={resolveTheme()} render={() => null} />));
    const back = host.querySelector<HTMLButtonElement>('[data-bp-story-button=back]')!.style;
    const next = host.querySelector<HTMLButtonElement>('[data-bp-story-button=next]')!.style;
    for (const width of [80, 320, 400, 960]) {
      expect(width * (1 - parseFloat(back.right) / 100)).toBeCloseTo(width * parseFloat(next.left) / 100);
    }
  });

  it('covers each stacked control and keeps its hit box apart as the SVG shrinks', () => {
    root = createRoot(host);
    let geo: Geometry | undefined;
    act(() => root!.render(<ScatterChart data={{ points: [{ id: 'a', x: 2, y: 3 }, { id: 'b', x: 4, y: 7 }] }}
      target="dashboard" size={{ width: 400, height: 600 }} canvas={{ margin: { left: 310, right: 16 } }}
      story={{ steps: [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }] }} onGeometry={value => { geo = value; }} />));
    const back = host.querySelector<HTMLButtonElement>('[data-bp-story-button=back]')!.style;
    const next = host.querySelector<HTMLButtonElement>('[data-bp-story-button=next]')!.style;
    const nav = geo!.story!.nav;
    expect(nav.next.y).toBeGreaterThan(nav.back.y + nav.back.h);
    expect(400 * parseFloat(back.width) / 100).toBeCloseTo(nav.back.w);
    expect(400 * parseFloat(next.width) / 100).toBeCloseTo(nav.next.w);
    expect(back.top).toBe('');
    expect(next.bottom).toBe('');
    for (const width of [80, 320, 400]) {
      const height = width * 600 / 400;
      expect(height * (1 - parseFloat(back.bottom) / 100)).toBeLessThan(height * parseFloat(next.top) / 100);
    }
    click('next');
    expect(counter()).toBe('2 / 2');
    click('back');
    expect(counter()).toBe('1 / 2');
  });

  it('uses full authored control names even when the drawn labels are clipped', () => {
    const strings = { storyBack: 'Vorheriger Schritt', storyNext: 'Nächster Schritt' };
    const geo = layout({ ...options, strings });
    const story = { ...geo.story!, nav: { ...geo.story!.nav,
      nodes: geo.story!.nav.nodes.map(node => node.t === 'text' ? { ...node, lines: [''] } : node) } };
    root = createRoot(host);
    act(() => root!.render(<StoryFrame geometry={{ ...geo, story }} theme={resolveTheme()} render={() => null} />));
    expect(host.querySelector('[data-bp-story-button=back]')!.getAttribute('aria-label')).toBe(strings.storyBack);
    expect(host.querySelector('[data-bp-story-button=next]')!.getAttribute('aria-label')).toBe(strings.storyNext);
  });

  it.each([false, true])('keeps authored names on older prepared labels (provider: %s)', async provider => {
    const strings = { storyBack: 'Vorheriger Schritt', storyNext: 'Nächster Schritt' };
    const prepared = await prepareChart({ type: 'scatter', data: fixture.data, options: { ...options, strings } });
    if (prepared.result.refused || !prepared.result.story) throw new Error('Expected a prepared story');
    // ENGINE_REV 97 scenes from before label titles were added are still accepted.
    for (const node of prepared.result.story.nav.nodes) if (node.t === 'text') delete node.title;
    const layoutSpy = vi.spyOn(getChart('scatter')!, 'layout');
    try {
      root = createRoot(host);
      act(() => root!.render(<BoardplotTheme strings={provider ? strings : undefined}>
        <ScatterChart {...props} strings={provider ? undefined : strings} prepared={prepared} />
      </BoardplotTheme>));
      expect(layoutSpy).not.toHaveBeenCalled();
      for (const [which, wording] of [['back', strings.storyBack], ['next', strings.storyNext]] as const) {
        expect(host.querySelector(`[data-id="story:${which}:label"]`)!.textContent!.replace(/\s/g, '')).toBe(wording.replace(/\s/g, ''));
        expect(host.querySelector(`[data-bp-story-button=${which}]`)!.getAttribute('aria-label')).toBe(wording);
      }
    } finally { layoutSpy.mockRestore(); }
  });

  it.each([false, true])('uses German defaults on older prepared labels without layout (provider: %s)', async provider => {
    const locale = { language: 'de-DE' };
    const prepared = await prepareChart({ type: 'scatter', data: fixture.data, options: { ...options, locale, strings: undefined } });
    if (prepared.result.refused || !prepared.result.story) throw new Error('Expected a prepared story');
    for (const node of prepared.result.story.nav.nodes) if (node.t === 'text') delete node.title;
    delete prepared.result.story.stepLabel;
    const layoutSpy = vi.spyOn(getChart('scatter')!, 'layout');
    try {
      root = createRoot(host);
      act(() => root!.render(<BoardplotTheme locale={provider ? locale : undefined}>
        <ScatterChart {...props} locale={provider ? undefined : locale} strings={undefined} prepared={prepared} />
      </BoardplotTheme>));
      expect(host.querySelector('[data-bp-story-button=back]')!.getAttribute('aria-label')).toBe('‹ Zurück');
      expect(host.querySelector('[data-bp-story-button=next]')!.getAttribute('aria-label')).toBe('Weiter ›');
      expect(host.querySelector('[role=status]')!.textContent).toMatch(/^Schritt 1 von 6:/);
      click('next');
      expect(host.querySelector('[role=status]')!.textContent).toMatch(/^Schritt 2 von 6:/);
      expect(layoutSpy).not.toHaveBeenCalled();
    } finally { layoutSpy.mockRestore(); }
  });

  it('hides single-step HTML controls and restricts hover paint to hover devices', () => {
    root = createRoot(host);
    act(() => root!.render(<ScatterChart {...props} story={{ steps: [{ id: 'one', title: 'Only step', body: 'Read the sample.' }] }} />));
    expect(host.querySelectorAll('[data-bp-story-button]')).toHaveLength(0);
    expect(counter()).toBeUndefined();
    const css = host.querySelector('[data-bp-story] style')!.textContent!;
    expect(css).toContain('@media (hover: hover){');
    expect(css).toContain(':active) [data-id="story:next"]{fill:');
    expect(css).not.toContain('progress');
  });

  // A data id with a newline must not end the CSS string and inject CSS into the host page.
  it('keeps a mark id with a newline inside its CSS string', () => {
    const id = 'a\n]{}body{background:rgb(255,0,0)!important}#probe::after{content:url(http://127.0.0.1:8765/leak)}[x="';
    const data = structuredClone(fixture.data) as { points: { id: string }[] };
    data.points[0]!.id = id;
    root = createRoot(host);
    act(() => root!.render(<ScatterChart {...props} data={data as never} story={{ steps: [{ id: 'one', title: 'T', highlight: [id] }, { id: 'two', title: 'T2' }] }} />));
    const style = host.querySelector<HTMLStyleElement>('[data-bp-story] style')!;
    expect(style.textContent).not.toMatch(/[\n{}]body|url\(/);
    const cursor = Array.from(style.sheet!.cssRules).find(rule => (rule as CSSStyleRule).style?.cursor === 'pointer') as CSSStyleRule;
    expect(host.querySelector(cursor.selectorText)?.getAttribute('data-id')).toBe(`mark:${id}`);
  });

  it('keeps a body omitted from a fixed panel in the live region', () => {
    // At 480 px the hard-minimum plot leaves room for one cut body line; this test needs the body omitted.
    // The engine notes print (notes.show) as they did when this height was chosen; without them the body fits.
    const geo = layout({ ...options, target: 'dashboard', notes: { show: ['note', 'disclosure', 'method'] }, size: { width: 400, height: 460 } });
    const story = geo.story!;
    expect(story.steps[0]!.nodes.some(node => node.id === 'story:body')).toBe(false);
    expect(story.steps[0]!.body).not.toBe('');
    root = createRoot(host);
    act(() => root!.render(<StoryFrame geometry={{ ...geo, story }} theme={resolveTheme()} render={() => null} />));
    expect(host.querySelector('[role=status]')!.textContent).toBe(`Step 1 of 6: ${story.steps[0]!.title}. ${story.steps[0]!.body}`);
    expect(host.querySelectorAll('[data-bp-story-button]')).toHaveLength(2);
  });

  it('announces the locale and authored position wording through props and the provider', () => {
    root = createRoot(host);
    const draw = (language: string, chart?: string, provider?: string) => act(() => root!.render(
      <BoardplotTheme locale={language} strings={{ storyStep: provider }}>
        <ScatterChart {...props} strings={{ storyStep: chart }} step="onboarding" />
      </BoardplotTheme>,
    ));
    draw('en');
    const status = () => host.querySelector('[role=status]')!;
    expect(status().textContent).toMatch(/^Step 2 of 6: Customer onboarding guide\./);
    expect(status().getAttribute('aria-atomic')).toBe('true');
    draw('de-DE');
    expect(status().textContent).toMatch(/^Schritt 2 von 6: Customer onboarding guide\./);
    draw('de-DE', undefined, 'Stage {step} / {count}');
    expect(status().textContent).toMatch(/^Stage 2 \/ 6:/);
    draw('de-DE', 'Part {step} of {count}', 'Stage {step} / {count}');
    expect(status().textContent).toMatch(/^Part 2 of 6:/);
    expect(counter()).toBe('2 / 6');
  });
});
