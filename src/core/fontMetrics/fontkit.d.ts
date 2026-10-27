/**
 * The slice of fontkit's API the `boardplot fonts build` reader uses.
 *
 * fontkit 2.x ships no type declarations. `src/cli/fontTables.ts` imports it
 * statically and tsup bundles it into the Node-only CLI entry, so the shipped
 * bin carries its reader; this file only keeps that reader typed, without an
 * @types package or an `any` cast at every call.
 */
declare module 'fontkit' {
  export interface FontkitFont {
    familyName: string;
    subfamilyName: string;
    fullName: string;
    postscriptName: string;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    lineGap: number;
    /** Missing on some faces (DejaVu, for example); 0 is written then. */
    capHeight: number | undefined;
    xHeight: number | undefined;
    'OS/2'?: {
      usWeightClass?: number;
      fsSelection?: { italic?: boolean; oblique?: boolean };
    };
    /** Axes of a variable font by tag, e.g. `wght`; empty for a static face. */
    variationAxes: Record<string, { name: string; min: number; default: number; max: number }>;
    /** The parsed HVAR table, when the variable font has one. */
    HVAR?: object;
    /**
     * Not public fontkit API: the axis coordinates the constructor stores and
     * `_variationProcessor` reads once, lazily. `boardplot fonts build` sets
     * them on a freshly opened face to read HVAR deltas at another weight
     * (see hvarAdvancesAt in src/cli/fontTables.ts for why).
     */
    variationCoords: number[] | null;
    /** Not public fontkit API either; null for a static or default-instance face. */
    readonly _variationProcessor: { getAdvanceAdjustment(glyphId: number, hvar: object): number } | null;
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): { id: number; advanceWidth: number };
    /**
     * Shaped advance for a string. `features` are OpenType feature tags, e.g.
     * `['tnum']` — the same call scripts/build-font-metrics.mjs makes for the
     * tabular figures the renderers draw numeric text with (font-variant-numeric:
     * tabular-nums), which is why generated host tables use it too.
     */
    layout(text: string, features?: string[]): { advanceWidth: number; glyphs: { id: number }[]; positions: { xAdvance: number }[] };
  }

  /** A TrueType/OpenType collection (.ttc/.otc) opens as its list of faces. */
  export interface FontkitCollection {
    fonts: FontkitFont[];
  }

  export function openSync(path: string): FontkitFont | FontkitCollection;
  export function create(buffer: Uint8Array): FontkitFont | FontkitCollection;
}
