/**
 * zod tries `new Function` when it builds its first object schema, and it compiles object parsers with it. A page whose
 * content security policy has no 'unsafe-eval' reports each call. zod reads this page-wide setting when it builds a
 * schema, so the browser code of Boardplot sets it before it loads the chunk that builds them. Only browser code calls
 * it: a server, the CLI and the MCP server keep zod's own mode.
 */
export function withoutZodCodeGeneration(): void {
  ((globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig ??= {}).jitless = true;
}
