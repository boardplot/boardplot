### Fixed

- A cohort with the id `average` keeps its own claims in the reading. The weighted average row's claims are now named `cohort-average:t<n>` (before `cohort:average:t<n>`), so the two rows no longer share ids and both printed cells read as displayed. A reader that looked up `cohort:average:t<n>` now finds the average under `cohort-average:t<n>`.
