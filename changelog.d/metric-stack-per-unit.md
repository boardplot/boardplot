### Added

- A metric stack panel can show an amount per unit, such as cost per order: `measure: { "ratio": ["spend"], "per": "orders" }`. Each category shows its spend divided by its orders. A window divides its summed spend by its summed orders, so spend 100 and 300 on 10 and 20 orders reads 13.33 per order, not 12.5, the average of the two months. The change readout is the percent change of the two window values, and the reading names it `ratio-change`.
