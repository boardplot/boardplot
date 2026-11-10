### Added

- `docs/reference/warnings.md` lists every warning and refusal code a chart can return: its severities, whether a site returns a `fix`, and the chart type or shared file that returns it. `npm run docs:build` writes it from the source; the manual links it.
- `npm run check:warning-codes`, also in `npm run check:ci` and CI, fails when a code breaks the telemetry code pattern, when the render tool text, the skill or the manual names a code that does not exist, or when a code has two severities without a stated reason.

### Changed

- The diagram's unplaced-label codes keep one severity each: `diagram-node-label-unplaced` and `diagram-size-too-small` refuse, `diagram-secondary-label-unplaced` and `diagram-caption-unplaced` warn. Output is unchanged.
