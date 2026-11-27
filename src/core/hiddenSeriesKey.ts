/**
 * The series a reader hides with a legend click, on the options of a mounted React chart. A registered symbol:
 * the request keeps it and JSON never carries it, so the CLI, the MCP tools and the server draw every series.
 * A list, not a set, so the layout's request key tells two hidden lists apart. This module holds the key alone:
 * the shared request step copies the list, and importing hiddenSeries.ts there would link its code into every chart.
 */
export const HIDDEN_SERIES = Symbol.for('boardplot.hiddenSeries');
