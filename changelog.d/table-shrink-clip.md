### Fixed

- A table in a fixed frame no longer cuts a text column while a wrapping column keeps width it does not need. A head such as `CONSIDERATION` and a cell such as `Signing Q2, closing Q1 next year` printed as `CONSIDER…` and `Signing Q2, closing…`, with a wide `Conditions` column beside them. The shrink now takes the missing width from a column that stays uncut at the narrower width, and tables that were not cut keep their tracks.
- A row-label column with `emphasis: "strong"`, which the boardroom look sets, is measured in the bold weight it draws. The track was sized for the regular weight, so a label such as `Imaging Contrast Agents` ran under the next heat cell and lost its last letter. A strong value column is measured the same way.
