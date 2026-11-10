### Changed

- Series that share a `colorRole` take colour steps that stand further apart. The first series keeps the role's colour. Every two steps now meet the swatch floor (12 OKLab, with the colour-vision floors), so a stacked column, bar, area, funnel, combo or mekko with two or three same-role series no longer warns `series-adjacent-similar` on the theme's own colours. Before, three `good` series on `standard` stood 10.8 apart. Every step also stands clear of the page: a fill 1.4:1 on a light page and 3:1 on a dark page, a line or a small dot 3:1 on any page. Where the page side has no room, the further steps run away from the page: darker on a light page, lighter on a dark page. Fill steps also stay a swatch step from the Others colour. A combo whose columns and lines share a role steps them on one ladder of the role's line colour, so a column and a line no longer land on one colour. The floor holds for up to three series of any role on every preset, and for four or five on most. Above that the steps spread as far apart as the page allows, and the existing warning still fires. Pie slices, one series per role and a series with its own `fill` are unchanged.
- To bring back the earlier look, give each series its own `fill`. Three series took these steps, in order. Two series took the first two, unless the table says otherwise. Lines, slope lines and small dots took the steps in the last column where it differs.

| Preset | Role | Fill steps (bars, areas, cells, large markers) | Line and dot steps |
| --- | --- | --- | --- |
| bridge | good | #1E9A66 #5DB691 #98D1B9 | #147A52 #489778 #79B39C |
| bridge | bad | #D6453F #E27B77 #ECA9A7 | #C8323F #D76973 #E4999F |
| bridge | warn | #F5A800 #F8BF42 #FAD585 (two series: #F5A800 #FAD585) | #876400 #A08536 #BBA76E |
| bridge | neutral | #5A6A97 #7D89AD #9FA9C3 | same |
| bridge | highlight | #1E4FD8 #5076E1 #7D99E8 | same |
| bridge | total | #0B1B3A #283652 #465269 | same |
| bridge-dark | good | #4DBA8C #3E9579 #2F7267 | #3DBD88 #329977 #277666 |
| bridge-dark | bad | #EB8D8A #BC7579 #8F5E69 | #F28983 #C17274 #935C65 |
| bridge-dark | warn | #F5A800 #C98D0B #9C7216 | same |
| bridge-dark | neutral | #9BA7BB #7B889F #5C6982 | same |
| bridge-dark | highlight | #8FA8F0 #7289C8 #566BA2 | same |
| bridge-dark | total | #DCE4FA #B8C2D9 #97A2BB | same |
| boardroom | good | #0FA063 #57BD92 #98D6BC | #0C7B4C #419873 #74B499 |
| boardroom | bad | #E0524E #EA8885 #F2B6B5 | #C13743 #D16B74 #DF979D |
| boardroom | warn | #F5A800 #F8BF42 #FAD585 (two series: #F5A800 #FAD585) | #896600 #A38838 #BDA970 |
| boardroom | neutral | #5E6C7B #7E8995 #A0A8B1 | same |
| boardroom | highlight | #10529E #3D73B0 #6892C2 | same |
| boardroom | total | #12395E #335575 #57728D | same |
| capital | good | #0E9A58 #56B787 #96D1B1 | #0B7845 #40956C #73B090 |
| capital | bad | #D6484F #E27E81 #ECACAB | #B83E44 #C96D70 #D99998 |
| capital | warn | #F5A800 #F7BD3D #F9D17A (two series: #F5A800 #F9D17A) | #866400 #A08536 #BAA66B |
| capital | neutral | #958E87 #B3AEA7 #D3CFC8 | same |
| capital | highlight | #2470C6 #5A93D2 #8CB3DC | same |
| capital | total | #2E346F #4D5283 #6C7097 | same |
| studio | good | #1DB06A #6ACB9B #B0E3C8 | #0B7A49 #419770 #74B396 |
| studio | bad | #E2564A #EB8C83 #F3BBB4 | #C0373F #D06B70 #DE9799 |
| studio | warn | #F5A800 #F8BE40 #FAD480 (two series: #F5A800 #FAD480) | #896600 #A38737 #BDA96E |
| studio | neutral | #8F928E #AFB1AE #D0D1CD | same |
| studio | highlight | #0F7F67 #469C89 #7BB8AA | same |
| studio | total | #24564E #49736B #6E8F89 | same |
| glass | good | #2FC96E #28A35F #227E50 | same |
| glass | bad | #F38179 #C36B68 #965557 | same |
| glass | warn | #EFC53F #C7A63B #A18836 | same |
| glass | neutral | #97A5C4 #7986A1 #5D6880 | same |
| glass | highlight | #C28FD2 #9B74AC #755B88 | same |
| glass | total | #8F9CF2 #737FC5 #58629A | same |
| standard | good | #0FA060 #57BD90 #98D6BB | same |
| standard | bad | #E2564A #EB8C84 #F3BAB5 | same |
| standard | warn | #F5A800 #F8BF42 #FAD585 (two series: #F5A800 #FAD585) | #8F6A00 #A88B38 #C0AC70 |
| standard | neutral | #79828C #99A0A8 #BBBFC4 | same |
| standard | highlight | #10529E #3D73B0 #6892C2 | same |
| standard | total | #10529E #3D73B0 #6892C2 | same |
| standard-dark | good | #49B786 #3B9370 #2E705B | same |
| standard-dark | bad | #EB8980 #BD726D #905B5B | same |
| standard-dark | warn | #F2C14E #C9A347 #A08540 | same |
| standard-dark | neutral | #A9B5C0 #8A96A1 #6B7782 | same |
| standard-dark | highlight | #67A9EA #5388BD #406A94 | same |
| standard-dark | total | #67A9EA #5388BD #406A94 | same |
| notation | good | #0FA060 #57BD90 #98D6BB | #0C7B4A #419872 #74B498 |
| notation | bad | #E2564A #EB8C84 #F3BAB5 | #C13743 #D16B74 #DF979D |
| notation | warn | #F5A800 #F8BF42 #FAD585 (two series: #F5A800 #FAD585) | #896600 #A38838 #BDA970 |
| notation | neutral | #939393 #B2B2B2 #D2D2D2 | same |
| notation | highlight | #2A6CBA #598CC9 #86ABD8 | same |
| notation | total | #404040 #5D5D5D #7B7B7B | same |
| notation-dark | good | #31AD76 #298B5F #206949 (two series: #31AD76 #288A5F) | same |
| notation-dark | bad | #E8786E #B96059 #8C4A44 | same |
| notation-dark | warn | #F2C14E #CAA242 #A58437 | same |
| notation-dark | neutral | #D5D5D5 #B4B4B4 #959595 | same |
| notation-dark | highlight | #64A9F3 #5289C4 #406A97 | same |
| notation-dark | total | #ACACAC #8D8D8D #6F6F6F | same |
