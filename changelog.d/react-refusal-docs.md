### Fixed

- The React reference named a refusal text that the size card no longer shows ("This chart needs at least {width} × {height} px."). It now names the text the card shows, "This chart needs more room." with the hint "Widen the panel or turn your device.", and says that `onRefused` keeps the console quiet. It also says what a host must do when it grows a chart to its minimum width after a refusal: a 360 px wide chart in a frame grown to 360 px inside a 320 px slot is cut off unless it scrolls sideways and shows that it scrolls.
