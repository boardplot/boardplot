### Fixed

- The `format-unscaled` warning prints its figure with the chart's marks ("2.345.678" under `locale.thousands: "."`), not the example's ("2,345,678").
- Where `options.unit` names the scale that the format also applies ("$B" with "+$1.0B"), `format-hides-values` says the values are already in that scale and its fix drops the scale from the format ("+$1.0"). It advised a nine-decimal "+$1.123456789B".
