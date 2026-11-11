### Fixed

- A grid's kept column-reflow and value-room choices are keyed by every option the layout reads, including internal markers such as the narrow form and the type class cap. Before, a layout in a smaller type class or in the narrow form could read a choice made for another form of the same grid.
