### Fixed

- The value labels of a waterfall with `data.cases` read as their own bar's, in both layouts. In columns, each value now centres on its own bar. Before, the first case sat at its bar's right edge and the last case at its left edge, and their totals were pushed towards each other. Only values that would crowd each other keep the old seats at the inner edges: two at one height nearer than 6 px, or a value wider than its bar that would touch its neighbour. In bars (`variant: 'horizontal'`), each value now sits 8 px past the end of its own bar and centres on its row, and each step name centres on the step's bars. Before, values floated up to 50 px from their bars, overprinted them, or fell to the notes. A case step's `direction` now sets its value ink in bars too. There is no option to bring the old look back. Golden change: `waterfall/two-case-budget-bridge` (both variants). New fixture: `waterfall/two-case-budget-bars`.

### Changed / may need action

- `data.cases` with `variant: 'horizontal'` is a supported form. The schema text and the reference called it refused, but the check never ran and the chart always drew, so no spec changes. The refusal code `waterfall-cases-horizontal` is gone. A step name in this form may now take two lines, as its row is the whole step.
