/**
 * Links the two core modules a browser chart entry fetches on demand
 * (`src/core/deferred`): the annotation placement pass and the checks a
 * patched theme goes through.
 *
 * A test that lays a chart out through the core API is a CLI-shaped graph,
 * and this is exactly what the CLI, the MCP server, `boardplot`,
 * `boardplot/validate` and `react/prepare` import. A test that wants
 * the on-demand behaviour instead simply does not import this.
 */
import '../../src/core/annotateEngine';
import '../../src/core/themeShapeRules';
