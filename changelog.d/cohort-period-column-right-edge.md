### Changed

- Cohort tables (`variant: "pure"` and `"stepped"`) line up the rates of each period column, the total row included, on one right edge, so digits and decimal points sit under each other. The column of figures stays centred under its period head. Each rate was centred on its own width before. To bring back the old look, set `options.columnOverrides.periods.align: "center"`.
