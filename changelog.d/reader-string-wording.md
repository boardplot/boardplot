### Changed / may need action

- The funnel column heads read `Step conversion` and `Total conversion` in English, and `Stufen-Konversion` and `Gesamt-Konversion` in German. The old heads were `Step CVR`, `Total CVR`, `Stufen-CVR` and `Gesamt-CVR`. No option sets the old heads back. The two-head form `Conversion rate` over `Step` and `Total` is unchanged.

### Fixed

- A React chart with hover on now ends a capped note with `(tap or hover shows each value)`, because touch opens the hover card too. It said `hover` only.
- A sankey note for a folded Other node reads `Others (Channel): Display 9, Affiliates 7`. It read `Others (Channel) includes Display 9, Affiliates 7`.
- The pyramid method note no longer uses interval notation. It reads `Each band runs from its lower bound up to, but not including, its upper bound. The youngest band is at the bottom. All 3 bands are 20-wide.` The share note says `across both groups` in lower case. The German notes change the same way.
- A bullet chart that sets `strings.target` now prints the word with a capital letter over its target column and in the band key, as in `Plan`. The gap head keeps the lower-case word inside its sentence, `Gap to plan`.

### Old wording

- Funnel heads, the sankey Other note, pyramid notes and bullet target heads have no option that sets the old words back. The old words are `Step CVR`, `Total CVR`, `Stufen-CVR`, `Gesamt-CVR`, `Others (Channel) includes Display 9, Affiliates 7`, `Bands read [from, to), youngest at the bottom.`, `equally wide`, `BOTH` and a lower-case authored bullet target word such as `plan`.
- The old hover hint comes back with `strings: { moreListed: "and {count} more (hover shows each value)" }`.
