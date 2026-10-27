### Added

- Gantt items take `kind: 'rule'`: a quiet span for the state before a change. It draws a 2 px neutral line on the bottom edge of the bar box, with its label 2 px above the line in muted ink, flush left. The line is a data mark and never breaks around text. A rule never takes a colour or a colour-key entry; `colorRole` or `colorLabel` on a rule is refused. The `status-timeline` fixture uses it for the states before each change.
