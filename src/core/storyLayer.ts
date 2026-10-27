/**
 * Publishes the story pass (`core/story`, see `core/deferred`). The layout
 * draws `options.story` only where this module is linked: the CLI, the MCP
 * server, `boardplot`, `react/prepare`, `react/export` and
 * `boardplot/react/story`. Elsewhere the plain chart draws with the
 * warning `story-layer-not-loaded`, so no other bundle carries the pass.
 *
 * An entry links it by calling `linkStoryLayer()`, for the reason
 * `core/themeShapeRules` gives. Importing the module still publishes.
 */

import { publishDeferred } from './deferred';
import { applyStory } from './story';

export function linkStoryLayer(): void {
  publishDeferred('story', { applyStory });
}

linkStoryLayer();
