### Changed

- The `tolerance` band of a `valueLine` on a column, bar or dot chart is now named in the chart's key, with its bounds: "Target range: 95 to 105". Before, the band printed two bare numbers inside itself, "95 to 105", and nothing on the chart said what the shaded area meant. Where the numbers did not fit, as on most column charts, they moved to the notes.
  - The key takes the name of the line: a line labelled `Target` gives "Target range", a measured mean gives "Average range", and a line without a name gives "Range".
  - The band no longer prints its bounds inside itself.
  - A chart that had no key gets a key row and is 26 px taller. A key that only the band brought does not repeat the name of a single series.
  - With `legend: "none"`, and in a grid panel, the band keeps its bounds inside itself as before.
  - The new strings `valueLineRangeKey` and `valueLineRangeKeyPlain` set the wording.
