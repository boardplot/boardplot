### Fixed

- A box chart now accepts `valueAxis.break`. A far outlier no longer has to squeeze every box into one corner of the axis. Set `{ from, to }` across an empty range, and the outliers stay visible beyond the break mark. The span may hold no drawn value, and no box or whisker may cross it. A break that breaks this rule, or a hidden value axis, is ignored with the warning `axis-break-invalid`, and the chart is drawn without it. A box chart with an authored break no longer parks a lone outlier at the plot edge. Histogram and every other type are unchanged.
