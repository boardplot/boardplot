### Fixed

- A waffle in full mode that draws at a width now draws at every wider width. Before, full mode chose its panel columns by the label words alone, so a wider canvas could pick more columns whose cells needed far more room, and the chart was refused (for example, drawn at 731 px, refused from 732 to 951 px). Where those columns would refuse the width, the waffle now takes the most columns whose cells fit, as compact mode does. A waffle that drew before keeps its look.
