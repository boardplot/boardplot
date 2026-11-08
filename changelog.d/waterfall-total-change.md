### Changed

- Waterfall: the total change, a `diff` or `delta` between the bridge's first and last total, runs as the growth bracket, as a far difference does on a column chart: a leg up from each total, a run above the step brackets, and the difference on the run. Before, it drew dotted level lines from both totals through the bars, with its arrow and number in a gap between them, where the number could land on a step's value; on a narrow card the number went to the notes. A difference between other totals, or one that names a step or a case, is unchanged.
- To bring back the earlier look, set `placement: "label"` on the annotation: `{ "kind": "diff", "from": "fy24", "to": "fy25", "placement": "label" }`.
