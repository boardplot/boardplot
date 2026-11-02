### Fixed

- A callout or note wrapped to several lines keeps a drawn leader to its own mark when it sits diagonally from it. The minimum drawn leader length now uses one text line instead of the full wrapped height, and a diagonal seat without a drawable leader comes after every seat that has one, so the text no longer sits over a neighbouring bar with no leader. One-line callouts and wrapped callouts that already had a leader are unchanged.
