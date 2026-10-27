/**
 * The CLI side of python/scripts/parity_sweep.py, in one Node process: each
 * input line runs one CLI verb function (render, describe, list, fixtures)
 * under runVerb, as `boardplot <verb>` does after parsing its flags, and the
 * output line holds the JSON body the CLI would print.
 *
 * Usage: npx tsx python/js/parity/cli-batch.ts <in.jsonl> <out.jsonl>
 * Input line: {"op": "render" | "describe" | "list" | "fixtures", "input": {...}}
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { render } from '../../../src/cli/render';
import { describe } from '../../../src/cli/describe';
import { list } from '../../../src/cli/list';
import { fixtures } from '../../../src/cli/fixtures';
import { applyRows } from '../../../src/cli/rows';
import { runVerb, type VerbResult } from '../../../src/cli/result';
import { linkAnnotateEngine } from '../../../src/core/annotateEngine';
import { linkStoryLayer } from '../../../src/core/storyLayer';
import { linkThemeShapeRules } from '../../../src/core/themeShapeRules';
import { registerAllGeoPacks } from '../../../src/core/geo/packs';
import { sanitizeObjectPrototype } from '../../../src/core/doc/docExpand';

// The same links as src/cli/main.ts.
linkThemeShapeRules();
linkAnnotateEngine();
linkStoryLayer();
registerAllGeoPacks();
sanitizeObjectPrototype((message) => process.stderr.write(`warning: ${message}\n`));

type Input = Record<string, unknown>;

function run(op: string, input: Input): VerbResult {
  switch (op) {
    case 'render':
      return render({ ...input, spec: input.spec, format: 'svg', return: ['svg', 'reading'] } as Parameters<typeof render>[0]);
    case 'rows-spec':
      // The resolved spec `render --rows` draws: the bare spec with its data taken from the rows.
      return { exit: 0, body: { ok: true, spec: applyRows(input.spec, input).spec } };
    case 'describe':
      return describe(input);
    case 'list':
      return list();
    case 'fixtures':
      return fixtures(input, Infinity);
    default:
      throw new Error(`unknown op ${op}`);
  }
}

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  process.stderr.write('usage: cli-batch.ts <in.jsonl> <out.jsonl>\n');
  process.exit(2);
}
const lines = readFileSync(inPath, 'utf8').split('\n').filter((line) => line.trim() !== '');
const out = lines.map((line) => {
  const { op, input } = JSON.parse(line) as { op: string; input?: Input };
  return JSON.stringify(runVerb(() => run(op, input ?? {})).body);
});
writeFileSync(outPath, out.join('\n') + '\n');
