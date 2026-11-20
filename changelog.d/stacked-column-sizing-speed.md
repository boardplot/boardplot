### Changed

- A 16-category stacked column with long category names took about 49 ms per desktop layout across ten themes at 878 px, down from 117 ms in the earlier optimized engine. The engine reuses the frame while finding room for the names and checks each column’s obstacles in one pass. The chart keeps its original labels, leaders and exact sizing advice.
- A mixed column and line grid reserves space for each caption before placing its panels. This saved about 11 ms per repeated layout at 878 px and 40 ms at 375 px in a paired benchmark.
