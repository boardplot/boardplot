### Changed

- A 16-category stacked column with long category names took about 49 ms per desktop layout across ten themes at 878 px, down from 117 ms in the earlier optimized engine. The engine reuses the frame while finding room for the names and checks each column’s obstacles in one pass. The chart keeps its original labels, leaders and exact sizing advice.
- Reusing the stacked-column data while testing different heights reduced the number of data preparations from 22 to two on the first layout. In ten paired desktop runs with page fonts, this cut the average from 48.17 to 45.49 ms and the first layout from 121.67 to 117.30 ms.
- A mixed column and line grid reserves space for each caption before placing its panels. This saved about 11 ms per repeated layout at 878 px and 40 ms at 375 px in a paired benchmark.
