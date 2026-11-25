### Changed

- The React hover card follows a mouse or pen pointer, as a tooltip does. It sits 20 px right of and below the pointer, flips to the left or above at the edge of the chart, glides to each new place over `theme.motion.travel` and fades in and out over `theme.motion.fade`. It closes 100 ms after the pointer leaves the chart or every mark. Before, it jumped between seats beside each mark. A tap, the keyboard and `renderHoverContent` keep the seat beside the mark. A pointer move within one mark no longer draws the chart again.
- The default hover card lets the pointer through on every chart type, so the pointer can no longer rest on the card itself. A card from `renderHoverContent` still takes the pointer.
- `theme.motion.travel` defaults to 400 ms, was 160 ms. Nothing else read it. Set it to 0 to move the card at once.
