### Fixed

- A chart whose slide or print text is stepped down and then drawn by a later step (a smaller type class or the narrower form) now carries the `type-stepped` note, in render and in `measure`. Before, a grid drawn in its narrow form at 480 to 488 px set its title at 21.33 px instead of 24 px and said nothing.
