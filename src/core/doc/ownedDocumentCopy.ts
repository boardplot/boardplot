/**
 * Deep-copy a JSON document onto null-prototype objects so inherited keys
 * cannot cross into layout or validation code.
 */
export function ownedDocumentCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => ownedDocumentCopy(entry)) as T;
  if (value !== null && typeof value === 'object') {
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      copy[key] = ownedDocumentCopy((value as Record<string, unknown>)[key]);
    }
    return copy as T;
  }
  return value;
}
