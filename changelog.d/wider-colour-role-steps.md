### Changed

- Series that share a `colorRole` take colour steps that stand further apart and run one way, strongest first. Every two steps now meet the swatch floor (12 OKLab, with the colour-vision floors), so a stacked column, bar, area, funnel, combo or mekko with two or three same-role series no longer warns `series-adjacent-similar` on the theme's own colours. Before, three `good` series on `standard` stood 10.8 apart. Every step also stands clear of the page: a fill 1.4:1 on a light page and 3:1 on a dark page, a line or a small dot 3:1 on any page. The role's colour is always one of the steps. Where the page side has no room, further steps run away from the page: darker on a light page, lighter on a dark page. Series 1 takes the strongest step and the last series the step nearest the page, so series 1 no longer always takes the role's colour. Fill steps also stay a swatch step from the Others colour. A combo whose columns and lines share a role, a scatter whose groups of one role mix small dots and large markers, and an area chart whose filled lead shares a role with the other lines take one ladder of the role's line colour, so two series never land on one colour. The floor holds for up to three series of any role on every preset, and for four or five on most. Above that the steps spread evenly over the visible range, and the existing warning still fires. Pie slices, one series per role and a series with its own `fill` are unchanged.
- To bring back the earlier look, give each series its own `fill`. The table lists the steps of three series in series order, before and after. Two series take the first two, unless the table says otherwise. Lines, slope lines and small dots take the line-and-dot steps where they differ from the fill steps.

