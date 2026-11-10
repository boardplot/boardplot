### Fixed

- Four layout refusals now carry the JSON Pointer of the authored field as `path` and its value as `received`: an unknown table status (`/data/rows/1/cells/state`), a field that an architecture diagram node does not read, such as `caption` (`/data/nodes/2/caption`), a stacked store on an architecture diagram (`/data/nodes/2/repeat`), and a waffle category whose values add up to more than 100 (`/data/categories/0`). Before, `path` was empty and `received` described the whole spec. React hosts read the same field.
