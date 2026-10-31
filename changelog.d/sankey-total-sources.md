### Fixed

- A sankey total now counts every source. The description, the accessible title and `derived.total` summed only the first column, so a source node in a later stage was left out. A chart with a 90 flow from a second-stage source read "total 0" or "total 10". The total is now the sum of the nodes that nothing flows into. A chart whose sources all sit in the first column is unchanged.
