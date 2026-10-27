# Notice

Boardplot
Copyright 2026 Hans Ritschl

Licensed under the Apache License, Version 2.0. See `LICENSE`.

Boardplot distributes pre-baked, simplified map coordinate packs built
from the third-party data below. Runtime code does not download or project
geographic data. Each pack carries a licence credit (`meta.credit`) beside its
full attribution (`meta.attribution`). A required credit prints under the
chart's source line on every render target, survives `footnotes: false`, and
is linked in the React footer. A credit that is not required goes to the notes
list that every render returns.

## Germany — Bundesländer

- Pack: `de-states`
- Source: Bundesamt für Kartographie und Geodäsie (BKG), VG2500 Länder,
  snapshot 31 December 2024
- Source archive:
  `https://daten.gdz.bkg.bund.de/produkte/vg/vg2500/2024/vg2500_12-31.utm32s.shape.zip`
- License: Datenlizenz Deutschland – Namensnennung – Version 2.0
  (`dl-de/by-2-0`)
- Required rendered credit (dl-de/by-2-0 §2 and §3, BKG VG2500 terms of
  30 June 2025: clearly visible on every public reproduction; on a web page
  "BKG" and "dl-de/by-2-0" are linked):
  `© BKG (2026) dl-de/by-2-0 (data changed), Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf`
  Links: "BKG" → https://www.bkg.bund.de, "dl-de/by-2-0" →
  https://www.govdata.de/dl-de/by-2-0, "Datenquellen" → the PDF above.
- Year: BKG asks for the year of the last data download. The repository records
  no download date; the pack was first baked on 2026-07-24 and re-baked on
  2026-08-10 against the sha256-pinned archive, so the credit names 2026. The
  data snapshot is 31 December 2024.
- Change notice: "(data changed)" in the credit; the detail is below and in
  the pack's attribution: filtered, preprojected, simplified, quantized.
- Modifications: Länder records selected and grouped by AGS, transformed from
  ETRS89 / UTM zone 32N to an EPSG:3035-equivalent Lambert azimuthal
  equal-area coordinate space, topology-built, simplified, quantized, and
  label-anchor enriched.

## EU-27

- Pack: `eu27`
- Source: Natural Earth Admin-0 Countries 1:50m, version 5.1.1
- Source archive:
  `https://naturalearth.s3.amazonaws.com/5.1.1/50m_cultural/ne_50m_admin_0_countries.zip`
- License: public domain
- Selection: EU member selection as of 24 July 2026, effective membership set
  since 1 February 2020; this is not official EU geometry. The pack retains
  European land components within the committed longitude/latitude bounds
  and does not create outermost-region insets.
- Worldview: Natural Earth de facto
- Credit (not required, public domain; goes to the notes list):
  `Natural Earth v5.1.1 (public domain); EU member selection as of 2026-07-24; modified by Boardplot.`
- Border note (pack meta and docs, not drawn): "Borders follow the EU view; Cyprus is shown whole."
- Modifications: selected by the committed dated ISO alpha-2 table,
  preprojected to an EPSG:3035-equivalent Lambert azimuthal equal-area
  coordinate space, topology-built, simplified, quantized, and label-anchor
  enriched.

## DACH

- Pack: `dach`
- Source: Natural Earth Admin-0 Countries 1:10m, version 5.1.1
- Source archive:
  `https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_countries.zip`
- License: public domain
- Selection: Austria, Germany, and Switzerland
- Worldview: Natural Earth de facto
- Credit (not required, public domain; goes to the notes list):
  `Natural Earth v5.1.1 (public domain); modified by Boardplot: filtered, preprojected, simplified, quantized.`
- Modifications: filtered, preprojected to an EPSG:3035-equivalent Lambert
  azimuthal equal-area coordinate space, topology-built, simplified,
  quantized, and label-anchor enriched.

## Europe

- Pack: `europe`
- Source: Natural Earth Admin-0 Countries 1:10m, version 5.1.1, point of view
  Germany (`_deu` variant)
- Source archive:
  `https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_countries_deu.zip`
- License: public domain
- Selection: Europe member selection as of 9 October 2026, from the committed
  table `reference/geo/europe-members-2026-10-09.json`: the EU27, CH, NO, IS,
  GB, LI, AD, MC, SM, VA, AL, BA, ME, MK, RS, XK, UA, BY, MD, GI, JE, GG, IM,
  FO and AX. A member that draws under 8 px² is a marker. RU, TR, GE, AM and
  AZ are not in the pack. Overseas parts are cut by a longitude and latitude
  window. The whole island of Cyprus is CY (Northern Cyprus, the UN buffer
  zone and the base areas join it), as in `eu27`.
- Worldview: Natural Earth, point of view Germany (EU view). Border note (pack
  meta and docs, not drawn): "Borders follow the EU view; Crimea is shown as part
  of Ukraine; Cyprus is shown whole." The
  point of view is one constant (`EUROPE_POV`) in `scripts/build-geo-packs.mjs`.
- Credit (not required, public domain; goes to the notes list):
  `Natural Earth v5.1.1 (public domain); Europe member selection as of 2026-10-09; modified by Boardplot.`
- Modifications: filtered, preprojected to an EPSG:3035-equivalent Lambert
  azimuthal equal-area coordinate space, topology-built, simplified to the
  vertex density of the `eu27` pack (limit 5 px at 800 px), quantized, and
  label-anchor enriched.

## World

