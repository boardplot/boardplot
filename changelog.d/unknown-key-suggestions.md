### Fixed

- An unknown key in `data` now gets advice that keeps the data. `values` on a box group or a histogram points to `observations`, `color` on a series to `fill`, and `name` on a category or series to `label`. A flat `items` list points to `categories` and `series`. Each of these comes with a JSON Patch fix that moves the value and loses nothing. A key that holds an array or object is never advised for removal. Before, box `values` read "Rename to label", and the others read "Remove". The data is still refused.
