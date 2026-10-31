### Fixed

- A variance chart now warns when a blank part removes a category. Before, a category with a blank series value in its total drew an empty slot, or an en dash under `missingMark: "dash"`, and the warnings and notes said nothing, so the empty slot read as no difference. The chart now reports an info warning `missing-value` for each such category. It names the blank series and says whether the category is not drawn or drawn as an en dash. The drawing does not change.
