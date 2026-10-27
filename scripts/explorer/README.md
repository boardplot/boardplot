# Boardplot Variant Explorer

A static page that shows every registered chart type and variant, renders each one at 960, 720, 480, 400 and 320 px, and copies card IDs, specs and review prompts. It runs the real CLI render path in the browser.

## Commands

- `npm run explorer` builds `artifacts/explorer/`: `index.html`, `boardplot.js` (browser bundle), `catalog.json` (variants and settings) and `after/` (redesigns). Serve the folder to open the page.
- `npm run -s explorer -- --spec <id> [<id> ...]` prints the exact spec that "Copy spec" copies for each card ID. `--spec -` reads the list that "Copy selection" copies from stdin. It writes no files.
- Render a card to PNG: `npm run -s explorer -- --spec <id> | npx tsx src/cli/index.ts render - --format png --out <dir>`.

## Files

- `variants.mjs`: the hand-written variant list for each type, and the option keys that never become settings.
- `build.mjs`: the generator. Settings come from the Zod schemas; settings that never change the SVG are dropped.
- `cardspec.mjs`: card IDs and specs, shared by the page and `--spec`.
- `index.html`: the page. Its "How to use" section explains the controls.

## Card IDs

`chart[/key=value+key=value]/width/theme/locale`, for example `bar.stacked/labels=engine-default/720/authored/en`. `chart` is the public chart ID: `type.variant`, or the type alone for a one-form type (`box/720/authored/en`). Only the settings you chose appear in the ID. `engine-default` means that the option is left out.

## Redesigns (before / after)

1. Put the image (PNG or SVG, at the card's width) in `after/`.
2. Map the card ID to the file name in `after/index.json`, for example `{"dot.dot/480/authored/en": "dot-480.png"}`.
3. Run `npm run explorer` again.

The match uses the exact card ID. A card without a redesign shows "No redesign yet" on the after side.
