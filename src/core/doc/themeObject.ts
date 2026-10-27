/**
 * A spec's root `theme` may be a full token object. The CLI,
 * the MCP server and BoardplotChart adopt it the same way: check its shape and
 * keep it under a content-addressed name (its own name plus a hash of its
 * tokens), so a parsed request renders with its own tokens even when a later
 * spec brings a different theme under the same name. The adopted theme's
 * `ref` carries every token, so a parsed request stays resolvable when the
 * bounded lookup cache (core/themeStore) evicts the name. A theme identical to a
 * preset (a preset's own file) resolves to the preset; a different theme under
 * a preset's name is refused.
 *
 * The perceptual rules (contrast, separation) are passed in as `judge`: the
 * CLI and MCP pass `validateTheme`, the browser spec entry does not, as it
 * already leaves those rules out for `{ preset, overrides }`.
 */
import { canonicalJson } from '../claims/canonical';
import { resolveTheme, themes } from '../theme';
import { canonicalLanguage, NormalizeError } from '../normalize/shared';
import type { JsonPatchOperation } from '../diagnostics/jsonPatch';
import { adoptTheme } from '../themeStore';
import { checkThemeShape, unknownThemeKeyRepair } from '../themeShape';
import type { Theme, ThemeRef } from '../types/theme';
import type { LintWarning } from '../types/scene';
import { linkThemeShapeRules } from '../themeShapeRules';

// Links the theme checks `resolveTheme` runs over a patched theme, so a spec
// with `theme.overrides` validates synchronously in every entry that holds
// this module (see core/deferred). A call, not a bare import: a host bundler
// drops a bare import of a module that package.json does not list as
// side-effectful, and then validation throws `DeferredCoreError`.
linkThemeShapeRules();

type AdoptedTheme =
  | { ok: true; name: string; ref: ThemeRef; warnings: LintWarning[] }
  | { ok: false; code: string; message: string; suggest: string; fix?: JsonPatchOperation[] };

/** A theme object is any object that is not `{ preset, overrides }`. */
export function isThemeObject(theme: unknown): theme is Record<string, unknown> {
  return theme !== null && typeof theme === 'object' && !Array.isArray(theme) && !Object.hasOwn(theme, 'preset');
}

export function adoptThemeObject(
  theme: Record<string, unknown>,
  judge: (theme: Theme) => LintWarning[] = () => [],
): AdoptedTheme {
  const issues = checkThemeShape(theme);
  if (issues.length) {
    const repair = unknownThemeKeyRepair(issues, '/theme');
    return {
      ok: false, code: 'invalid-theme', message: `theme: ${issues.join('; ')}`,
      suggest: repair?.suggest ?? 'Send a preset name, { preset, overrides }, or a theme object that describe theme accepts.',
      ...(repair ? { fix: repair.fix } : {}),
    };
  }
  const candidate = theme as unknown as Theme;
  const findings = judge(candidate);
  const failed = findings.filter((finding) => finding.severity === 'error');
  if (failed.length) {
    return {
      ok: false, code: failed[0]!.code, message: failed.map((finding) => finding.message).join('; '),
      suggest: failed[0]!.suggest ?? 'Fix the theme tokens named in the message.',
    };
  }
  const tokens = canonicalJson(candidate);
  // A name the registry holds (a preset, or a theme the host registered)
  // resolves to it when the tokens match and is refused when they differ.
  if (Object.hasOwn(themes, candidate.name)) {
    if (canonicalJson(themes[candidate.name]) === tokens) {
      return { ok: true, name: candidate.name, ref: candidate.name, warnings: findings.filter((finding) => finding.severity !== 'error') };
    }
    return {
      ok: false, code: 'theme-name-reserved', message: `'${candidate.name}' is a registered theme and these tokens differ from it`,
      suggest: 'Give the theme its own name, or pass the registered name.',
    };
  }
  const name = `${candidate.name}#${contentHash(tokens)}`;
  adoptTheme({ ...candidate, name });
  // The request carries every token: the store is only a lookup cache, and
  // resolveTheme falls back to these tokens when the cache has evicted the name.
  return { ok: true, name, ref: { preset: name, overrides: candidate }, warnings: findings.filter((finding) => finding.severity !== 'error') };
}

/** A 53-bit string hash (cyrb53), hex: an identity for theme tokens, not a security measure. */
function contentHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * The document root's theme and locale, checked once at /theme and /locale.
 * Resolved per chart, their errors named options.theme or
 * options.locale.language, which the spec does not have, once for every chart.
 */
export function rootContextErrors(root: { theme?: unknown; locale?: unknown }): {
  code: string; message: string; path: string; suggest?: string; fix?: NormalizeError['fix']; docs: string;
}[] {
  const errors = [];
  if (typeof root.locale === 'string' && canonicalLanguage(root.locale) === null) {
    errors.push({ code: 'invalid-locale', message: `'${root.locale}' is not a BCP 47 language tag`, path: '/locale', suggest: 'use a tag such as "de" or "de-DE"', docs: 'docs/reference/options.md#options' });
  }
  if (root.theme !== undefined) {
    try {
      resolveTheme(root.theme as ThemeRef);
    } catch (error) {
      if (!(error instanceof NormalizeError)) throw error;
      // The theme's own errors point into a chart's options; at the root the same field drops that segment.
      errors.push({
        code: error.code, message: error.message, path: `/${error.path.replace(/^options\./, '').split('.').join('/')}`,
        ...(error.suggest ? { suggest: error.suggest } : {}),
        ...(error.fix ? { fix: error.fix.map((operation) => ({ ...operation, path: operation.path.replace(/^\/options/, '') })) } : {}),
        docs: 'docs/reference/theme.md#theme',
      });
    }
  }
  return errors;
}
