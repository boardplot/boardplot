import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { storyView } from '../core/story';
import { localeStrings, stringFields } from '../core/strings';
import { interactionTokens } from '../core/a11y/theme';
import type { StoryGeometry } from '../core/types/scene';
import type { StringsSpec } from '../core/types/options';
import type { Theme } from '../core/types/theme';
import type { RenderGeometry } from './prepared';
import { useBoardplotTheme } from './themeContext';

/** Why the step changed. */
export type StoryStepReason = 'back' | 'next' | 'key' | 'mark';

/** The story props of every chart component; the steps themselves are `options.story`. */
export interface StoryProps {
  /** Controlled step id. Without `onStepChange` the story is read-only. */
  step?: string;
  /** The first step of an uncontrolled story; default `options.story.step`, else the first step. */
  defaultStep?: string;
  /** Called with the next step id when the reader moves: a button, an arrow key or a click on a mark. */
  onStepChange?: (step: string, detail: { index: number; reason: StoryStepReason }) => void;
  /** A click on a mark a step brings forward moves to that step. Default true. */
  stepOnMarkClick?: boolean;
}

/** What `withStory` hands a chart component: the frame and the host's story props. */
export type StoryLink = StoryProps & { Frame: typeof StoryFrame };

const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
const pct = (value: number, of: number) => `${(value / of) * 100}%`;
// A CSS string body: every character outside [A-Za-z0-9_-] becomes a hex escape, so no data id can end the string.
const attr = (value: string) => value.replace(/[^\w-]/gu, char => `\\${char.codePointAt(0)!.toString(16)} `);

/**
 * A chart with a story (options.story): the step's view of the laid-out
 * scene, Back and Next over the buttons the layout drew, the arrow keys and
 * an announcement of each step. A step changes paint and text weight only;
 * every position comes from the layout.
 */
