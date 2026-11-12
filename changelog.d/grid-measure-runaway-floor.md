### Fixed

- `measure` returns for a chart whose height floor grows with its frame, such as a grid that puts the baselines of stacked panels on one line (`anchors.baselines: "column"` on a grid with a variance tier). It reports the same `label-collision` refusal as `render` and names no height above the frame. Before, `measure` never returned for some of these specs and reported a minimum height of about 10^18 px for others. A size search in layout now stops at four times the first size the chart asks for, or 4096 px more height, and refuses there.