- Pack: `world`
- Source: Natural Earth Admin-0 Countries, Admin-0 tiny countries and Admin-0
  land boundary lines, 1:110m, version 5.1.1
- License: public domain
- Worldview: Natural Earth de facto
- Credit (not required, public domain; goes to the notes list with the
  endorsement line, a product choice rather than a licence duty):
  `Natural Earth v5.1.1 (public domain); modified by Boardplot. Boundaries and names shown do not imply official endorsement.`
- Border note (pack meta and docs, not drawn): Crimea is shown as part of Ukraine; other borders follow Natural Earth's de facto view.
- Since 0.28.0 the pack also holds 36 small places (Hong Kong, Macau,
  Gibraltar, Monaco and others) as marker-only regions. Their label points
  come from the 1:10m file `ne_10m_admin_0_countries.zip`.
- Modifications: preprojected, topology-built, simplified, quantized, and
  label-anchor enriched. The ring that Natural Earth lists under Russia for
  Crimea is assigned to Ukraine, unchanged.

## US states

- Pack: `us-states`
- Source: US Census Bureau 2025 Cartographic Boundary Files, states, 1:5m
- License: public domain (US government work)
- Required rendered credit (the file metadata asks to acknowledge the Census
  Bureau): `Map: U.S. Census Bureau (2025)`. Full attribution in the pack:
  `US Census Bureau 2025 Cartographic Boundary Files (1:5m); modified by Boardplot. Alaska and Hawaii insets use non-comparable scales.`
- Modifications: preprojected with Alaska and Hawaii insets at their own
  scales, topology-built, simplified, quantized, and label-anchor enriched.

## Tile layouts

The `eu27`, `europe`, `world` and `us-states` tilemap layouts are Boardplot'
own coordinate layouts and carry no third-party data.

## Source archives

The repository does not carry the source archives. `scripts/build-geo-packs.mjs`
downloads a missing archive into `reference/geo/` (ignored by git) from the URL
below and refuses it unless its SHA-256 matches. The same URLs and digests are
pinned in the script's `SOURCES` table; a change to one needs the same change
to the other.

| Archive | Packs | URL | SHA-256 |
|---|---|---|---|
| `vg2500_12-31.utm32s.shape.zip` | `de-states` | https://daten.gdz.bkg.bund.de/produkte/vg/vg2500/2024/vg2500_12-31.utm32s.shape.zip | `c66883a566907c17ae5fd8cc2006d7e2e9c6c2303e80ffa9c46df604de3ad010` |
| `ne_50m_admin_0_countries.zip` | `eu27` | https://naturalearth.s3.amazonaws.com/5.1.1/50m_cultural/ne_50m_admin_0_countries.zip | `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139` |
| `ne_10m_admin_0_countries.zip` | `dach`, `world` | https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_countries.zip | `ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6` |
| `ne_10m_admin_0_countries_deu.zip` | `europe` | https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_countries_deu.zip | `125fc4b1f425926b8bd22dce23af6f9f873543c2fe330915ccbe0aa7fa21ff82` |
| `ne_110m_admin_0_countries.zip` | `world` | https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_countries.zip | `0f243aeac8ac6cf26f0417285b0bd33ac47f1b5bdb719fd3e0df37d03ea37110` |
| `ne_110m_admin_0_tiny_countries.zip` | `world` | https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_tiny_countries.zip | `076ae0cd04648c22756f574d4c3889266ea779593e717ab5e17b8ff06700d2a0` |
| `ne_110m_admin_0_boundary_lines_land.zip` | `world` | https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_boundary_lines_land.zip | `bb2954981570498a4b4344f8e83fa54caa5858e15e800094112407d2bd2f940d` |
| `cb_2025_us_state_5m.zip` | `us-states` | https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_5m.zip | `8a45692bc532dbd38938a1924f445850cef2682ea67d750d7fd2f19cfe836903` |

`node scripts/build-geo-packs.mjs --check` downloads what is missing, bakes
every pack twice and fails when the committed packs under `src/core/geo/`
differ from the bake. Projection parameters, quantization, pack revisions and
generated pack hashes are pinned in the same script.

## Font width tables

`src/core/fontMetrics/tables.generated.ts` holds advance widths and vertical
metrics in 1/1000 em, written by `scripts/build-font-metrics.mjs`. No font
file is bundled.

- Helvetica and Arial rows: Liberation Sans 2.1.5 Regular and
  Bold (`LiberationSans-Regular.ttf`, `LiberationSans-Bold.ttf`), as
  LibreOffice ships them. Licence: SIL Open Font License 1.1
  (https://openfontlicense.org). Copyright (c) 2012 Red Hat, Inc.; Digitized
  data copyright (c) 2010 Google Corporation.
- Helvetica Neue: no rows. No free Helvetica Neue font exists, so text set
  in Helvetica Neue is measured with the Helvetica rows (Liberation Sans
  2.1.5). No width data measured from a Helvetica Neue font is bundled.
- Geist rows: Geist from `@fontsource/geist`. Licence: SIL Open Font License 1.1.
- Arrow fallback widths (U+2197, U+2198): STIXGeneral 1.1.0. Licence: STIX
  Font License of 24 May 2010, which licenses the fonts under the SIL Open
  Font License 1.1. Copyright (c) 2001-2011 by the STI Pub Companies;
  portions copyright (c) 1998-2003 by MicroPress, Inc.; portions copyright
  (c) 1990 by Elsevier, Inc. Full text in `THIRD_PARTY_NOTICES.md`.
