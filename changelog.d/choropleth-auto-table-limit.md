### Fixed

- Choropleth: an authored `valueTable: 'auto'` on a map of more than 20 regions now warns `option-ignored`. The warning names the 20-region limit and the region count, and suggests `'below'` or `'side'`, which draw the table at any count. Before, the table was left off without a warning. An omitted `valueTable` draws as before and warns nothing.
