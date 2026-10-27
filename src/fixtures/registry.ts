import type { Fixture } from '../core/registry';

const fixtureRegistry = new Map<string, (Fixture<any, any> & { tags: string[] })[]>();
const refusalRegistry = new Map<string, (Fixture<any, any> & { tags: string[] })[]>();

/** Canonical classification first, followed by unique authored tags without mutating the fixture. */
export function fixtureTags(fixture: Pick<Fixture, 'kind' | 'tags'>): string[] {
  return [...new Set([fixture.kind === 'example' ? 'demo' : 'regression', ...(fixture.tags ?? [])])];
}

/** Register one chart family's authored examples without coupling them to its runtime definition. */
export function registerFixtures<D, O>(type: string, fixtures: Fixture<D, O>[]): void {
  if (fixtureRegistry.has(type)) {
    throw new Error(`fixtures for chart type '${type}' are already registered`);
  }
  const tagged = fixtures.map(fixture => ({ ...fixture, tags: fixtureTags(fixture) }));
  fixtureRegistry.set(type, tagged.filter(fixture => !fixture.refuses));
  refusalRegistry.set(type, tagged.filter(fixture => fixture.refuses));
}

export function getFixtures<D = any, O = any>(type: string): (Fixture<D, O> & { tags: string[] })[] {
  return (fixtureRegistry.get(type) ?? []) as (Fixture<D, O> & { tags: string[] })[];
}

/** The refusal examples of a type: specs refused on purpose, which getFixtures leaves out. */
export function getRefusalExamples<D = any, O = any>(type: string): (Fixture<D, O> & { tags: string[] })[] {
  return (refusalRegistry.get(type) ?? []) as (Fixture<D, O> & { tags: string[] })[];
}

export function allFixtures(): (Fixture<any, any> & { tags: string[] })[] {
  return [...fixtureRegistry.values()].flat();
}
