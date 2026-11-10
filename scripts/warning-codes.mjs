#!/usr/bin/env node
/**
 * Lists every warning and refusal code the source can emit, read with the
 * TypeScript compiler: the code, the severities its sites set, whether a site
 * can carry a `fix`, and the chart types or shared files that emit it.
 *
 * A code is found where an object literal with a `message` or `severity` sets
 * `code`, where an Error subclass is constructed with it, or where it is
 * passed to a function that does one of these with its `code` parameter. A
 * code built at run time is resolved from the literal types of its parts. A
 * code read from a property comes from the objects that set that property, with
 * the severity of the site that emits it. A left-out argument takes its default.
 * A producer whose code cannot be resolved to literals is listed as unresolved.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'fontTables' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.d\.ts$|\.generated\.ts$|^fixtures\.ts$/.test(entry.name) ? [path] : [];
  });
}

export function extractWarningCodes(root = ROOT) {
  const program = ts.createProgram(sourceFiles(resolve(root, 'src')), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, skipLibCheck: true, resolveJsonModule: true, allowImportingTsExtensions: true,
  });
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((file) => file.fileName.startsWith(resolve(root, 'src')) && !file.isDeclarationFile);
  const codes = new Map();
  const unresolved = [];
  const where = (node) => {
    const file = node.getSourceFile();
    return `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  };
  const emitter = (node) => {
    const path = relative(resolve(root, 'src'), node.getSourceFile().fileName).replaceAll('\\', '/');
    const chart = /^core\/charts\/([^/]+)\//.exec(path);
    return chart ? chart[1] : path;
  };

  const unwrap = (node) => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
    return node;
  };
  /** The string literals a type stands for, or undefined when it is open. */
  const literalsOfType = (type) => {
    const parts = type.isUnion() ? type.types : [type];
    if (parts.every((part) => part.isStringLiteral())) return parts.map((part) => part.value);
    return undefined;
  };
  /** The symbol a name reads; `{ code }` reads the variable `code`, not the property. */
  const symbolOf = (node) => (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node));
  const parameterOf = (node) => {
    if (!ts.isIdentifier(node)) return undefined;
    const declaration = symbolOf(node)?.valueDeclaration;
    return declaration && ts.isParameter(declaration) ? declaration : undefined;
  };
  /**
   * The literal codes an expression evaluates to: `{ codes }`, `{ forward: parameter }`
   * when it passes a parameter on, `{ open }` when it reads a value the source does not
   * name, or `{ dynamic }` when it builds a code from an open part.
   */
  function resolveCode(expression, seen = new Set()) {
    const node = unwrap(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { codes: [node.text] };
    if (ts.isConditionalExpression(node)) return merge(resolveCode(node.whenTrue, seen), resolveCode(node.whenFalse, seen));
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return merge(resolveCode(node.left, seen), resolveCode(node.right, seen));
    }
    if (ts.isTemplateExpression(node)) {
      let built = [node.head.text];
      for (const span of node.templateSpans) {
        const parts = literalsOfType(checker.getTypeAtLocation(span.expression));
        if (!parts) return { dynamic: true };
        built = built.flatMap((prefix) => parts.map((part) => `${prefix}${part}${span.literal.text}`));
      }
      return { codes: built };
    }
    // A parameter is forwarded even when its type is a closed union: the call names the value.
    const parameter = parameterOf(node);
    if (parameter) return { forward: parameter };
    const typed = literalsOfType(checker.getTypeAtLocation(node));
    if (typed) return { codes: typed };
    if (ts.isIdentifier(node)) {
      const declaration = symbolOf(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && !seen.has(declaration)
        && (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)) {
        return resolveCode(declaration.initializer, new Set([...seen, declaration]));
      }
    }
    return { open: true };
  }
  function merge(a, b) {
    if (a.dynamic || b.dynamic) return { dynamic: true };
    const codes = [...(a.codes ?? []), ...(b.codes ?? [])];
    return { codes, ...(a.forward || b.forward ? { forward: a.forward ?? b.forward } : {}), ...(a.open || b.open ? { open: true } : {}) };
  }
  const resolveSeverity = (expression) => {
    if (!expression) return { severities: [] };
    const result = resolveCode(expression);
    return result.forward ? { forward: result.forward } : { severities: result.codes ?? [] };
  };

  const record = (code, severities, fix, node) => {
    const entry = codes.get(code) ?? { code, severities: new Set(), fix: false, emitters: new Set() };
    for (const severity of severities) entry.severities.add(severity);
    entry.fix ||= fix;
    entry.emitters.add(emitter(node));
    codes.set(code, entry);
  };
  /** A site emits `codes`; a site that forwards a parameter makes its function a producer. */
  const producers = new Map();
  const sites = [];
  const property = (object, name) => object.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
  const valueOf = (p) => (ts.isShorthandPropertyAssignment(p) ? p.name : p.initializer);
  /**
   * Whether a value in the `fix` position carries a patch: true, false, or
   * `{ forward }` when a parameter passes it on.
   */
  const fixOf = (expression) => {
    if (!expression) return false;
    const node = unwrap(expression);
    if (ts.isIdentifier(node) && node.text === 'undefined') return false;
    const parameter = parameterOf(node);
    if (parameter) return { forward: parameter };
    // A patch is a list of operations; a text named `fix` is a suggestion.
    const type = checker.getTypeAtLocation(node);
    return !(type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.StringLike));
  };
  /** A value whose type always has a `fix` (in at least one branch of a union). */
  const typedFix = (expression) => {
    const type = checker.getTypeAtLocation(expression);
    return (type.isUnion() ? type.types : [type]).some((part) => {
      const fix = part.getProperty('fix');
      return fix !== undefined && !(fix.flags & ts.SymbolFlags.Optional);
    });
  };
  /** The `fix` of an object literal: its own property, or a spread whose type has one. */
  const objectFix = (object) => {
    const own = property(object, 'fix');
    if (own) return fixOf(valueOf(own));
    return object.properties.some((p) => ts.isSpreadAssignment(p) && typedFix(p.expression));
  };
  /** The `fix` of a constructor call: the argument at its `fix` parameter, or a `fix` inside an argument. */
  const constructorFix = (call, signature) => {
    const index = signature?.parameters.findIndex((p) => p.name === 'fix') ?? -1;
    if (index >= 0) return fixOf(call.arguments[index]);
    const fixes = call.arguments.map((argument) => {
      const node = unwrap(argument);
      return ts.isObjectLiteralExpression(node) ? objectFix(node) : typedFix(node);
    });
    return fixes.find((fix) => fix && fix !== true) ?? fixes.includes(true);
  };
  const isErrorClass = (node) => {
    for (let type = checker.getTypeAtLocation(node); type; type = type.isClassOrInterface() ? checker.getBaseTypes(type)[0] : undefined) {
      if (type.symbol?.name === 'Error') return true;
    }
    return false;
  };
  const enclosingFunction = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return parent;
    return undefined;
  };

  /** Every exact string literal and JSX attribute name: the names the source spells out. */
  const literals = new Set();
  /** Every object literal that sets `code`, with or without a message. */
  const codeObjects = [];
  for (const file of files) {
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
      else if (ts.isJsxAttribute(node)) literals.add(node.name.getText());
      if (ts.isObjectLiteralExpression(node)) {
        const code = property(node, 'code');
        // A zod issue (`ctx.addIssue({ code: 'custom' })`) is not a Boardplot code.
        const zodIssue = ts.isCallExpression(node.parent) && /addIssue$/.test(node.parent.expression.getText());
        if (!zodIssue && code && (ts.isPropertyAssignment(code) || ts.isShorthandPropertyAssignment(code))) codeObjects.push({ node, code });
        if (!zodIssue && code && (ts.isPropertyAssignment(code) || ts.isShorthandPropertyAssignment(code)) && (property(node, 'message') || property(node, 'severity'))) {
          const severity = property(node, 'severity');
          sites.push({ node, code: valueOf(code), severity: severity && valueOf(severity), fix: objectFix(node), thrown: false });
        }
      } else if (ts.isNewExpression(node) && node.arguments?.length && isErrorClass(node)) {
        const signature = checker.getResolvedSignature(node);
        const index = signature?.parameters.findIndex((p) => p.name === 'code') ?? -1;
        if (index >= 0 && node.arguments[index]) sites.push({ node, code: node.arguments[index], fix: constructorFix(node, signature), thrown: true });
      } else if (ts.isCallExpression(node)) {
        sites.push({ node, call: true });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  // Pairs a conditional code with a conditional severity on the same condition branch by branch.
  const constant = (expression) => {
    const node = unwrap(expression);
    const declaration = ts.isIdentifier(node) ? symbolOf(node)?.valueDeclaration : undefined;
    return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
      && (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) ? unwrap(declaration.initializer) : node;
  };
  const paired = (code, severity) => {
    const c = constant(code);
    const s = severity && constant(severity);
    if (!s || !ts.isConditionalExpression(c) || !ts.isConditionalExpression(s) || c.condition.getText() !== s.condition.getText()) return undefined;
    return [[c.whenTrue, s.whenTrue], [c.whenFalse, s.whenFalse]];
  };
  const emitSite = (site, codeExpression, severityExpression) => {
    const pairs = paired(codeExpression, severityExpression);
    if (pairs) {
      for (const [code, severity] of pairs) emitSite(site, code, severity);
      return;
    }
    const code = resolveCode(codeExpression);
    const severity = site.thrown ? { severities: ['error'] } : resolveSeverity(severityExpression);
    if (code.dynamic) unresolved.push({ at: where(site.node), text: unwrap(codeExpression).getText() });
    if (code.open) carried.push({ expression: codeExpression, severity, fix: site.fix, node: site.node });
    if (code.forward || severity.forward || site.fix?.forward) {
      const fn = enclosingFunction(site.node);
      const list = producers.get(fn) ?? [];
      list.push({ code: code.forward, codes: code.codes ?? [], severity, fix: site.fix });
      producers.set(fn, list);
    }
    for (const value of code.codes ?? []) {
      record(value, severity.severities ?? [], site.fix === true, site.node);
    }
  };
  /** Sites whose code is read from a property: resolved after the producers, through the objects that set it. */
  const carried = [];
  for (const site of sites) if (!site.call) emitSite(site, site.code, site.severity);

  // Calls to a producer: its code parameter (and severity parameter) take the literal at the call.
  // A callback (`pass.warn?.(code, …)`) resolves to its function type; the producers
  // written for that type stand behind it.
  const callbacks = new Map();
  const declarationsOf = (call) => {
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!declaration) return [];
    return producers.has(declaration) ? [declaration] : callbacks.get(declaration) ?? [];
  };
  for (let changed = true, round = 0; changed && round < 8; round++) {
    changed = false;
    callbacks.clear();
    for (const fn of producers.keys()) {
      if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue;
      const type = checker.getContextualType(fn);
      const declaration = type && checker.getNonNullableType(type).getCallSignatures()[0]?.getDeclaration();
      if (declaration && declaration !== fn) callbacks.set(declaration, [...(callbacks.get(declaration) ?? []), fn]);
    }
    for (const site of sites) {
      if (!site.call || site.done) continue;
      const fns = declarationsOf(site.node);
      if (fns.length === 0) continue;
      site.done = true;
      for (const fn of fns) for (const producer of producers.get(fn)) {
        // An argument left out takes the parameter's default.
        const at = (parameter) => site.node.arguments[fn.parameters.indexOf(parameter)] ?? parameter.initializer;
        const codeArgument = producer.code && at(producer.code);
        const severityArgument = producer.severity.forward && at(producer.severity.forward);
        const fix = producer.fix?.forward ? fixOf(at(producer.fix.forward)) : producer.fix;
        const code = codeArgument ? resolveCode(codeArgument) : { codes: producer.codes };
        if (code.dynamic) unresolved.push({ at: where(site.node), text: unwrap(codeArgument).getText() });
        const severity = producer.severity.forward ? (severityArgument ? resolveSeverity(severityArgument) : { severities: [] }) : producer.severity;
        if (code.open) carried.push({ expression: codeArgument, severity, fix, node: site.node });
        for (const value of code.codes ?? []) record(value, severity.severities ?? [], fix === true, site.node);
        if (code.forward || severity.forward || fix?.forward) {
          const outer = enclosingFunction(site.node);
          const list = producers.get(outer) ?? [];
          list.push({ code: code.forward, codes: code.codes ?? [], severity, fix });
          producers.set(outer, list);
          changed = true;
        }
      }
    }
  }

  // A code read from a property (`span.code`) comes from the objects whose `code` that
  // property declares. An object without a message or severity is only a carrier:
  // its code takes the severity of the site that emits it. A read with no such
  // object, or with no property to follow, cannot be resolved.
  const stringLike = (node) => (checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike) !== 0
    || checker.getTypeAtLocation(node).isUnion() && checker.getTypeAtLocation(node).types.some((part) => part.flags & ts.TypeFlags.StringLike);
  const openReads = (expression) => {
    const node = unwrap(expression);
    if (ts.isConditionalExpression(node)) return [...openReads(node.whenTrue), ...openReads(node.whenFalse)];
    if (ts.isBinaryExpression(node)) return [...openReads(node.left), ...openReads(node.right)];
    if (ts.isStringLiteralLike(node) || resolveCode(node).codes || !stringLike(node)) return [];
    return [node];
  };
  const declarationsOfCode = (object) => {
    const type = checker.getContextualType(object);
    const parts = type ? (type.isUnion() ? type.types : [type]) : [];
    return [property(object, 'code'), ...parts.flatMap((part) => checker.getNonNullableType(part).getProperty('code')?.declarations ?? [])];
  };
  const origins = codeObjects.map((entry) => ({ ...entry, declarations: new Set(declarationsOfCode(entry.node)), site: sites.some((site) => site.node === entry.node) }));
  /** A zod refinement's own code: `ctx.addIssue({ …, params: { code } })`, read back as `issue.params.code`. */
  const issueParams = (object) => ts.isPropertyAssignment(object.parent) && object.parent.name.getText() === 'params'
    && ts.isObjectLiteralExpression(object.parent.parent) && ts.isCallExpression(object.parent.parent.parent)
    && ts.isPropertyAccessExpression(object.parent.parent.parent.expression) && object.parent.parent.parent.expression.name.text === 'addIssue';
  /**
   * A read from a caught error, through a cast or a variable, re-emits a code the
   * list reads at its throw: the root is a catch variable or an `unknown` parameter.
   */
  const caught = (node) => {
    for (node = unwrap(node); ; node = unwrap(node)) {
      if (ts.isPropertyAccessExpression(node)) { node = node.expression; continue; }
      if (!ts.isIdentifier(node)) return false;
      const declaration = symbolOf(node)?.valueDeclaration;
      if (!declaration) return false;
      if (ts.isVariableDeclaration(declaration) && ts.isCatchClause(declaration.parent)) return true;
      if (ts.isParameter(declaration)) return (checker.getTypeAtLocation(declaration).flags & ts.TypeFlags.Unknown) !== 0;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) { node = declaration.initializer; continue; }
      return false;
    }
  };
  for (const read of carried) {
    for (const node of openReads(read.expression)) {
      const declarations = ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name)?.declarations ?? [] : [];
      // A class field (`error.code`) is set by the constructor calls the list reads as thrown sites.
      if (declarations.some((d) => ts.isPropertyDeclaration(d) || ts.isParameter(d)) || caught(node)) continue;
      const params = ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'params';
      const from = origins.filter((origin) => (params ? issueParams(origin.node) : declarations.some((d) => origin.declarations.has(d))));
      if (from.length === 0) {
        unresolved.push({ at: where(read.node), text: node.getText() });
        continue;
      }
      for (const origin of from) {
        if (origin.site) continue;
        const code = resolveCode(valueOf(origin.code));
        if (!code.codes?.length) unresolved.push({ at: where(origin.node), text: valueOf(origin.code).getText() });
        for (const value of code.codes ?? []) record(value, read.severity.severities ?? [], read.fix === true, origin.node);
      }
    }
  }

  const list = [...codes.values()].map((entry) => ({
    code: entry.code, severities: [...entry.severities].sort(), fix: entry.fix, emitters: [...entry.emitters].sort(),
  })).sort((a, b) => a.code.localeCompare(b.code));
  return { codes: list, unresolved, literals };
}

