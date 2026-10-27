/**
 * Claims + manifest (Manifest v1). The engine's record of every derived
 * number, and the receipt shape the React export returns. Claims are not
 * embedded in SVGs; the manifest is the single authority.
 */

export { claimsForChart, CLAIM_KIND_GROUPS, CLAIM_KINDS } from './browser';
export type { ClaimKind, ClaimRecordV1 } from './browser';
export { canonicalJson } from './canonical';
export { buildManifest } from './manifest';
export type { ManifestEntry, ManifestV1 } from './manifest';
export { CLAIMS_SCHEMA, ENGINE_REV, CANONICALIZER, ENGINE_VERSION } from '../engine';

export { sha256 } from './sha256';
