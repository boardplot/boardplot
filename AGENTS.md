# Boardplot, guide for contributors and coding agents

This file is for people and coding agents who change Boardplot. [CONTRIBUTING.md](CONTRIBUTING.md) has the short version.

## Product invariants

- Layout and SVG output are deterministic: identical input produces byte-identical output.
- Layout owns geometry. Renderers do not invent positioning.
- Visible text uses the label solver and theme tokens. Chart code does not introduce ad-hoc hex colours.
- A colour choice that depends on theme colours (which ramp step, which grey stays apart from another paint) is never made at layout time: a light-to-dark repaint keeps the layout and would keep the light choice. Put it in a paint recipe that decides again in the active theme (`stack-apart`, waterfall's `segment-apart`). `tests/theme-paint-recipes.test.ts` catches a layout-time choice.
- Derived values are computed from data. Number formatting uses the shared format helpers.
- A new public option updates its schema, its TypeScript type, the docs and at least one representative fixture.
- A retired option, theme key or value is accepted for good. A rename maps to its successor, and a removal is ignored. Both warn `option-deprecated` with a fix. Only a key that never existed is refused. Each retired setting has one entry in `src/core/retired.ts`.
- A change of a visual default lists the old values in its CHANGELOG entry, as a theme or option patch that brings back the old look.

## Git and security

- Preserve unrelated changes. Stage explicit files only.
- Never commit secrets, credentials, private notes, dumps or local environment files.
- Keep a pull request to one fix or one feature.

## Local checks

CI runs the typecheck, the full test suite, the build and the package check on every pull request. Do not repeat all of it locally.

Before you open a pull request that changes code, run once:

- `npm run typecheck`. The compiler rechecks changed inputs and keeps its graph in the ignored `node_modules/.cache`.
- The test files of the area you changed: `npx vitest run <files>`. Add `tests/golden-svg.test.ts` when the change can affect chart output.
- `npm run docs:build` when you change documentation or its generator. Check that it leaves no unexpected diff.
- `npm run smoke:package` only for packaging or bundle changes. It builds through `npm pack`, so do not build first.

`npm run check:ci` checks the manual's code blocks, documentation anchors, font metrics, generated chart entries, choropleth fixtures and discovery size limits. It needs a build; reuse the build from the package smoke if you just ran it.

While you edit, run only the affected test files and reproduce the problem you fix. For a change to documentation or contributor text only, review the diff; no build or product tests are needed.

Vitest's default reporter hides `console.log` of a passing test. For debug output in an ad-hoc test, run it with `--silent=false` or write to a file.

## Looking at a fixture

- Render one fixture to PNG from source: `npx tsx src/cli/index.ts fixtures --type <t> --id <id> --kind all | jq '.fixtures[0].spec' | npx tsx src/cli/index.ts render - --format png --out <dir>` writes `<dir>/chart.png`.
- `npm run gallery` draws every fixture of every chart type for review by eye and writes a static site to `artifacts/gallery/`. It reuses the built `dist/`, so run `npm run build` first. `npm run gallery -- --types line,table` builds only those type pages. Open `artifacts/gallery/index.html`; the pages load nothing from the network.
- Dump the base goldens as SVG files: `git worktree add --detach <dir> origin/main && ln -s "$PWD/node_modules" <dir>/node_modules`, then in `<dir>` run `GOLDEN_WRITE_DIR=<out> npx vitest run tests/golden-svg.test.ts`. The link is valid only when `package-lock.json` is the same in both checkouts; otherwise run `npm ci` in `<dir>`. Remove it with `git worktree remove --force <dir>`.
- A geometry comparison over the fixtures covers the themed golden variants too: the golden set renders every fixture as authored and again under `notation` (`tests/golden/render.ts`), so compare both.
- Turn SVG dumps into PNGs: `npx tsx scripts/svg-to-png.mjs <dir or file>...` writes a PNG beside each SVG with the CLI's rasterizer.
- Reproduce React-only behaviour in a real browser: `node scripts/react-harness.mjs <spec.json | -> [--width <px>]` writes `artifacts/react-harness/index.html`. It holds one spec in `BoardplotChart` and logs every `onWarnings` and `onRefused` call to the console, the page and `window.boardplotLog`. Before a screenshot, bring the tab to the front and wait until the table's grid transition has ended.

## Evidence for a pull request

- Compare bytes and speed with the `main` commit the pull request merges into, not with an older snapshot.
- Golden changes: list each changed golden key with a one-line reason, and look at its before and after PNG. The golden hashes find every changed fixture.
- Width matrices and contact sheets are needed only for sizing changes (frame, notes, plot sizing, or formats that change text width). Limit them to the fixtures of the changed family, the narrowest width and the changed breakpoints.
- Speed: run `node scripts/speed-tool.mjs` once for the finished code change (head `HEAD`, base `origin/main`; `--input <request.json>` adds a case when no golden runs the changed path). It proves equal SVG bytes per case, finds the cases where the changed code runs, and times them in paired runs. Read the verdict line: NO EVIDENCE is not a pass, because the change was not timed. Put its Markdown table in the pull request. Do not time while other heavy jobs run on the same machine.

## Tests

- The suite protects what users see and call: the golden SVGs, the React markup, schema refusals and their codes, the CLI and MCP surface, the React entry points, and computed numbers that no fixture shows.
- A bug fix comes with one focused test that fails without the fix.
- A new test needs one sentence that names the real problem it prevents. Put it in a comment above the test. Prefer adding a case to an existing file of the same area.
- Do not add a test that repeats a golden, pins docs wording or describe text, lists option keys, or checks an internal helper whose output the goldens draw. The option-capability probe census is the exception.
- Sweeps over fixtures, widths or themes are manual scripts, not vitest files. The guard censuses stay in vitest: the measured floor (content sizing and card floor), React against measure, axe accessibility, spec parity, headless layout, repaint light to dark, CLI grammar over the shipped docs, and the option-capability probe. They catch fixture-specific bugs that a golden re-baseline accepts.
- Run `npm run check:scorecard` to check fixture geometry, frame text and series names across widths, themes and selected settings. It also checks repairs, text overlap, line crossings and label omissions. Public CI does not run it, so run it before a pull request that changes layout. Re-record all outcomes with `npm run check:scorecard -- --record`.
- When the scorecard gate fails, render each changed case at its recorded width and inspect it. Re-record the baseline, then list each changed case and its reason in the PR body, as for goldens.

## Generated files

`docs/reference/`, `llms.txt`, the catalog table in `README.md`, the type size tables in `docs/manual.md` and `tests/golden/manifest.json` are generated. Do not edit or merge them by hand. On a conflict, take the version from `main` and generate them again (`npm run docs:build`; for the manifest, `GOLDEN_UPDATE=1 npx vitest run tests/golden-svg.test.ts`).