export function StoryFrame({ geometry, theme, strings, render, step, defaultStep, onStepChange, stepOnMarkClick = true, styleNonce, onStep }: StoryProps & {
  geometry: RenderGeometry & { story: StoryGeometry };
  theme: Theme;
  strings?: Pick<StringsSpec, 'storyBack' | 'storyNext' | 'storyStep'>;
  render: (view: RenderGeometry) => ReactNode;
  styleNonce?: string;
  /** Called with the id of the step on screen once it shows: the chart's export draws that step. */
  onStep?: (id: string) => void;
}): ReactElement {
  const story = geometry.story;
  const ids = story.steps.map(entry => entry.id);
  const indexOf = (id: string | undefined) => (id === undefined ? -1 : ids.indexOf(id));
  const [own, setOwn] = useState(() => (indexOf(defaultStep) >= 0 ? indexOf(defaultStep) : story.step));
  const controlled = step !== undefined;
  const index = controlled ? (indexOf(step) >= 0 ? indexOf(step) : story.step) : Math.min(own, ids.length - 1);
  // Back stops at the first step and Next at the last: a story has a start and an end.
  const go = (next: number, reason: StoryStepReason) => {
    if (next < 0 || next >= ids.length || next === index) return;
    if (!controlled) setOwn(next);
    onStepChange?.(ids[next]!, { index: next, reason });
  };
  const view = useMemo(() => ({ ...geometry, ...storyView(geometry, index, true) }), [geometry, index]);
  const shownStep = ids[index];
  useEffect(() => { if (shownStep !== undefined) onStep?.(shownStep); }, [shownStep, onStep]);
  // A mark answers for the first step that brings it forward.
  const markSteps = useMemo(() => {
    const map = new Map<string, number>();
    story.steps.forEach((entry, at) => entry.focus.forEach(id => { if (!map.has(id)) map.set(id, at); }));
    return map;
  }, [story]);
  const { motion } = useBoardplotTheme();
  const scope = useId();
  const tokens = interactionTokens(theme);
  const fade = `[data-bp-story="${attr(scope)}"] svg [data-id]{transition:opacity ${tokens.fade}ms ${tokens.easing}}`;
  const selector = `[data-bp-story="${attr(scope)}"]`;
  const state = (which: 'back' | 'next', pseudo: string, fill: string) =>
    `${selector}:has([data-bp-story-button="${which}"]:not([aria-disabled="true"]):${pseudo}) [data-id="story:${which}"]{fill:${fill}}`;
  const css = [
    motion === 'full' ? fade : motion === 'system' ? `@media (prefers-reduced-motion: no-preference){${fade}}` : '',
    `[data-bp-story="${attr(scope)}"]:focus-visible,[data-bp-story="${attr(scope)}"] button:focus-visible{outline:2px solid ${theme.color.ink};outline-offset:2px}`,
    `@media (hover: hover){${state('back', 'hover', theme.color.others)}${state('next', 'hover', theme.color.inkMuted)}}`,
    state('back', 'active', theme.color.grid), state('next', 'active', theme.color.inkMuted),
    stepOnMarkClick && markSteps.size ? `${[...markSteps.keys()].map(id => `[data-bp-story="${attr(scope)}"] [data-id="${attr(id)}"]`).join(',')}{cursor:pointer}` : '',
  ].join('');

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    go(index + (event.key === 'ArrowRight' ? 1 : -1), 'key');
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!stepOnMarkClick || !(event.target instanceof Element) || event.target.closest('button')) return;
    const id = event.target.closest('[data-id]')?.getAttribute('data-id');
    const at = id ? markSteps.get(id) : undefined;
    if (at !== undefined) go(at, 'mark');
  };
  const { width, height } = geometry.size;
  const defaults = localeStrings();
  const label = (prefix: 'back' | 'next') => {
    const node = story.nav.nodes.find(entry => entry.id === `story:${prefix}:label`);
    const key = prefix === 'back' ? 'storyBack' : 'storyNext';
    return (node?.t === 'text' ? node.title : undefined) ?? strings?.[key] ?? defaults[key];
  };
  // Older prepared scenes can contain intersecting drawn boxes. Split their
  // hit boxes at one boundary, then let the minimum target grow away from it.
  const backEnd = story.nav.back.x + story.nav.back.w;
  const nextStart = story.nav.next.x;
  const stacked = story.nav.back.y + story.nav.back.h <= story.nav.next.y;
  const boundary = (backEnd + nextStart) / 2;
  const backRight = stacked ? backEnd : Math.min(backEnd, boundary);
  const nextLeft = stacked ? nextStart : Math.max(nextStart, boundary);
  const button = (which: 'back' | 'next', box: StoryGeometry['nav']['back'], disabled: boolean) => (
    <button type="button" data-bp-story-button={which} aria-label={label(which)} aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) go(index + (which === 'next' ? 1 : -1), which); }}
      // Keep disjoint inner edges, including when the SVG scales below its layout width.
      style={{ position: 'absolute', ...(which === 'back' ? { right: pct(width - backRight, width) } : { left: pct(nextLeft, width) }),
        ...(stacked ? (which === 'back' ? { bottom: pct(height - box.y - box.h, height) } : { top: pct(box.y, height) })
          : { top: pct(box.y + box.h / 2, height), transform: 'translateY(-50%)' }),
        width: pct(which === 'back' ? backRight - box.x : box.x + box.w - nextLeft, width), height: pct(box.h, height),
        minWidth: 44, minHeight: 44, boxSizing: 'border-box',
        pointerEvents: 'auto', appearance: 'none', WebkitTapHighlightColor: 'transparent', borderRadius: 6, background: 'transparent', border: 0, padding: 0, margin: 0, cursor: disabled ? 'default' : 'pointer' }} />
  );
  const current = story.steps[index]!;
  const position = stringFields(story.stepLabel ?? strings?.storyStep ?? defaults.storyStep, { step: index + 1, count: ids.length });
  return (
    <div data-bp-story={scope} role="group" aria-roledescription="story" aria-label={geometry.a11y.title} aria-keyshortcuts="ArrowLeft ArrowRight" tabIndex={0}
      onKeyDown={onKeyDown} onClick={onClick} style={{ position: 'relative' }}>
      {/* Raw text, as the hover surface writes it; a `<` is CSS-escaped. */}
      <style nonce={styleNonce} dangerouslySetInnerHTML={{ __html: css.replace(/</g, '\\3c ') }} />
      {render(view)}
      {/* The SVG keeps its aspect ratio, so a box of that ratio over its top maps the layout's button rects in percent. */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', aspectRatio: `${width} / ${height}`, pointerEvents: 'none' }}>
        {ids.length > 1 && button('back', story.nav.back, index === 0)}
        {ids.length > 1 && button('next', story.nav.next, index === ids.length - 1)}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" style={HIDDEN}>{position}: {[current.title, current.body].filter(Boolean).join('. ')}</div>
    </div>
  );
}
