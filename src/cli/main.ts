/**
 * The boardplot CLI: argument parsing, one JSON object on
 * stdout, exit 0 (ok), 1 (input rejected) or 2 (internal error). Each verb
 * lives in its own module; the MCP server calls the same functions.
 */
import { linkStoryLayer } from '../core/storyLayer';
import { linkAnnotateEngine } from '../core/annotateEngine';
import { linkThemeShapeRules } from '../core/themeShapeRules';
import { registerAllGeoPacks } from '../core/geo/packs';
import { sanitizeObjectPrototype } from '../core/doc/docExpand';
import { BOARDPLOT_VERSION } from '../version';
import { FlagError, parseFlags, type Flags } from './flags';
import { HELP_VERBS, POSITIONALS, USAGE, VERBS } from './grammar';
import { printError, printOut } from './output';
import { InputError, ok, rejectedInput, runVerb, type VerbResult } from './result';
import { readSpecFile } from './spec';
import { list } from './list';
import { describe } from './describe';
import { fixtures } from './fixtures';
import { render } from './render';
import { measure } from './measure';
import { fonts } from './fonts';
import { telemetry } from './telemetry';
import { feedback } from '../telemetry/feedback';
import { cliNotice, recordCliUsage } from '../telemetry/send';
import { hostFromEnv } from '../telemetry/event';
import { telemetryState } from '../telemetry/state';
import { resolve } from 'node:path';

// Linked by value, so this entry resolves a patched theme and lays out
// annotations synchronously (see core/deferred), and draws every geo pack.
linkThemeShapeRules();
linkAnnotateEngine();
linkStoryLayer();
registerAllGeoPacks();

export * from './grammar';

