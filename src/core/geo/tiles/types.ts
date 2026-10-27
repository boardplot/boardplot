export type TilePackId = 'eu27' | 'europe' | 'world' | 'us-states';

export interface TileRegionRecord {
  id: string;
  aliases: readonly string[];
  name: string;
  shortName: string;
  row: number;
  col: number;
}

interface TileAdjacency {
  a: string;
  b: string;
}

interface TileAdjacencyException extends TileAdjacency {
  kind: 'missing' | 'extra';
}

interface TilePackMeta {
  layoutAuthor: 'Boardplot';
  layoutSource: 'Boardplot original';
  layoutSourceUrl: string;
  layoutVersion: string;
  license: 'Boardplot project license';
  memberDate: string;
  sourcePack: TilePackId;
  attribution: string;
  adjacencyExceptions: readonly TileAdjacencyException[];
}

export interface TilePack {
  id: TilePackId;
  rows: number;
  cols: number;
  regions: readonly TileRegionRecord[];
  geographicAdjacencies: readonly TileAdjacency[];
  meta: TilePackMeta;
}
