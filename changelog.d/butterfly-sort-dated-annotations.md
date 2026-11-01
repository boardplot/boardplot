### Fixed

- A butterfly chart with dated categories and a CAGR or a cross-period diff annotation now keeps its rows in sheet order when `sortBy` is `a`, `b`, `sum` or `diff`, and warns `butterfly-sort-ignored`. Before, the sort scrambled the periods and the growth bracket ran from the last period to the first. Charts without such an annotation sort as before.
