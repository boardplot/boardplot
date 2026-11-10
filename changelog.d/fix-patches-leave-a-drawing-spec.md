### Fixed

- Three repair patches now leave a spec that draws: a 100% line composition drops the whole `referenceBands` list when every band is outside 0..100, a scatter `log: "both"` refusal takes the log scale off every axis with a nonpositive value, and a cohort key that its variant never draws gets its remove patch from the schema refusal too.
