// @vitest-environment jsdom
/**
 * The per-type React entries refuse an option prop the type does not
 * take, as the CLI, MCP and react/spec do. Each entry
 * carries the key tree of its options schema (scripts/generate-chart-entries.mjs).
 * An invented key at the root and inside an option object draws the
 * unknown-option card with the suggest the CLI gives, and the layout never
 * runs. React's own props are taken off before the check, and every fixture
 * passes its entry's tree.
 */
import { act, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createRoot, type Root } from 'react-dom/client';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { chartLoaders } from '../src/react/chartLoaders';
import { loadedDeferred } from '../src/core/deferred';
import { unknownKeys, type OptionKeys } from '../src/core/schema/unknownKeys';
import * as sharedOptionKeys from '../src/react/optionKeyTrees';
import '../src/core/geo/packs';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const INVENTED = 'zzInvented';
const TYPES = Object.keys(chartLoaders).sort();
const SIZE = { width: 960, height: 640 };
const REACT = join(__dirname, '..', 'src', 'react');
const optionKeyContext = createContext({ ...sharedOptionKeys });

type Component = (props: Record<string, unknown>) => ReactElement;

async function componentOf(type: string): Promise<Component> {
  const module = await chartLoaders[type]!() as Record<string, unknown>;
  const found = Object.values(module).find((value) => typeof value === 'function' && (value as { chartType?: string }).chartType === type);
  if (!found) throw new Error(`the ${type} entry publishes no component`);
  return found as Component;
}

/** Mount, let every pending chunk land, and read the markup back. */
async function mount(element: ReactElement): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  await act(async () => { root = createRoot(host); root.render(element); });
  const deadline = Date.now() + 20_000;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  }
  const markup = host.innerHTML;
  await act(async () => { root!.unmount(); });
  host.remove();
  return markup;
}

/**
 * The suggest the spec path (the CLI's validateChartInput) gives the key at
 * `pointer`. Imported late: it links the wording a per-type entry fetches.
 */
async function cliSuggest(spec: object, pointer: string): Promise<string | undefined> {
  const { parseChartSpec } = await import('../src/react/parseChartSpec');
  try {
    await parseChartSpec(spec);
  } catch (error) {
    const errors = (error as { errors?: { code: string; path?: string; suggest?: string }[] }).errors ?? [];
    return errors.find((finding) => finding.code === 'unknown-option' && finding.path?.endsWith(pointer))?.suggest;
  }
  return undefined;
}

/** The key tree a generated entry passes to its component. */
function entryKeys(type: string): OptionKeys {
  const source = readFileSync(join(REACT, 'charts', `${type}.ts`), 'utf8');
  const expression = /^const checkOptionKeys = optionKeyCheck\((.*)\);$/m.exec(source)![1]!;
  return runInContext(`(${expression})`, optionKeyContext) as OptionKeys;
}

/** The TypeScript view of the components: their React-only props, and a checker over every entry. */
let typed: ReturnType<typeof createTypeProgram> | undefined;
function typeProgram() {
  typed ??= createTypeProgram();
  return typed;
}

function createTypeProgram() {
  const files = { chart: join(REACT, 'createChartComponent.tsx'), table: join(REACT, 'TableChart.tsx') };
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(join(__dirname, '..', 'tsconfig.json'), ts.sys.readFile).config, ts.sys, join(__dirname, '..'));
  const program = ts.createProgram([...Object.values(files), ...TYPES.map((type) => join(REACT, 'charts', `${type}.ts`))], config.options);
  const checker = program.getTypeChecker();
  const propsOf = (file: string, name: string): string[] => {
    let symbol = checker.getSymbolsInScope(program.getSourceFile(file)!, ts.SymbolFlags.Type | ts.SymbolFlags.Alias).find((candidate) => candidate.name === name)!;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol.declarations![0]!;
    const type = ts.isTypeAliasDeclaration(declaration) ? checker.getTypeFromTypeNode(declaration.type) : checker.getDeclaredTypeOfSymbol(symbol);
    return checker.getPropertiesOfType(type).map((property) => property.name);
  };
  const tableOptions = new Set(propsOf(files.table, 'TableOptions'));
  return {
    program, checker, files,
    chartProps: propsOf(files.chart, 'ChartComponentProps'),
    tableProps: propsOf(files.table, 'TableChartProps').filter((name) => !tableOptions.has(name)),
  };
}

