### Fixed

- The schema text of `locale.weekStartsOn` and `locale.minusGlyph` now says where each is read. `weekStartsOn` is read by week ticks on column, combo and line. `minusGlyph` is read by table and dimswitch. Other types ignore both without a warning, as before.
