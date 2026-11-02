### Changed / may need action

- Grouped and stacked bar and column charts now refuse series with different units on one value axis with `unit-conflict`, as combo charts do. Before, the charts could draw smaller values as slivers. Give the series the same unit, or show the measures in separate charts.
