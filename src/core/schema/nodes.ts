import * as z from 'zod';

export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  not?: object;
  const?: unknown;
  minimum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  enum?: unknown[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
  description?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
  propertyNames?: JsonSchemaNode;
  additionalProperties?: JsonSchemaNode | boolean;
}

/**
 * The schema nodes at `path`, with every `$ref` resolved (a lazy schema such
 * as a recursive calc or row sits behind one) and a record's value node
 * under each of its keys.
 */
export function schemaNodeAtPath(schema: z.ZodType, path: readonly (string | number)[]): JsonSchemaNode[] {
  const root = z.toJSONSchema(schema, { io: 'input' }) as JsonSchemaNode;
  const resolve = (node: JsonSchemaNode): JsonSchemaNode => {
    const resolved = node.$ref?.startsWith('#/$defs/') ? root.$defs?.[node.$ref.slice('#/$defs/'.length)] : undefined;
    if (!resolved) return node;
    const branches = (list?: JsonSchemaNode[]) => list?.map(resolve);
    return { ...resolved, anyOf: branches(resolved.anyOf), oneOf: branches(resolved.oneOf), allOf: branches(resolved.allOf) };
  };
  let nodes = [root];
  for (const segment of path) {
    const next: JsonSchemaNode[] = [];
    for (const node of nodes) {
      const branches = [node, ...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])];
      for (const branch of branches) {
        if (typeof segment === 'number') {
          if (branch.items) next.push(resolve(branch.items));
        } else if (branch.properties?.[segment]) {
          next.push(resolve(branch.properties[segment]));
        } else if (typeof branch.additionalProperties === 'object' && (branch.propertyNames?.enum ?? [segment]).includes(segment)) {
          next.push(resolve(branch.additionalProperties));
        }
      }
    }
    nodes = next;
  }
  return nodes;
}
