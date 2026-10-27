### Added

- Gantt `rows[].sublabel`: a second line under the row name, such as what the row measures. It prints in the label font and muted ink, on one line and never cut. The name band takes the wider of the name and the sublabel, and the name and sublabel centre together on the row. On narrow canvases (the stacked form) it follows the name on the row's name line. `labels.activity: false` hides it with the name. The accessible row summary and the item records read "name, sublabel". New example fixture `status-timeline`.
