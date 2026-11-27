import type { TileAdjacency, TileAdjacencyException } from './types';

type Neighbors<T> = readonly (readonly [string, ...T[]])[];

/** A neighbor in brackets shares a geographic border but does not touch on the tile map. */
export function tileBorders(geographic: Neighbors<string | readonly [string]>, extra: Neighbors<string>) {
  const geographicAdjacencies: TileAdjacency[] = [];
  const adjacencyExceptions: TileAdjacencyException[] = [];
  for (const [a, ...neighbors] of extra) {
    for (const b of neighbors) adjacencyExceptions.push({ a, b, kind: 'extra' });
  }
  for (const [a, ...neighbors] of geographic) {
    for (const neighbor of neighbors) {
      const b = typeof neighbor === 'string' ? neighbor : neighbor[0];
      geographicAdjacencies.push({ a, b });
      if (typeof neighbor !== 'string') adjacencyExceptions.push({ a, b, kind: 'missing' });
    }
  }
  return { geographicAdjacencies, adjacencyExceptions };
}
