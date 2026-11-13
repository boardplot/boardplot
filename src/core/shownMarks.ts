import type { ShownMark } from './types/scene';

/**
 * Would-be value texts that a chart states on demand, in
 * `geometry.marks.wouldShow`: the texts the labels of undrawn values would
 * print. A chart lays out several passes and keeps one, and the SVG never
 * prints these texts, so a pass does not format them. The record link asks
 * for them once, when a record needs one (`withShownTexts`). A copy of the
 * geometry shares the holder, and JSON leaves it out.
 */
export class DeferredShownMarks {
  #compute: (() => readonly ShownMark[]) | undefined;
  #marks: readonly ShownMark[] | undefined;

  constructor(compute: () => readonly ShownMark[]) {
    this.#compute = compute;
  }

  /** The texts, computed on the first call. */
  marks(): readonly ShownMark[] {
    if (this.#marks === undefined) {
      this.#marks = this.#compute!();
      this.#compute = undefined;
    }
    return this.#marks;
  }

  toJSON(): undefined {
    return undefined;
  }
}
