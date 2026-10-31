### Fixed

- The React hover card of a chart no longer covers the filled marks of other categories when a clear seat exists. On a stacked column chart, the card for one quarter sat over the next quarter's column. The card now takes a seat that covers no filled mark, and it may leave the chart frame to do so. It stays inside the browser viewport and never changes the page layout. Area outside the chart frame costs less than covering a mark.
- The hover card of a chart can now be hovered. Before, the pointer passed through the card and picked the mark under it, so the card was replaced as the pointer moved onto it. The card now stays open while the pointer is on it. After the pointer leaves the chart, the card stays for a moment so the pointer can cross a gap onto it.
- In a browser without the `popover` attribute, the hover card is fixed to the viewport. Before, it was absolute in the document body and could extend the document's scroll area.