| Preset | Role | Before: fill steps | Before: line and dot steps | After: fill steps | After: line and dot steps |
| --- | --- | --- | --- | --- | --- |
| bridge | good | #1E9A66 #5DB691 #98D1B9 | #147A52 #489778 #79B39C | #156C47 #1E9A66 #71BF9F (two: #1E9A66 #71BF9F) | #0D4E34 #147A52 #58A184 (two: #147A52 #58A184) |
| bridge | bad | #D6453F #E27B77 #ECA9A7 | #C8323F #D76973 #E4999F | #96302C #D6453F #E48682 (two: #D6453F #E48682) | #88222B #C8323F #DA767E (two: #C8323F #DA767E) |
| bridge | warn | #F5A800 #F8BF42 #FAD585 (two: #F5A800 #FAD585) | #876400 #A08536 #BBA76E | #875C00 #BD8100 #F5A800 (two: #BD8100 #F5A800) | #564000 #876400 #AA914A (two: #876400 #AA914A) |
| bridge | neutral | #5A6A97 #7D89AD #9FA9C3 | same | #5A6A97 #828EB0 #ABB3CA (two: #5A6A97 #8894B4) | #3A4461 #5A6A97 #8894B4 (two: #5A6A97 #8894B4) |
| bridge | highlight | #1E4FD8 #5076E1 #7D99E8 | same | #1E4FD8 #5B7FE3 #93ABEC | #14338C #1E4FD8 #5B7FE3 (two: #1E4FD8 #5B7FE3) |
| bridge | total | #0B1B3A #283652 #465269 | same | #0B1B3A #323F5A #5C667B | same |
| bridge-dark | good | #4DBA8C #3E9579 #2F7267 | #3DBD88 #329977 #277666 | #86D0B1 #2EAE78 #237F64 (two: #2EAE78 #237F64) | #9ADDC1 #3DBD88 #2E8C71 (two: #3DBD88 #2E8C71) |
| bridge-dark | bad | #EB8D8A #BC7579 #8F5E69 | #F28983 #C17274 #935C65 | #F6CBCA #EB928F #E0524E (two: #EB928F #E0524E) | #F7B6B3 #F07A74 #AE5E63 (two: #F07A74 #AE5E63) |
| bridge-dark | warn | #F5A800 #C98D0B #9C7216 | same | #F5A800 #BB850F #85641C (two: #F5A800 #B8830F) | same |
| bridge-dark | neutral | #9BA7BB #7B889F #5C6982 | same | #D3D9E2 #A7B1C3 #7B8BA6 (two: #ACB6C7 #7B8BA6) | same |
| bridge-dark | highlight | #8FA8F0 #7289C8 #566BA2 | same | #DDE5FB #ADBFF4 #8098DC (two: #C7D4F8 #8FA8F0) | #C7D4F8 #8FA8F0 #677EB9 (two: #8FA8F0 #677EB9) |
| bridge-dark | total | #DCE4FA #B8C2D9 #97A2BB | same | #DCE4FA #AEB8D0 #828EA7 (two: #DCE4FA #ACB6CE) | #DCE4FA #ACB6CE #7E8AA4 |
| boardroom | good | #0FA063 #57BD92 #98D6BC | #0C7B4C #419873 #74B499 | #0B7045 #0FA063 #6DC5A0 (two: #0FA063 #6DC5A0) | #084F31 #0C7B4C #55A382 (two: #0C7B4C #55A382) |
| boardroom | bad | #E0524E #EA8885 #F2B6B5 | #C13743 #D16B74 #DF979D | #9F3A37 #E0524E #EB928F (two: #E0524E #EB928F) | #81252D #C13743 #D5777F (two: #C13743 #D5777F) |
| boardroom | warn | #F5A800 #F8BF42 #FAD585 (two: #F5A800 #FAD585) | #896600 #A38838 #BDA970 | #875C00 #BD8100 #F5A800 (two: #BD8100 #F5A800) | #5A4300 #896600 #AB924A (two: #896600 #AB924A) |
| boardroom | neutral | #5E6C7B #7E8995 #A0A8B1 | same | #3B444D #5E6C7B #8B95A0 (two: #5E6C7B #8B95A0) | same |
| boardroom | highlight | #10529E #3D73B0 #6892C2 | same | #10529E #4C7DB6 #85A7CE | #09305D #10529E #4C7DB6 (two: #10529E #4C7DB6) |
| boardroom | total | #12395E #335575 #57728D | same | #12395E #41617E #738AA0 | same |
| capital | good | #0E9A58 #56B787 #96D1B1 | #0B7845 #40956C #73B090 | #0A6C3E #0E9A58 #69BF93 (two: #0E9A58 #69BF93) | #074C2B #0B7845 #549F7A (two: #0B7845 #549F7A) |
| capital | bad | #D6484F #E27E81 #ECACAB | #B83E44 #C96D70 #D99998 | #963237 #D6484F #E48A8C (two: #D6484F #E48A8C) | #79292D #B83E44 #CE7A7C (two: #B83E44 #CE7A7C) |
| capital | warn | #F5A800 #F7BD3D #F9D17A (two: #F5A800 #F9D17A) | #866400 #A08536 #BAA66B | #875C00 #BD8100 #F5A800 (two: #BD8100 #F5A800) | #584200 #866400 #A78E44 (two: #866400 #A78E44) |
| capital | neutral | #958E87 #B3AEA7 #D3CFC8 | same | #423E3B #6A6560 #958E87 (two: #6A6560 #958E87) | same |
| capital | highlight | #2470C6 #5A93D2 #8CB3DC | same | #184A83 #2470C6 #679BD4 (two: #2470C6 #679BD4) | #0D2847 #184A83 #2470C6 (two: #184A83 #2470C6) |
| capital | total | #2E346F #4D5283 #6C7097 | same | #2E346F #595E8B #8588A7 | same |
| studio | good | #1DB06A #6ACB9B #B0E3C8 | #0B7A49 #419770 #74B396 | #15824E #1DB06A #7CD1A7 (two: #1DB06A #7CD1A7) | #074E2F #0B7A49 #54A27E (two: #0B7A49 #54A27E) |
| studio | bad | #E2564A #EB8C83 #F3BBB4 | #C0373F #D06B70 #DE9799 | #A33E35 #E2564A #ED968D (two: #E2564A #ED968D) | #81252A #C0373F #D4777B (two: #C0373F #D4777B) |
| studio | warn | #F5A800 #F8BE40 #FAD480 (two: #F5A800 #FAD480) | #896600 #A38737 #BDA96E | #875C00 #BD8100 #F5A800 (two: #BD8100 #F5A800) | #5A4300 #896600 #AB9249 (two: #896600 #AB9249) |
| studio | neutral | #8F928E #AFB1AE #D0D1CD | same | #3F403E #666865 #8F928E (two: #666865 #8F928E) | same |
| studio | highlight | #0F7F67 #469C89 #7BB8AA | same | #0F7F67 #50A18F #8CC1B4 (two: #0F7F67 #5CA896) | #0B5948 #0F7F67 #50A18F (two: #0F7F67 #50A18F) |
| studio | total | #24564E #49736B #6E8F89 | same | #24564E #567D76 #8BA59F | #132D29 #24564E #567D76 (two: #24564E #567D76) |
| glass | good | #2FC96E #28A35F #227E50 | same | #2FC96E #279C5C #1F714B (two: #2FC96E #26975A) | same |
| glass | bad | #F38179 #C36B68 #965557 | same | #F6A49F #F0655C #AD4D4C (two: #F0655C #AD4D4C) | same |
| glass | warn | #EFC53F #C7A63B #A18836 | same | #EFC53F #B99B39 #867333 | same |
| glass | neutral | #97A5C4 #7986A1 #5D6880 | same | #CAD1E1 #97A5C4 #6E7A95 (two: #97A5C4 #6E7A95) | same |
| glass | highlight | #C28FD2 #9B74AC #755B88 | same | #C798D6 #AE69C3 #805195 (two: #AE69C3 #805195) | same |
| glass | total | #8F9CF2 #737FC5 #58629A | same | #C2C9F8 #8F9CF2 #5B6DEC (two: #8F9CF2 #5B6DEC) | same |
| standard | good | #0FA060 #57BD90 #98D6BB | same | #0B7043 #0FA060 #6DC59E (two: #0FA060 #6DC59E) | #064328 #0B7043 #0FA060 (two: #0B7043 #0FA060) |
| standard | bad | #E2564A #EB8C84 #F3BAB5 | same | #A33E35 #E2564A #ED958D (two: #E2564A #ED958D) | #662721 #A33E35 #E2564A (two: #A33E35 #E2564A) |
| standard | warn | #F5A800 #F8BF42 #FAD585 (two: #F5A800 #FAD585) | #8F6A00 #A88B38 #C0AC70 | #875C00 #BD8100 #F5A800 (two: #BD8100 #F5A800) | #644A00 #8F6A00 #AD9245 (two: #8F6A00 #AD9245) |
| standard | neutral | #79828C #99A0A8 #BBBFC4 | same | #52585F #79828C #A7ADB3 (two: #79828C #A7ADB3) | #2E3135 #52585F #79828C (two: #52585F #79828C) |
| standard | highlight | #10529E #3D73B0 #6892C2 | same | #10529E #4C7DB6 #85A7CE | #09305D #10529E #4C7DB6 (two: #10529E #4C7DB6) |
| standard | total | #10529E #3D73B0 #6892C2 | same | #10529E #4C7DB6 #85A7CE | #09305D #10529E #4C7DB6 (two: #10529E #4C7DB6) |
| standard-dark | good | #49B786 #3B9370 #2E705B | same | #65C299 #0FA060 #0F744D (two: #0FA060 #0F744D) | same |
| standard-dark | bad | #EB8980 #BD726D #905B5B | same | #EC8E86 #E2564A #A94640 (two: #E2564A #A94640) | same |
| standard-dark | warn | #F2C14E #C9A347 #A08540 | same | #F2C14E #B99744 #826F3A | same |
| standard-dark | neutral | #A9B5C0 #8A96A1 #6B7782 | same | #A9B5C0 #828E9A #5D6975 (two: #A9B5C0 #7C8893) | same |
| standard-dark | highlight | #67A9EA #5388BD #406A94 | same | #ADD1F4 #67A9EA #4C7EAF (two: #67A9EA #4C7EAF) | same |
| standard-dark | total | #67A9EA #5388BD #406A94 | same | #ADD1F4 #67A9EA #4C7EAF (two: #67A9EA #4C7EAF) | same |
| notation | good | #0FA060 #57BD90 #98D6BB | #0C7B4A #419872 #74B498 | #0B7043 #0FA060 #6DC59E (two: #0FA060 #6DC59E) | #084F2F #0C7B4A #55A380 (two: #0C7B4A #55A380) |
| notation | bad | #E2564A #EB8C84 #F3BAB5 | #C13743 #D16B74 #DF979D | #A33E35 #E2564A #ED958D (two: #E2564A #ED958D) | #81252D #C13743 #D5777F (two: #C13743 #D5777F) |
| notation | warn | #F5A800 #F8BF42 #FAD585 (two: #F5A800 #FAD585) | #896600 #A38838 #BDA970 | #875C00 #BD8100 #F5A800 (two: #BD8100 #F5A800) | #5A4300 #896600 #AB924A (two: #896600 #AB924A) |
| notation | neutral | #939393 #B2B2B2 #D2D2D2 | same | #414141 #686868 #939393 (two: #686868 #939393) | same |
| notation | highlight | #2A6CBA #598CC9 #86ABD8 | same | #2A6CBA #6494CD #9BBADF (two: #2A6CBA #6897CE) | #1B4679 #2A6CBA #6897CE (two: #2A6CBA #6897CE) |
| notation | total | #404040 #5D5D5D #7B7B7B | same | #404040 #686868 #929292 | same |
| notation-dark | good | #31AD76 #298B5F #206949 (two: #31AD76 #288A5F) | same | #6DC59E #0FA060 #0D7145 (two: #0FA060 #0D7145) | same |
| notation-dark | bad | #E8786E #B96059 #8C4A44 | same | #ED958D #E2564A #A13F36 (two: #E2564A #A13F36) | same |
| notation-dark | warn | #F2C14E #CAA242 #A58437 | same | #F2C14E #BC963E #896E2F | same |
| notation-dark | neutral | #D5D5D5 #B4B4B4 #959595 | same | #D5D5D5 #A8A8A8 #7D7D7D | same |
| notation-dark | highlight | #64A9F3 #5289C4 #406A97 | same | #64A9F3 #4F84BD #3B6189 (two: #64A9F3 #4B7EB4) | same |
| notation-dark | total | #ACACAC #8D8D8D #6F6F6F | same | #ACACAC #838383 #5D5D5D (two: #ACACAC #818181) | same |
