### Fixed

- A rows file that is not valid UTF-8 now warns `rows-encoding-replaced` with the byte offset of the first bad byte and the hint to save the file as UTF-8. A Windows-1252 export, such as a CSV from German Excel, printed the replacement character U+FFFD in its labels with no warning. The chart still draws, as before, for both CSV and JSON files.
