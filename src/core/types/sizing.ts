import type { RenderTarget } from './options';

/** Internal layout signal; symbols stay out of serialized sizing metadata. */
export const HEIGHT_STRUCTURE = Symbol('heightStructure');
/** Internal value-selection pass; the measured pass still includes the footer. */
export const VALUE_SELECTION = Symbol('valueSelection');

export interface PresentationInfo {
  target: RenderTarget;
  typeClass: 'S' | 'M' | 'L';
  naturalSize: { width: number; height: number; unit: 'px' | 'pt' };
  /** Minimum display width in CSS px, calculated from emitted text. */
  minDisplayWidth: number;
  /**
   * The `textScale` the chart drew its text at; absent means 1. HTML a host
   * prints beside the chart (a footer, a hover card) reads it to set its own
   * text at the same scale.
   */
  textScale?: number;
}

export interface ChartSizing {
  aspect: '16:9' | '4:3' | '1:1' | 'content';
  minWidth: number;
  minHeight: number;
  /** Content measures its natural height at a width; fill reports the height of its aspect at that width. */
  fit: 'fill' | 'content';
  /**
   * The smallest canvas the type still draws on, in compact form, when it has
   * one. Between this floor and `minWidth`/`minHeight` the chart loses its
   * legend, most value labels and its second title line rather than refusing.
   */
  compactFloor?: { width: number; height: number };
}

export interface ResolvedSizing extends ChartSizing {
  /** Extra structure gained with height, which plot growth alone does not measure. */
  [HEIGHT_STRUCTURE]?: boolean;
  /** Content requirement before the standalone canvas policy is applied. */
  measuredMinWidth: number;
  measuredMinHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  comfortableWidth: number;
  comfortableHeight: number;
  /** What else lowers the minimum, when the layout knows (a table's prose column that could wrap). */
  hint?: string;
}
