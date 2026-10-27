import { CLAIMS_SCHEMA, ENGINE_REV, CANONICALIZER, ENGINE_VERSION } from '../engine';
import type { ClaimRecordV1 } from './browser';

export interface ManifestEntry {
  chart: string;
  type: string;
  artifact: string;
  artifactSha256: string;
  sourceSha256: string;
  themeSha256: string;
  claims: ClaimRecordV1[];
}

export interface ManifestV1 {
  bpManifest: 1;
  engine: { version: string; claimsSchema: number; rev: number };
  canonicalizer: number;
  allowed?: string[];
  entries: ManifestEntry[];
}

export function buildManifest(
  entries: ManifestEntry[],
  allowed: readonly string[] = [],
): ManifestV1 {
  return {
    bpManifest: 1,
    engine: { version: ENGINE_VERSION, claimsSchema: CLAIMS_SCHEMA, rev: ENGINE_REV },
    canonicalizer: CANONICALIZER,
    ...(allowed.length > 0 ? { allowed: [...allowed] } : {}),
    entries: [...entries]
      .sort((a, b) => (a.chart < b.chart ? -1 : a.chart > b.chart ? 1 : 0)),
  };
}
