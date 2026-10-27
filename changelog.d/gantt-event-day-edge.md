### Fixed

- Gantt event rules at an ISO date or at a bar, chevron, bracket or shade item draw on the start edge of their day. An event at an item id now sits exactly on that item's start edge, the boundary it marks. Before, the rule sat half a day inside the new span. An event at a milestone or a cadence event keeps drawing through the middle of its marker. The today line stays at the middle of its day. No golden changes: the only fixture with events anchors them at cadence events.