/**
 * Codes that keep two severities, each with its reason. A code may keep two only
 * when both state the same fact at two strengths; a different fact gets its own code.
 */
export const MULTI_SEVERITY = {
  'category-labels-truncated': 'info when the page names the cut labels elsewhere, warn when it does not',
  'category-stride': 'info for a regular stride over a dense row, warn when only a few names draw or names collide',
  'choropleth-unknown-region': 'warn for a data region the pack lacks, error for a labelRegions entry the pack lacks',
  'geo-overlay-no-space': 'warn when an overlay moves to the note or is left out, error when its authored size cannot fit its tile',
  'grid-panel-too-short': 'warn when a panel draws below its floor, error when an aligned panel needs a larger fixed size',
  'histogram-open-above-off-grid': 'warn when the layout moves the open bin onto the bin grid, error when the authored bins cannot',
  'label-hidden': 'info for a label of lower priority, warn for a required or authored label',
  'line-end-label-key': 'info when the key names the lines by design, warn when it replaces the authored end or inline names',
  'missing-value': 'info when the missing value leaves one mark out, error where the type needs every value',
  'negative-value': 'warn when the chart clamps the value to 0, error where the type cannot draw it',
  'option-ignored': 'info when the ignored setting matches what the chart draws, warn when the drawing differs from it',
  'pareto-category-label-omitted': 'info when the page prints every unnamed category elsewhere, warn when one is lost',
  'size-legend-value-out-of-range': 'info when the key draws the value at scale, warn when the key leaves it out',
  'stacked100-mixed-signs': 'warn when some categories are marked n.m., error when all are',
  'stacked100-over-100': 'warn when some categories are marked n.m., error when all are',
  'table-overflow': 'warn when the frame narrows widths or must grow, error when rows exceed a fixed plot height',
  'unknown-anchor': 'warn when a waterfall connector falls back to the sum, error when a gantt anchor target does not exist',
};