/** A key typed as refused: never, or an object whose every field is never (BaseOptionsFor's Refused). */
function refusedType(checker: ts.TypeChecker, type: ts.Type): boolean {
  const members = (type.isUnion() ? type.types : [type]).filter((member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
  return members.every((member) => member.flags & ts.TypeFlags.Never || (member.flags & ts.TypeFlags.Object
    && checker.getPropertiesOfType(member).length > 0
    && checker.getPropertiesOfType(member).every((property) => refusedType(checker, checker.getTypeOfSymbol(property)))));
}

describe('per-type React entries refuse unknown option keys', { timeout: 120_000 }, () => {
  it('refuses an invented key on a bar', async () => {
    const fixture = getFixtures('bar')[0]!;
    const Bar = await componentOf('bar');
    const markup = await mount(<Bar {...structuredClone(fixture.options ?? {}) as Record<string, unknown>} data={structuredClone(fixture.data)} size={SIZE} {...{ [INVENTED]: 1 }} />);
    expect(markup).toContain(`data-bp-error-path="options.${INVENTED}"`);
  });

  it('refuses an unknown key with the theme checks loaded by the earlier reader card', async () => {
    // The lazy reader validates full themes too, so the earlier refusal loaded these checks.
    expect(loadedDeferred('theme-rules')).toBeDefined();
    const fixture = getFixtures('bar')[0]!;
    const Bar = await componentOf('bar');
    const markup = await mount(<Bar {...structuredClone(fixture.options ?? {}) as Record<string, unknown>} data={structuredClone(fixture.data)} size={SIZE}
      theme={{ preset: 'boardroom', overrides: { color: { ink: '#1A2B3C' } } }} {...{ [INVENTED]: 1 }} />);
    expect(loadedDeferred('theme-rules')).toBeDefined();
    expect(markup).toContain(`data-bp-error-path="options.${INVENTED}"`);
  });

  it('refuses an unknown key in the strings of a BoardplotTheme provider, and takes a reader key', async () => {
    const { BoardplotTheme } = await import('../src/react/BoardplotTheme');
    for (const type of ['pie', 'table']) {
      const fixture = getFixtures(type)[0]!;
      const Chart = await componentOf(type);
      const draw = (strings: Record<string, string>) => mount(<BoardplotTheme strings={strings as never}>
        <Chart {...structuredClone(fixture.options ?? {}) as Record<string, unknown>} data={structuredClone(fixture.data)} size={SIZE} />
      </BoardplotTheme>);
      const markup = await draw({ highlight: 'Old' });
      const card = new DOMParser().parseFromString(markup, 'text/html').querySelector('[data-bp-error-path="BoardplotTheme.strings.highlight"]');
      expect(card?.getAttribute('data-bp-error-code'), type).toBe('unknown-option');
      expect(markup, `${type} drew`).not.toContain('<svg');
      expect(await draw({ emptyHint: 'Pick another month.', loading: 'Loading' }), `${type} reader keys`).toContain('<svg');
    }
  });

  it.each(TYPES)('%s refuses a root and a nested invented key before anything draws', async (type) => {
    const fixture = getFixtures(type).find((candidate) => candidate.tags.includes('demo')) ?? getFixtures(type)[0]!;
    const Chart = await componentOf(type);
    const probes: [Record<string, unknown>, string][] = [
      [{ [INVENTED]: 1 }, INVENTED],
      [{ subtitle: { measure: 'Orders', [INVENTED]: 1 } }, `subtitle.${INVENTED}`],
    ];
    for (const [probe, dotted] of probes) {
      const options = { ...structuredClone(fixture.options ?? {}) as Record<string, unknown>, ...probe };
      const suggest = await cliSuggest({ type, data: fixture.data, options }, `/options/${dotted.replaceAll('.', '/')}`);
      expect(suggest, `${type} ${dotted}: the CLI names a key`).toMatch(/^(Rename '[^']+' to '[^']+'\.|Remove '[^']+'; this key is not supported here\.)$/);
      const onGeometry = vi.fn();
      const markup = await mount(<Chart {...options} data={structuredClone(fixture.data)} size={SIZE} onGeometry={onGeometry} />);
      const card = new DOMParser().parseFromString(markup, 'text/html').querySelector(`[data-bp-error-path="options.${dotted}"]`);
      expect(card?.getAttribute('data-bp-error-code'), `${type} ${dotted}`).toBe('unknown-option');
      expect(card?.closest('[data-bp-spec-error]')?.getAttribute('data-bp-diagnostics'), `${type} ${dotted}`).toContain(suggest);
      expect(markup, `${type} ${dotted} drew`).not.toContain('<svg');
      expect(onGeometry).not.toHaveBeenCalled();
    }
  });

  it('passes every option of every fixture through its entry', () => {
    const fixtures = TYPES.flatMap((type) => getFixtures(type).map((fixture) => ({ type, fixture })));
    const refused = fixtures.flatMap(({ type, fixture }) => unknownKeys((fixture.options ?? {}) as Record<string, unknown>, entryKeys(type))
      .map((found) => `${type}/${fixture.id}: ${found.path.join('.')}`));
    expect(refused).toEqual([]);
    expect(fixtures.length).toBeGreaterThan(300);
  });

  it('takes every React prop of every component off before the check', () => {
    const { program, files, chartProps, tableProps } = typeProgram();
    // The names a component destructures off `props`; the rest is what optionRefusals checks.
    const destructured = (file: string): string[] => {
      const names: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === 'props') {
          for (const element of node.name.elements) if (!element.dotDotDotToken) names.push((element.propertyName ?? element.name).getText());
        }
        ts.forEachChild(node, visit);
      };
      visit(program.getSourceFile(file)!);
      return names;
    };
    expect(chartProps).toEqual(expect.arrayContaining(['data', 'onGeometry', 'prepared', 'hover', 'idPrefix', 'fallbackSize', 'onRefused']));
    expect(tableProps).toEqual(expect.arrayContaining(['toolbar', 'collapsed', 'onCollapsedChange', 'onRowSelect', 'handleRef', 'portalContainer']));
    expect(chartProps.filter((name) => !destructured(files.chart).includes(name))).toEqual([]);
    expect(tableProps.filter((name) => !destructured(files.table).includes(name))).toEqual([]);
  });

  it('declares no option prop its schema does not take', () => {
    // A key the type offers and the schema strips drew in React and
    // nowhere else; with the key check it is refused there too. A key the
    // schema refuses by name is typed never, and `measure` is the host's.
    const { program, checker, chartProps, tableProps } = typeProgram();
    const offered = TYPES.flatMap((type) => {
      const file = program.getSourceFile(join(REACT, 'charts', `${type}.ts`))!;
      const component = checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)
        .map((symbol) => checker.getTypeOfSymbolAtLocation(symbol, file).getCallSignatures()[0])
        .find((signature) => signature !== undefined)!;
      const props = checker.getTypeOfSymbolAtLocation(component.parameters[0]!, file);
      const react = new Set([...(type === 'table' || type === 'dimswitch' ? tableProps : chartProps), 'measure', ...(type === 'dimswitch' ? ['defaultVariant','defaultDepth','defaultSplits','onViewChange'] : [])]);
      const tree = entryKeys(type).tree as Record<string, unknown>;
      return (props.isUnion() ? props.types : [props]).flatMap((member) => checker.getPropertiesOfType(member))
        .filter((property) => !react.has(property.name) && !Object.hasOwn(tree, property.name) && !refusedType(checker, checker.getTypeOfSymbol(property)))
        .map((property) => `${type}.${property.name}`);
    });
    expect([...new Set(offered)]).toEqual([]);
  });

  it('draws a table with its toolbar and fold props and refuses a canvas on a creative', async () => {
    const table = getFixtures('table')[0]!;
    const Table = await componentOf('table');
    const drawn = await mount(<Table {...structuredClone(table.options ?? {}) as Record<string, unknown>} data={structuredClone(table.data)}
      size={SIZE} toolbar={false} collapsed={[]} onCollapsedChange={() => {}} onRowSelect={() => {}} />);
    expect(drawn).not.toContain('data-bp-error-code');
    expect(drawn).toContain('role="treegrid"');
    const creative = getFixtures('creative')[0]!;
    const Creative = await componentOf('creative');
    const refused = await mount(<Creative {...structuredClone(creative.options ?? {}) as Record<string, unknown>} data={structuredClone(creative.data)}
      size={SIZE} canvas={{ margin: { top: 0 } }} />);
    expect(refused).toContain('data-bp-error-path="options.canvas"');
  });
});
