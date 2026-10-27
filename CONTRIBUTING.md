# Contributing

1. Use Node.js 22.12 or newer. Install the dependencies with `npm ci`.
2. For a bug, open an issue with the spec that shows it, the command or
   component you used, and the Boardplot version (`npx boardplot --version`).
3. Before you open a pull request, run the tests for the files you change
   (`npx vitest run <files>`) and `npm run typecheck`. CI runs the full suite.
4. Keep pull requests small: one fix or one feature each.
5. A bug fix comes with a test that fails without the fix.
6. A new public option updates its schema, its TypeScript type, the docs and
   at least one fixture.
7. Layout and SVG output are deterministic: the same input gives the same
   bytes. Do not add hex colours in chart code; use theme tokens.
8. Do not edit generated files by hand. `npm run docs:build` regenerates the
   reference, the gallery, `llms.txt` and the catalog table in `README.md`.

[AGENTS.md](AGENTS.md) has the full rules: tests, evidence for a chart change,
and how to look at a fixture.

Report a security problem privately, as [SECURITY.md](SECURITY.md) says, not
in a public issue.

By contributing you agree that your work is licensed under the Apache License,
Version 2.0 (see [LICENSE](LICENSE)).