function text(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * `--rows file --columns category=month,series=segment,value=revenue`: the
 * rows file resolves against the working directory, as the spec file does.
 */
function rowFlags(flags: Flags): { rowsFile?: string; columns?: Record<string, string> } {
  const file = text(flags, 'rows');
  const map = text(flags, 'columns');
  const columns = map === undefined ? undefined : Object.fromEntries(map.split(',').map((pair) => {
    const [role, column, ...rest] = pair.split('=').map((part) => part.trim());
    if (!role || !column || rest.length) {
      throw new InputError('invalid-argument', `--columns takes role=column pairs separated by commas, not '${pair}'`, {
        suggest: 'Pass --columns category=month,series=segment,value=revenue.',
      });
    }
    return [role, column];
  }));
  return { ...(file === undefined ? {} : { rowsFile: resolve(file) }), ...(columns ? { columns } : {}) };
}

/**
 * `--quiet`: a render that succeeded prints ok and the files it wrote; a refusal keeps its errors.
 * `--return` beats `--quiet`: the parts it names (svg, reading) still print.
 */
function quietRender(flags: Flags, result: VerbResult): VerbResult {
  if (flags.quiet !== true || result.exit !== 0) return result;
  const returned = (text(flags, 'return') ?? '').split(',').map((entry) => entry.trim());
  const pick = (from: Record<string, unknown>) => Object.fromEntries(returned.filter((key) => key in from).map((key) => [key, from[key]]));
  // A document answers per chart, under charts with each chart's name.
  const charts = Array.isArray(result.body.charts) && returned.some((key) => key !== '')
    ? { charts: (result.body.charts as Record<string, unknown>[]).map((chart) => ({ name: chart.name, ...pick(chart) })) } : {};
  return { ...result, body: { ok: true, ...(result.body.outputs ? { outputs: result.body.outputs } : {}), ...pick(result.body), ...charts } };
}

/** Print before quiet mode removes warnings; stdout keeps its existing JSON shape. */
function writtenPaths(result: VerbResult): VerbResult {
  const outputs = result.body.outputs;
  if (result.exit === 0 && Array.isArray(outputs) && outputs.length) {
    const warnings = result.body.warnings as { code: string; suggest?: string }[] | undefined;
    const collision = warnings?.some((warning) => warning.code === 'out-name-taken' && warning.suggest?.includes('--overwrite'));
    printError(`Wrote ${outputs.join(', ')}${collision ? '; use --overwrite to replace the existing file.' : ''}`);
  }
  return result;
}

/** What a call's usage event may read: the spec and the type it named (docs/TELEMETRY.md). */
interface UsageSeen {
  spec?: unknown;
  type?: unknown;
}

function dispatch(verb: string, flags: Flags, seen: UsageSeen): VerbResult {
  const [first, second] = flags._;
  switch (verb) {
    case 'help':
      return ok({ usage: USAGE });
    case 'list':
      return list();
    case 'describe':
      seen.type = first;
      return describe({ type: first, detail: flags.full === true ? 'full' : 'compact', path: text(flags, 'path'), schema: text(flags, 'schema') });
    case 'fixtures':
      seen.type = text(flags, 'type');
      return fixtures({ type: text(flags, 'type'), id: text(flags, 'id'), kind: text(flags, 'kind') }, Infinity);
    case 'render':
      // The CLI answers with one JSON object; a PNG has to go to a file.
      if (text(flags, 'format') === 'png' && text(flags, 'out') === undefined) {
        throw new InputError('png-needs-out', 'render --format png writes files; pass --out <dir>', {
          suggest: 'Add --out with a directory, or render svg.',
        });
      }
      seen.spec = readSpecFile(first);
      return quietRender(flags, writtenPaths(render({
        spec: seen.spec,
        format: text(flags, 'format'),
        target: text(flags, 'target'),
        width: text(flags, 'width'),
        height: text(flags, 'height'),
        scale: text(flags, 'scale'),
        background: text(flags, 'background'),
        outDir: text(flags, 'out'),
        overwrite: flags.overwrite === true,
        fontTables: text(flags, 'font-tables'),
        placement: text(flags, 'placement'),
        deckFont: text(flags, 'deck-font'),
        deckWeights: text(flags, 'deck-weights'),
        ...(text(flags, 'return') === undefined ? {} : { return: text(flags, 'return')!.split(',').map((entry) => entry.trim()) }),
        ...rowFlags(flags),
      })));
    case 'measure':
      seen.spec = readSpecFile(first);
      return measure({ spec: seen.spec, target: text(flags, 'target'), width: text(flags, 'width'), fontTables: text(flags, 'font-tables'), ...rowFlags(flags) });
    case 'fonts':
      return fonts({ sub: first, dir: second, out: text(flags, 'out'), check: flags.check === true });
    case 'telemetry':
      return telemetry(first);
    case 'feedback':
      return feedback({
        surface: 'cli', category: text(flags, 'category'), summary: text(flags, 'summary'), type: text(flags, 'type'),
        codes: text(flags, 'codes'), optionKeys: text(flags, 'options'), send: flags.send === true,
      });
    default:
      throw new InputError('unknown-verb', `unknown command '${verb}'; valid commands: ${VERBS.filter((name) => name !== 'help').join(', ')}`, {
        suggest: 'Run boardplot help for one line per command.',
      });
  }
}

function checkPositionals(verb: string, positionals: readonly string[]): void {
  const expected = POSITIONALS[verb];
  if (expected === undefined || positionals.length <= expected) return;
  const extras = positionals.slice(expected).map((value) => JSON.stringify(value)).join(', ');
  throw new InputError('extra-argument', `boardplot ${verb} takes ${expected} positional ${expected === 1 ? 'argument' : 'arguments'}; unexpected: ${extras}`);
}

/** Run one CLI call: print its JSON body and return the exit code. */
export function main(argv: string[]): number {
  // Verdicts and bytes must not depend on foreign Object.prototype members.
  sanitizeObjectPrototype((message) => printError(`warning: ${message}`));
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    printOut(BOARDPLOT_VERSION);
    return 0;
  }
  const [rawVerb, ...rest] = argv;
  const verb = rawVerb === undefined || (HELP_VERBS as readonly string[]).includes(rawVerb) ? 'help' : rawVerb;
  const seen: UsageSeen = {};
  let format: string | undefined;
  const result = runVerb(() => {
    let flags: Flags;
    try {
      flags = parseFlags(verb, rest);
    } catch (error) {
      if (error instanceof FlagError) return rejectedInput(new InputError(error.code, error.message));
      throw error;
    }
    if (flags.help === true) return ok({ usage: verb === 'help' ? USAGE : { [verb]: USAGE[verb] } });
    checkPositionals(verb, flags._);
    format = text(flags, 'format');
    return dispatch(verb, flags, seen);
  });
  printOut(JSON.stringify(result.body));
  // Usage counts only when the user turned them on and the build has a collector; telemetryState() decides.
  if (verb !== 'telemetry' && verb !== 'feedback' && verb !== 'help') {
    try {
      const state = telemetryState();
      recordCliUsage({ command: verb, ...seen, format, body: result.body, host: hostFromEnv() }, state);
      cliNotice(state);
    } catch {
      // Usage counts never change a command's answer or exit code.
    }
  }
  return result.exit;
}
