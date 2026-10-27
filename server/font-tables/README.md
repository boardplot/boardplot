# Font tables for Claude Slides

`claude-slides-font-tables.json` holds metric tables (advance widths and vertical metrics in 1/1000 em) for the text faces of the Claude Slides artifact type. The server passes the file with `--font-tables` (or `BOARDPLOT_FONT_TABLES`), so a chart exported for a slide is measured in the deck font. The file holds no glyph data and no font file. It is not part of the npm package.

| Family in the table | Source font | Weights |
|---|---|---|
| DM Sans | Google Fonts css2 `family=DM+Sans:wght@<weights>` (dmsans v17), one static TTF per weight | 100 to 900 |
| Nunito Sans | Google Fonts css2 `family=Nunito+Sans:wght@<weights>` (nunitosans v19), one static TTF per weight | 200 to 900 |
| Source Serif 4 | Google Fonts css2 `family=Source+Serif+4:wght@<weights>` (sourceserif4 v15), one static TTF per weight | 200 to 900 |
| IBM Plex Sans | `ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf` | 100 to 700 |
| Public Sans | `ofl/publicsans/PublicSans[wght].ttf` | 100 to 900 |
| Rubik | `ofl/rubik/Rubik[wght].ttf` | 300 to 900 |
| EB Garamond | `ofl/ebgaramond/EBGaramond[wght].ttf` | 400 to 800 |
| Libre Baskerville | `ofl/librebaskerville/LibreBaskerville[wght].ttf` | 400 to 700 |
| Times New Roman | Liberation Serif 2.1.5 Regular and Bold | 400, 700 |
| Courier New | Liberation Mono 2.1.5 Regular and Bold | 400, 700 |

The `ofl/` files come from the `google/fonts` repository at commit `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`; the Liberation files from `liberation-fonts-ttf-2.1.5.tar.gz`. Each face in the file records its source file and SHA-256. Liberation Serif and Liberation Mono have the widths of Times New Roman and Courier New, so their tables carry those names, as the bundled Helvetica rows carry the widths of Liberation Sans.

Verdana, Tahoma, Trebuchet MS and Georgia have no table here: no suitable open-licence substitute was identified. A deck in one of them is measured with the first tabled family in the font stack, and the export reports `font.measured: "fallback"`.

## Optical size

DM Sans, Nunito Sans and Source Serif 4 have an optical-size axis (`opsz`). A css2 link without `opsz`, such as `family=Source+Serif+4:wght@400;700`, serves an instance whose optical size can differ from the default of the variable file in `google/fonts`: Source Serif 4 draws `%` at 932 units from the plain link and at 880 from the file's default instance. So these three families are tabled from the files the plain link serves, and a deck loads them with the plain link, without `opsz`. A link that pins `opsz` draws other widths than these tables.

## Build

1. Put each family's font files in its own folder under one directory. For DM Sans, Nunito Sans and Source Serif 4, download the TTF of each weight that `https://fonts.googleapis.com/css2?family=<family>:wght@<weights>` lists when it is fetched without a browser user agent.
2. Run `boardplot fonts build <dir> -o claude-slides-font-tables.json` with a Boardplot that writes a negative advance as 0. Older builds wrote the soft hyphen of some variable faces as about 65 em.
3. Rename the families to the names a deck uses, and give each static file the weight it was served for. `boardplot fonts build` names a face by its name-table family (name ID 1) and weight class: `DM Sans Black` becomes `DM Sans`, `Public Sans Thin` becomes `Public Sans`, `Rubik Light` becomes `Rubik`, and a served 100 or 200 file that declares weight class 250 gets its served weight. `Liberation Serif` becomes `Times New Roman` and `Liberation Mono` becomes `Courier New`.

## Check

Run on 2026-10-25: headless Chromium drew 20 code points (`A a W m g 0 1 4 % & ? , . – € ß é R Q @`) at weights 400 and 700 from the plain css2 link of each of the eight Google families, digits with `tabular-nums` (the builder tables digits at their tabular advance). Every drawn advance is within 1.3 units in 1000 of the table.

## Licence

The source fonts are licensed under the SIL Open Font License 1.1 (`OFL.txt`). Copyright:

- DM Sans: Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)
- IBM Plex Sans: Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
- Public Sans: Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)
- Nunito Sans: Copyright 2016 The Nunito Sans Project Authors (https://github.com/Fonthausen/NunitoSans)
- Rubik: Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik)
- EB Garamond: Copyright 2017 The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12)
- Libre Baskerville: Copyright 2012 The Libre Baskerville Project Authors (https://github.com/impallari/Libre-Baskerville) with Reserved Font Name Libre Baskerville.
- Source Serif 4: Copyright 2014 The Source Serif 4 Project Authors (https://github.com/adobe-fonts/source-serif)
- Liberation Serif and Liberation Mono: Digitized data copyright (c) 2010 Google Corporation with Reserved Font Arimo, Tinos and Cousine. Copyright (c) 2012 Red Hat, Inc. with Reserved Font Name Liberation.
