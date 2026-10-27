/**
 * Versioned document schema identity and `$schema` hint recognition.
 *
 * The document format version lives in the `version` field; `$schema` is the
 * hint an editor or a tool uses to find the published JSON Schema. Both the
 * export (`boardplot schema`) and the document lint hint read the identity from
 * here, so the published URL cannot drift between the two.
 */

const BOARDPLOT_SCHEMA_ORIGIN = 'https://boardplot.com/schema';

/** The only document format version this runtime parses (`documentSchema`). */
export const DOCUMENT_SCHEMA_VERSION = 1;

/** Published v1 document schema, byte-identical to the hint in shipped documents. */
export const DOCUMENT_SCHEMA_ID = `${BOARDPLOT_SCHEMA_ORIGIN}/v${DOCUMENT_SCHEMA_VERSION}/boardplot-doc.json`;

type DocumentSchemaHintKind =
  | 'absent'
  | 'current'
  | 'other-boardplot-version'
  | 'other-boardplot-artifact'
  | 'foreign';

interface DocumentSchemaHint {
  kind: DocumentSchemaHintKind;
  /** The hint verbatim, for any hint that points at a boardplot schema. */
  id?: string;
  /** Version segment of a boardplot schema id. */
  version?: number;
  /** Artifact name of a boardplot schema id, without the `.json` suffix. */
  artifact?: string;
}

const BOARDPLOT_SCHEMA_ID = /^https:\/\/boardplot\.com\/schema\/v(\d+)\/([a-z0-9][a-z0-9.-]*)\.json$/;

/**
 * Classify a `$schema` hint. Anything this reader does not implement stays
 * `foreign` and silent: many editors write their own URL there, and the
 * document schema has always accepted any string. Only a hint that claims to
 * be a boardplot schema gets a message, because only then does it promise a
 * format this reader may not be reading.
 */
export function documentSchemaHint(raw: unknown): DocumentSchemaHint {
  if (typeof raw !== 'string') return { kind: 'absent' };
  const match = BOARDPLOT_SCHEMA_ID.exec(raw);
  if (!match) return { kind: 'foreign' };
  const [, versionText, artifact] = match;
  if (versionText === undefined || artifact === undefined) return { kind: 'foreign' };
  const parts = { id: raw, version: Number(versionText), artifact };
  if (Number(versionText) !== DOCUMENT_SCHEMA_VERSION) return { ...parts, kind: 'other-boardplot-version' };
  if (artifact !== 'boardplot-doc') return { ...parts, kind: 'other-boardplot-artifact' };
  return { ...parts, kind: 'current' };
}

/** One warn-only sentence, or undefined when the hint needs no mention. */
export function documentSchemaHintWarning(hint: DocumentSchemaHint): string | undefined {
  if (hint.kind === 'other-boardplot-version') {
    return `$schema '${hint.id}' names boardplot schema version ${hint.version}; this reader parses document version ${DOCUMENT_SCHEMA_VERSION} (${DOCUMENT_SCHEMA_ID}). The hint itself selects nothing: the document's 'version' field decides the format.`;
  }
  if (hint.kind === 'other-boardplot-artifact') {
    return `$schema '${hint.id}' points at the boardplot schema '${hint.artifact}', which is not the document schema ${DOCUMENT_SCHEMA_ID}. The hint has no effect on parsing.`;
  }
  return undefined;
}
