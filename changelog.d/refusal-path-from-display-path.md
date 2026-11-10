### Fixed

- A layout refusal that named its field only in display form, such as a table status cell (`rows[id].cells[column]`) or a diagram node caption (`nodes[id].caption`), now carries the JSON Pointer of that field as `path` and its authored value as `received`. Before, `path` was empty and `received` described the whole spec. React hosts and the CLI read the same field.
