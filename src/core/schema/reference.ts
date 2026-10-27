/** Field metadata shared by generated references and chart discovery. */
export interface SchemaFieldReference {
  path: string;
  type: string;
  required: boolean;
  description: string;
  values?: unknown[];
  /** False when these literals are one branch of a union that also permits other shapes. */
  valuesExhaustive?: boolean;
  default?: unknown;
  /**
   * What the default depends on, where it has no one value: option
   * paths, `data.*` paths, `theme` or `size`. From the schema's
   * `x-boardplot-defaultDependsOn` annotation.
   */
  defaultDependsOn?: string[];
  /**
   * The default is a schema annotation (`.meta({ default })`) the engine
   * applies in layout, not a registered default merged into the options.
   * Full rows, paths, the JSON Schema and the reference print it; compact
   * rows leave it out to hold the discovery token ceiling.
   */
  defaultInSchema?: true;
  /** Object-union branch that owns this field. Required applies within this branch. */
  branch?: string;
}

export function markdownCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

type JsonSchema = Record<string, unknown>;

function object(value: unknown): JsonSchema | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchema : undefined;
}

function resolve(schema: JsonSchema, root: JsonSchema, refs = new Set<string>()): JsonSchema {
  if (typeof schema.$ref !== 'string') return schema;
  if (refs.has(schema.$ref)) return { ...schema, $ref: undefined };
  if (!schema.$ref.startsWith('#/')) throw new Error(`Unsupported schema reference: ${schema.$ref}`);
  let target: unknown = root;
  for (const key of schema.$ref.slice(2).split('/')) {
    target = object(target)?.[key.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (!object(target)) throw new Error(`Missing schema reference: ${schema.$ref}`);
  return { ...resolve(object(target)!, root, new Set([...refs, schema.$ref])), ...schema, $ref: undefined };
}

function alternatives(schema: JsonSchema): JsonSchema[] {
  return ['anyOf', 'oneOf', 'allOf'].flatMap(key => {
    const branches = schema[key];
    return Array.isArray(branches)
      ? branches.map(object).filter((branch): branch is JsonSchema => branch !== undefined) : [];
  });
}

function allowed(schema: JsonSchema, root: JsonSchema, refs = new Set<string>()): { values: unknown[]; exhaustive: boolean } | undefined {
  if (typeof schema.$ref === 'string') {
    if (refs.has(schema.$ref)) return undefined;
    refs = new Set([...refs, schema.$ref]);
  }
  const field = resolve(schema, root);
  if (Array.isArray(field.enum)) return { values: field.enum, exhaustive: true };
  if (Object.hasOwn(field, 'const')) return { values: [field.const], exhaustive: true };
  // An intersection can further restrict a union. Do not advertise a union as its allowed set.
  if (field.allOf) return undefined;
  // A branch marked x-boardplot-retiring still parses but is not offered.
  const branches = alternatives(field).filter(branch => !branch['x-boardplot-retiring']).map(branch => allowed(branch, root, refs));
  const values = [...new Set(branches.flatMap(branch => branch?.values ?? []))];
  return values.length ? { values, exhaustive: branches.every(branch => branch?.exhaustive) } : undefined;
}

function fieldType(schema: JsonSchema, root: JsonSchema, refs = new Set<string>()): string {
  if (typeof schema.$ref === 'string') {
    if (refs.has(schema.$ref)) return 'recursive';
    refs = new Set([...refs, schema.$ref]);
  }
  const field = resolve(schema, root);
  if (object(field.not) && !Object.keys(object(field.not)!).length) return 'never';
  // A boolean const accepts ONE of the two values, so naming it `boolean`
  // invites the other (the validator would refuse `true` where the type says
  // `boolean`). The literal names itself. It is read BEFORE `type`,
  // because a literal carries both (`{ type: 'boolean', const: false }`).
  if (typeof field.const === 'boolean') return String(field.const);
  if (Array.isArray(field.type)) return field.type.join(' | ');
  if (typeof field.type === 'string') return field.type;
  if (Object.hasOwn(field, 'const')) return field.const === null ? 'null' : typeof field.const;
  const branches = alternatives(field);
  if (branches.length) return [...new Set(branches.map(branch => fieldType(branch, root, refs)))].join(field.allOf ? ' & ' : ' | ');
  return 'unknown';
}

function defaultAt(defaults: unknown, path: string[]): unknown {
  let value = defaults;
  for (const key of path) {
    const record = object(value);
    if (!record || !Object.hasOwn(record, key)) return undefined;
    value = record[key];
  }
  return value;
}

/** Read declared fields. Missing descriptions fail with the exact schema field path. */
export function schemaReference(schema: JsonSchema, defaults?: unknown): SchemaFieldReference[] {
  const fields: SchemaFieldReference[] = [];
  const missing = new Set<string>();
  const visit = (input: JsonSchema, path: string[], refs: Set<string>, branch?: string): void => {
    if (typeof input.$ref === 'string') {
      if (refs.has(input.$ref)) return;
      refs = new Set([...refs, input.$ref]);
    }
    const node = resolve(input, schema);
    const properties = object(node.properties) ?? {};
    for (const [key, raw] of Object.entries(properties)) {
      if (!object(raw)) continue;
      const child = resolve(object(raw)!, schema);
      const parts = [...path, key];
      const description = typeof child.description === 'string' ? child.description.trim() : '';
      if (!description) missing.add(parts.join('.'));
      const value = Object.hasOwn(child, 'default') ? child.default : defaultAt(defaults, parts);
      const dependsOn = Array.isArray(child['x-boardplot-defaultDependsOn']) ? child['x-boardplot-defaultDependsOn'].map(String) : undefined;
      // An array of enumerated items lists the items' values, as `string[]`.
      const items = child.type === 'array' ? object(child.items) : undefined;
      const itemValues = items ? allowed(items, schema) : undefined;
      const values = allowed(object(raw)!, schema) ?? itemValues;
      fields.push({ path: parts.join('.'), type: itemValues && items ? `${fieldType(items, schema)}[]` : fieldType(object(raw)!, schema),
        required: Array.isArray(node.required) && node.required.includes(key), description,
        ...(values ? { values: values.values, valuesExhaustive: values.exhaustive } : {}),
        ...(value !== undefined ? { default: value } : dependsOn ? { defaultDependsOn: dependsOn } : {}),
        ...(Object.hasOwn(child, 'default') ? { defaultInSchema: true as const } : {}),
        ...(branch ? { branch } : {}),
      });
      visit(object(raw)!, parts, refs, branch);
    }
    const choices = alternatives(node);
    const objectUnion = !node.allOf && choices.filter(choice => object(resolve(choice, schema).properties)).length > 1;
    choices.forEach((choice, index) => visit(choice, path, refs, objectUnion
      ? [branch, `${path.join('.')} branch ${index + 1}`].filter(Boolean).join('; ') : branch));
    if (object(node.items)) visit(object(node.items)!, [...path.slice(0, -1), `${path.at(-1) ?? ''}[]`], refs, branch);
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((item, index) => {
      if (object(item)) visit(object(item)!, [...path.slice(0, -1), `${path.at(-1) ?? ''}[${index}]`], refs, branch);
    });
    if (object(node.additionalProperties)) visit(object(node.additionalProperties)!, [...path, '*'], refs, branch);
  };
  visit(schema, [], new Set());
  if (missing.size) throw new Error(`Schema fields need descriptions: ${[...missing].join(', ')}`);
  return fields;
}
