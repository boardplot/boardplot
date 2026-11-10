### Fixed

- Box and histogram quantiles (median, quartiles, p10 and p90 whiskers) and their interquartile range no longer carry binary float residue. Before, a median between −75 and 73.9 printed `−$0.550000000000004k` in the hover card and the accessible text. The drawn labels were already rounded. A box edge can move by up to 0.01 px.
- A Likert sample size summed from counts no longer carries float residue. Before, the hover card printed `Sample size: 0.8999999999999999`.
