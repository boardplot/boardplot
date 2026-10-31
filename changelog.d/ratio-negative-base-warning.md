### Fixed

- A table calc or a dimswitch measure that divides by a negative number now warns `ratio-negative-base` at severity info. A margin on a credit-note row with negative revenue, or a multiple of a negative EBITDA, prints as plain arithmetic, for example 11.8% for -2 over -17, while a `percentDelta` calc prints n.m. off a negative base. The number and the look stay as they were. The warning comes once per computed column or calc row in a table and once per measure in a dimswitch, and names the first row or member. A literal divisor does not warn.