/** Names in the documents that look like codes and are none, each with what it is. */
export const NOT_CODES = {
  'paint-order': 'an SVG attribute',
  'revenue-q3-2024': 'a name slug example',
  'row-1': 'a generated row id',
  'row-2': 'a generated row id',
};

/** The reference page: one row per code. */
export function warningsPage({ codes, unresolved }) {
  const cell = (text) => text.replaceAll('|', '\\|');
  return [
    '# Warning and refusal codes', '',
    '<!-- Generated by scripts/generate-reference.mjs from the codes in src, read by scripts/warning-codes.mjs. -->', '',
    'Every code a render, a measure or a React chart can return, read from the source. `ok: false` (`error`) means nothing was drawn. A `warn` warning needs a review of the drawing. `info` and `advice` need no retry. A code with two severities states the same fact at two strengths. Fix: at least one site returns a `fix` patch. Source: the chart type or the shared file that returns the code.', '',
    '| Code | Severity | Fix | Source |',
    '|---|---|---|---|',
    ...codes.map((entry) => `| \`${entry.code}\` | ${entry.severities.join(', ') || 'not stated at the site'} | ${entry.fix ? 'yes' : ''} | ${cell(entry.emitters.join(', '))} |`),
    ...(unresolved.length ? ['', '## Codes the list cannot resolve', '', ...unresolved.map((entry) => `- \`${entry.at}\`: \`${cell(entry.text)}\``)] : []),
    '',
  ].join('\n');
}

