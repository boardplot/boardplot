/**
 * `fixtures`: complete, runnable example specs in the bare shape. The CLI and MCP default to kind `example`; the package export
 * `boardplot/fixtures` keeps returning every fixture.
 */
import '../core/charts';
import { getFixtures } from '../fixtures';
import { getChart, listCharts } from '../core/registry';
import { InputError, ok, type VerbResult } from './result';
import { unknownType } from './describe';
import { chartIdOf } from '../core/catalog';

interface FixturesInput {
  type?: unknown;
  id?: unknown;
  kind?: unknown;
  cursor?: unknown;
}

const FIXTURES_PER_PAGE = 25;
const KINDS = ['example', 'torture', 'all'] as const;

type Fixture = ReturnType<typeof getFixtures>[number];

function specOf(type: string, fixture: Fixture) {
  return {
    type,
    data: structuredClone(fixture.data),
    ...(fixture.options ? { options: structuredClone(fixture.options) } : {}),
    ...(fixture.annotations ? { annotations: structuredClone(fixture.annotations) } : {}),
  };
}

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new InputError('invalid-argument', `${name} must be a non-empty string`, { path: `/${name}`, expected: { types: ['string'] } });
  }
  return value;
}

function cursorOf(value: unknown): number {
  if (value === undefined) return 0;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new InputError('invalid-argument', 'cursor must be a nextCursor value from an earlier call', { path: '/cursor' });
  }
  return offset;
}

function candidates(type: string | undefined): { fixture: Fixture; type: string }[] {
  if (type !== undefined && !getChart(type)) throw unknownType(type);
  const types = type === undefined ? listCharts().map((chart) => chart.type).sort() : [getChart(type)!.type];
  return types.flatMap((owner) => getFixtures(owner).map((fixture) => ({ fixture, type: owner })));
}

function kindOf(value: unknown): (typeof KINDS)[number] {
  const kind = value ?? 'example';
  if (!(KINDS as readonly unknown[]).includes(kind)) {
    throw new InputError('invalid-argument', 'kind must be example, torture or all', {
      path: '/kind', expected: { values: [...KINDS] }, fix: [{ op: 'replace', path: '/kind', value: 'example' }],
    });
  }
  return kind as (typeof KINDS)[number];
}

/** The MCP tool pages its listing; the CLI passes `Infinity` and prints every match. */
export function fixtures(input: FixturesInput, perPage = FIXTURES_PER_PAGE): VerbResult {
  const type = optionalString('type', input.type);
  const id = optionalString('id', input.id);
  const kind = kindOf(input.kind);
  let matched = candidates(type);
  // An id names one fixture of any kind; kind filters only a listing.
  if (id !== undefined) {
    matched = matched.filter((entry) => entry.fixture.id === id);
    if (!matched.length) {
      throw new InputError('unknown-fixture', `no fixture with id '${id}'${type ? ` for type '${type}'` : ''}`, {
        path: '/id', suggest: 'Call boardplot_fixtures without id, or boardplot_describe for the ids of one type.',
      });
    }
    // Ids are unique within a type only; an id two types share needs the type.
    if (matched.length > 1) {
      const types = matched.map((entry) => entry.type);
      throw new InputError('ambiguous-fixture', `fixture id '${id}' exists for ${types.join(' and ')}; pass type as well`, {
        path: '/type', expected: { values: types }, suggest: types.map(type => `CLI: boardplot fixtures --type ${type} --id ${id}. MCP: boardplot_fixtures ${JSON.stringify({ type, id })}.`).join(' '),
      });
    }
  } else if (kind !== 'all') {
    matched = matched.filter((entry) => entry.fixture.kind === kind);
  }
  const offset = cursorOf(input.cursor);
  const page = matched.slice(offset, offset + perPage);
  const next = offset + perPage < matched.length ? String(offset + perPage) : undefined;
  return ok({
    fixtures: page.map(({ fixture, type: owner }) => ({
      id: fixture.id,
      type: owner,
      chart: chartIdOf(owner, fixture.data, fixture.options),
      kind: fixture.kind,
      useCase: fixture.title,
      spec: specOf(owner, fixture),
    })),
    ...(next ? { nextCursor: next, note: `${matched.length} fixtures match; narrow with type or kind, or pass cursor ${next}` } : {}),
  });
}
