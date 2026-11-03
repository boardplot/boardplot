### Fixed

- Column: a curved callout leader that would pass within the label gap of another printed text, such as a stack total over the anchor, now runs flat along its start until it is past that text and curves from there. The leader no longer touches the total's digits.
- Column, line and combo anomaly corridors: the MAD rule in the footnote reads "median 20.5 ± 3.5 × 1.4826 × MAD 1" with a plus-minus sign where it printed a dash, in English and German.
- Grid: an alignment rule stops at the ends of a panel line drawn on the same coordinate, such as a panel baseline, so one baseline draws instead of a faint rule over the axis line.
- Grid facets with their own value axes: the plot gives back as much of its pull under the heading as keeps a 2 px gap between the heading and the top tick label. Panel titles no longer sit on the top tick label.
- Waterfall: a value inside a stacked segment keeps 1 px air above and below its digits. A value that does not fit takes a seat beside its segment, level with it on either side first, then above or below on a leader, so the parts of a split step visibly add up.
