### Changed / may need action

- The average marker of a column, bar or combo chart now leaves out categories marked `partial`, such as a week still running. Its label names the periods it covers, for example `Average 674.4 (W31–W37)`. A mean that mixed a running total into finished ones was too low. The new option `averageMarker: { includePartial: true }` brings the old mean back. `averageMarker.scope` is now optional, so `{ includePartial: true }` alone averages every series. A chart whose categories are all partial still averages them.
