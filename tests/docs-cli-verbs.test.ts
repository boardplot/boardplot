/**
 * Every `boardplot` command the shipped text names
 * runs. The skill takes its body from docs/manual.md, the reference pages and
 * llms files are generated from the schemas, and the schemas' describe
 * strings reach the agent through `boardplot describe`; each command quoted in
 * any of them is checked against the CLI grammar, so a renamed or removed
 * flag fails here before an agent reads it. In code only the string literals
 * ship; comments may tell history. CHANGELOG.md names removed commands on
 * purpose and is not scanned.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { FLAG_GRAMMAR, HELP_VERBS, VERBS } from '../src/cli/grammar';

const ROOT = join(__dirname, '..');

function files(directory: string, pattern: RegExp): string[] {
  return (readdirSync(join(ROOT, directory), { recursive: true }) as string[])
    .filter((name) => pattern.test(name))
    .map((name) => join(directory, name));
}

const SOURCES = [
  'README.md', 'llms.txt',
  ...files('docs', /\.md$/),
  ...files('release/plugin', /\.md$/),
  ...files('src', /\.tsx?$/),
  'scripts/generate-reference.mjs', 'scripts/reference-recipes.mjs', 'scripts/build-plugin.mjs',
];

/** The text of every string and template literal in a code file. */
function literals(source: string): string[] {
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
    if (ts.isTemplateExpression(node)) texts.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${}'));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, false));
  return texts;
}

/**
 * Text that starts with `boardplot ` but names the package, not the bin; each
 * entry is one exact string. The package and the bin share the name.
 */
const NOT_COMMANDS = new Set([
  // src/core/geo/packs/registry.ts, the duplicate-install message
  'boardplot so exactly one copy is installed — one version in the lockfile',
]);

/** Commands quoted in backticks or quotes, and command lines in code blocks. */
function commands(text: string): string[] {
  const quoted = [...text.matchAll(/([`'"])(boardplot(?: [^`'"\n]*)?)\1/g)].map((match) => match[2]!);
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('boardplot ') && !NOT_COMMANDS.has(line));
  return [...quoted, ...lines].filter((command) => !command.includes('${'));
}

/** Why the command would not run, or undefined. */
function grammarError(command: string): string | undefined {
  const tokens = command.replace(/[[\]]/g, ' ').split(/\s+/).filter(Boolean).slice(1);
  const end = tokens.findIndex((token) => ['|', '||', '&&', ';', '>'].includes(token) || token.startsWith('<<'));
  const [verb, ...rest] = end < 0 ? tokens : tokens.slice(0, end);
  if (verb === undefined || verb === '--version' || verb.startsWith('<') || (HELP_VERBS as readonly string[]).includes(verb)) return undefined;
  const name = verb.replace(/[,.:]$/, '');
  if (!VERBS.includes(name)) return `unknown verb '${name}'`;
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]!;
    if (token === '-' || token === '--' || !token.startsWith('-')) continue;
    const flag = token.replace(/^--?/, '').split('=')[0]!;
    const spec = FLAG_GRAMMAR[name]![flag];
    if (!spec) return `'boardplot ${name}' has no flag '${token.split('=')[0]}'`;
    if (spec.kind === 'value' && !token.includes('=')) index++;
  }
  return undefined;
}

it('names only commands and flags the CLI grammar has', () => {
  const found: string[] = [];
  const failures: string[] = [];
  for (const source of SOURCES) {
    const text = readFileSync(join(ROOT, source), 'utf8');
    for (const command of (/\.m?tsx?$|\.mjs$/.test(source) ? literals(text) : [text]).flatMap(commands)) {
      found.push(command);
      const error = grammarError(command);
      if (error) failures.push(`${source}: ${command} (${error})`);
    }
  }
  // The manual's discovery commands are among the commands checked.
  expect(found).toEqual(expect.arrayContaining(['boardplot fixtures --type waterfall', 'boardplot list']));
  expect(failures).toEqual([]);
});

it('catches a flag the grammar does not have', () => {
  expect(grammarError('boardplot list --json')).toBe("'boardplot list' has no flag '--json'");
  expect(grammarError('boardplot fixtures --chart waterfall')).toBe("'boardplot fixtures' has no flag '--chart'");
  expect(grammarError('boardplot validate spec.json')).toBe("unknown verb 'validate'");
  expect(grammarError("boardplot render - --width 400 <<'EOF'")).toBeUndefined();
});
