### Fixed

- Number format examples and `rgba()` alpha colours no longer slow down on long malformed input. A format of 50,000 characters took 1 to 2 seconds to parse, and a chart parses its format about 16 times per render. Valid formats and colours parse to the same result.
