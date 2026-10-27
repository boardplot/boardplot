/**
 * `boolean` never consumes the next token. `value` requires one.
 */
type FlagKind = 'boolean' | 'value';

export interface FlagSpec {
  kind: FlagKind;
}

const BOOL: FlagSpec = { kind: 'boolean' };
const VALUE: FlagSpec = { kind: 'value' };

/**
 * The declared flag grammar. Every flag a verb reads appears
 * here; an undeclared flag is an error.
 */
export const FLAG_GRAMMAR: Record<string, Record<string, FlagSpec>> = {
  help: {},
  list: {},
  describe: { full: BOOL, path: VALUE, schema: VALUE },
  fixtures: { type: VALUE, id: VALUE, kind: VALUE },
  render: { format: VALUE, target: VALUE, width: VALUE, height: VALUE, scale: VALUE, background: VALUE, overwrite: BOOL, out: VALUE, o: VALUE, return: VALUE, rows: VALUE, columns: VALUE, quiet: BOOL, 'font-tables': VALUE, placement: VALUE, 'deck-font': VALUE, 'deck-weights': VALUE },
  measure: { target: VALUE, width: VALUE, rows: VALUE, columns: VALUE, 'font-tables': VALUE },
  // Authoring tool, not a render path: reads a licensed font directory with
  // fontkit and writes reusable width tables (docs/FONTS.md).
  fonts: { out: VALUE, o: VALUE, check: BOOL },
  // The user's switch for usage counts and the problem report (docs/TELEMETRY.md).
  telemetry: {},
  feedback: { category: VALUE, summary: VALUE, type: VALUE, codes: VALUE, options: VALUE, send: BOOL },
};

/** Aliases of `help` that arrive in the verb position. */
export const HELP_VERBS = ['help', '--help', '-h'] as const;

export const VERBS = Object.keys(FLAG_GRAMMAR);

/** How many positional arguments each verb takes. */
export const POSITIONALS: Record<string, number> = {
  help: 0, list: 0, describe: 1, fixtures: 0, render: 1, measure: 1, fonts: 2, telemetry: 1, feedback: 0,
};

/** One line per verb: the whole help text. */
export const USAGE: Record<string, string> = {
  list: 'boardplot list',
  describe: 'boardplot describe <type|theme> [--full] [--path field] [--schema data|options]',
  fixtures: 'boardplot fixtures [--type t] [--id i] [--kind example|torture|all]',
  render: 'boardplot render <spec.json|-> [--format svg|png|claude-slides] [--target report|dashboard|slide|print] [--width n[px|pt|mm]] [--height n[px|pt|mm]] [--scale n] [--background theme|transparent] [--out dir|file.png|file.svg] [--overwrite] [--return svg,reading] [--rows data.csv|data.json --columns category=c,series=s,value=v[,valueKind=fraction]] [--quiet] [--font-tables file] [--placement x,y,width,height --deck-font family [--deck-weights 400,700]]. Rows: waterfall label=l,value=v[,type=t]; scatter/bubble x=x,y=y[,size=s,label=l,group=g]; sankey source=s,target=t,value=v[,sourceStage=a,targetStage=b]. --target sets the reading context and beats options.target; the default is report. A bare --width or --height is px; 660pt or 180mm give physical units. --overwrite replaces existing output files; without it, a taken name gets a -N suffix. --quiet prints one JSON object {ok, outputs} on success, plus the parts --return names. --font-tables names a file built by `boardplot fonts build`; layout measures with it (env BOARDPLOT_FONT_TABLES when the flag is absent). --format claude-slides draws a Claude Slides fragment at target slide: one SVG of shapes and one positioned <p> per text line in the deck font, under claudeSlides in the result (html, title, source, elements, svgBytes, font, face, fit, warnings); put it directly into the slide section; --placement is the chart box on the 1920x1080 slide in slide px (default 128,232,1664,688, under the heading and above the footer band), --deck-font the text family the deck loads (required), --deck-weights the weights the deck loads (default 400,700); --out file.html writes the fragment. outputs is present when the render wrote files. It validates the spec first: an invalid spec answers ok:false with its errors and draws nothing, so render is also the validate step (there is no validate verb).',
  measure: 'boardplot measure <spec.json|-> [--target report|dashboard|slide|print] [--width n[px|pt|mm]] [--rows data.csv|data.json --columns category=c,series=s,value=v] [--font-tables file]. Rows: waterfall label=l,value=v[,type=t]; scatter/bubble x=x,y=y[,size=s,label=l,group=g]; sankey source=s,target=t,value=v[,sourceStage=a,targetStage=b].',
  fonts: 'boardplot fonts build <font-dir> [--out file] [--check]',
  telemetry: 'boardplot telemetry [status|on|off]. Usage counts are off until you run on; status shows the state and the exact last payload; off deletes the install ID. DO_NOT_TRACK=1 or BOARDPLOT_TELEMETRY=0 turn them off, and nothing is sent in CI. See docs/TELEMETRY.md.',
  feedback: 'boardplot feedback --category bug|friction|docs --summary text [--type t] [--codes c1,c2] [--options k1,k2] [--send]. Prints a problem report (version, OS, chart type, option names, codes, your one-line summary of at most 280 characters) and issueUrl, a prefilled GitHub issue link. --send posts the report to the maintainers instead; use it only after the user approved the exact text. Write the summary without client names, numbers, labels or paths.',
  version: 'boardplot --version',
};

/** `boardplot fonts build <dir>`: one subverb today, spelled the same way. */
export const FONTS_SUBVERBS = ['build'] as const;
