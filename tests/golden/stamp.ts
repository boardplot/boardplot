import { createHash } from 'node:crypto';

/**
 * The engine stamp changes on every release. Pinned SVG and markup hashes mask
 * it, so a release that only bumps ENGINE_REV keeps every pin. The speed tool
 * uses the same mask to compare a release with the previous one.
 */
export const maskEngineStamp = (text: string): string => text.replace(/data-bp-engine="[^"]*"/g, 'data-bp-engine=""');

export const stampFreeSha = (text: string): string => createHash('sha256').update(maskEngineStamp(text), 'utf8').digest('hex');
