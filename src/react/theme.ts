"use client";

// boardplot/react/theme: the React pieces a host needs next to per-type
// charts (`boardplot/react/<type>`) or `BoardplotChart` (`boardplot/react/spec`),
// without a chart core. Nothing here registers a chart, so a page links only
// the cores it draws. `boardplot/react` exports the same pieces, but it
// registers every core on load.
//
// Not here: `useChartLayout`. It registers every core, because it lays out
// any type by name; import it from `boardplot/react`.
//
// The package smoke test (`scripts/package-smoke.mjs`) checks that this entry
// plus one per-type chart links no other type's core.

export { BoardplotTheme, useBoardplotTheme } from './BoardplotTheme';
export type { BoardplotThemeProps, BoardplotThemeOptions, BoardplotStrings } from './BoardplotTheme';

// Shared numeric value scales across typed charts and BoardplotChart.
export * from './scale-group';

export { SceneRenderer } from './SceneRenderer';
export type { ChartProps, HoverOption } from './createChartComponent';
export type { ContainerSizeOptions } from './useContainerSize';
export type { RefusalProps } from './SizePlaceholder';
export type { PreparedChart, RenderGeometry } from './prepared';
export type { ChartNote, NoteKind, ChartCredit, CreditLink } from '../core/notes';
