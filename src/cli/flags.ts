import { FLAG_GRAMMAR, HELP_VERBS, type FlagSpec } from './grammar';
import { pushAll } from '../core/arrays';

export interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

/** A command-line grammar violation. Carries the envelope code with it. */
export class FlagError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'FlagError';
  }
}

function flagToken(key: string): string {
  return key.length === 1 ? `-${key}` : `--${key}`;
}

function splitArgument(argument: string): { key: string; inline?: string } | undefined {
  if (argument.startsWith('--') && argument.length > 2) {
    const eq = argument.indexOf('=');
    return eq < 0 ? { key: argument.slice(2) } : { key: argument.slice(2, eq), inline: argument.slice(eq + 1) };
  }
  if (argument.startsWith('-') && argument.length === 2) return { key: argument.slice(1) };
  return undefined;
}

function booleanValue(token: string, inline: string | undefined): boolean {
  if (inline === undefined || inline === 'true') return true;
  if (inline === 'false') return false;
  throw new FlagError('flag-takes-no-value', `${token} does not take a value`);
}

/**
 * Parse argv for one verb against its declared grammar. An unknown verb parses
 * nothing, so `main` reports the unknown VERB instead of burying it under
 * unknown-flag errors.
 */
export function parseFlags(rawVerb: string | undefined, args: string[]): Flags {
  const verb = rawVerb !== undefined && (HELP_VERBS as readonly string[]).includes(rawVerb) ? 'help' : rawVerb;
  const grammar: Record<string, FlagSpec> | undefined = verb === undefined ? undefined : FLAG_GRAMMAR[verb];
  // Null prototype: reads of never-passed flags answer undefined, not an inherited property.
  const flags: Flags = Object.assign(Object.create(null) as Flags, { _: [] });
  if (!grammar) return flags;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--') {
      // POSIX end-of-flags: the only way to pass a path that begins with a dash.
      pushAll(flags._, args.slice(index + 1));
      break;
    }
    const split = argument === '-' ? undefined : splitArgument(argument);
    if (!split) {
      flags._.push(argument);
      continue;
    }
    const token = flagToken(split.key);
    const spec = grammar[split.key];
    // `boardplot <verb> --help` (or -h) asks for that verb's usage; the rest of the line is moot.
    if (!spec && (split.key === 'help' || split.key === 'h')) return Object.assign(flags, { help: true });
    if (!spec) {
      const valid = Object.keys(grammar).sort().map(flagToken).join(', ') || 'none';
      throw new FlagError('unknown-flag', `unknown flag '${token}' for 'boardplot ${verb}'; valid flags: ${valid}`);
    }
    const key = split.key === 'o' ? 'out' : split.key;
    if (seen.has(key)) throw new FlagError('flag-repeated', `${token} was given more than once`);
    seen.add(key);
    if (spec.kind === 'boolean') {
      if (booleanValue(token, split.inline)) flags[key] = true;
      continue;
    }
    if (split.inline !== undefined) {
      flags[key] = split.inline;
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || (next.startsWith('-') && next !== '-')) {
      throw new FlagError('flag-missing-value', `${token} needs a value: boardplot ${verb} ... ${token} <value>`);
    }
    flags[key] = next;
    index++;
  }
  return flags;
}