/** Code-shaped names in a text: backticked, or after "such as" in the tool text. */
const named = (text) => [...text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`|such as ([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/g)].map((match) => match[1] ?? match[2]);

/**
 * The three checks: every code matches the telemetry pattern, every code named
 * in the tool text, the skill or the manual exists, and every code with two
 * severities is on MULTI_SEVERITY. An unresolved producer fails too.
 */
export function checkWarningCodes({ codes, unresolved, literals }, texts, pattern) {
  const known = new Set(codes.map((entry) => entry.code));
  const problems = [];
  for (const entry of unresolved) problems.push(`${entry.at}: the code ${entry.text} cannot be resolved to literals; narrow its type`);
  for (const { code } of codes) if (!pattern.test(code)) problems.push(`${code}: does not match the telemetry code pattern ${pattern}`);
  for (const [file, text] of texts) {
    for (const name of new Set(named(text))) {
      if (!known.has(name) && !literals.has(name) && !(name in NOT_CODES)) problems.push(`${file}: \`${name}\` names no code the source returns; fix the example, or add it to NOT_CODES when it is not a code`);
    }
  }
  for (const { code, severities } of codes) {
    if (severities.length > 1 && !(code in MULTI_SEVERITY)) problems.push(`${code}: has severities ${severities.join(', ')}; give each fact its own code, or add it to MULTI_SEVERITY with the reason`);
  }
  for (const code of Object.keys(MULTI_SEVERITY)) {
    if ((codes.find((entry) => entry.code === code)?.severities.length ?? 0) < 2) problems.push(`${code}: is on MULTI_SEVERITY but has one severity; remove it from the list`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = extractWarningCodes(ROOT);
  if (process.argv.includes('--check')) {
    const { toolDefinitions } = await import('../src/mcp/tools.ts');
    const { CODE_PATTERN } = await import('../src/telemetry/schema.ts');
    const texts = new Map([
      ['src/mcp/tools.ts', JSON.stringify(toolDefinitions())],
      ...['release/plugin/boardplot-marketplace/plugins/boardplot/skills/boardplot-chart/SKILL.md', 'docs/manual.md']
        .map((file) => [file, readFileSync(resolve(ROOT, file), 'utf8')]),
    ]);
    const problems = checkWarningCodes(result, texts, CODE_PATTERN);
    for (const problem of problems) console.error(problem);
    console.log(problems.length ? `${problems.length} problem(s) in ${result.codes.length} codes` : `${result.codes.length} codes checked`);
    process.exitCode = problems.length ? 1 : 0;
  } else {
    console.log(JSON.stringify({ codes: result.codes, unresolved: result.unresolved }, null, 1));
  }
}
