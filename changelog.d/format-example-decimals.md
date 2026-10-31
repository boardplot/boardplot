### Fixed

- A format example with one dot before three digits, such as `1.234`, no longer rounds small numbers to whole ones. It was always read as a thousands group, so 0.512 printed 1. It now means three decimals where every number of the chart is below 1000 and one has a fraction. Elsewhere it stays a group, and the warning `format-reads-as-group` names a small number the group rounds.
