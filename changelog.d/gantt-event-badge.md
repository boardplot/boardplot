### Added

- Gantt events take `labelPlacement: 'badge'`: the label, at most 3 characters such as a change number, sits in a filled circle at the top of its rule, and the rule starts 2 px under the circle. The circle is ink, or the bad colour for `tone: 'bad'`, with inverse text. Badge events never go to the numbered footnote key and do not count toward the key mode above three events. Badges closer than their width plus 4 px stack one level up. A longer badge label is refused, and column and combo refuse `'badge'`. The `status-timeline` fixture numbers its three changes with badges.
