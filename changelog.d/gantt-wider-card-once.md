### Fixed

- A gantt chart narrower than 480 px with its height left open draws its wider reference card once per request, not once per layout pass. One render of a gantt with long names at 320 px needed about 1,575 layouts and now needs 27, and its first `measure` call drops from about 1,850 layouts to about 130. Output is unchanged.
