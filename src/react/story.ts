"use client";

/**
 * `boardplot/react/story`: the story layer for React (options.story).
 * A chart component draws a story only through `withStory`; every other
 * bundle draws the plain chart and warns `story-layer-not-loaded`, so only a
 * page that tells a story pays for the panel layout and the Back/Next frame.
 */

import { createElement, type ComponentType } from 'react';
import { linkStoryLayer } from '../core/storyLayer';
import { StoryFrame, type StoryProps } from './StoryFrame';

export type { StoryProps, StoryStepReason } from './StoryFrame';

/**
 * A chart component that draws `options.story`: `withStory(ScatterChart)`,
 * or `withStory(BoardplotChart)`. The result takes the component's props plus
 * `step`, `defaultStep`, `onStepChange` and `stepOnMarkClick`.
 */
export function withStory<P extends object>(Chart: ComponentType<P>): ComponentType<P & StoryProps> {
  linkStoryLayer();
  const Story = ({ step, defaultStep, onStepChange, stepOnMarkClick, ...props }: P & StoryProps) =>
    createElement(Chart, { ...props, storyLink: { Frame: StoryFrame, step, defaultStep, onStepChange, stepOnMarkClick } } as unknown as P);
  Story.displayName = `withStory(${Chart.displayName ?? Chart.name})`;
  return Story;
}
