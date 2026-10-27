import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Theme, ThemeRef } from '../core/types/theme';
import { ReaderBox, type PlaceholderFrame } from './SizePlaceholder';

/** Invalid specs share the lazy reader frame; only full mode loads diagnostic details. */
export function SpecErrorCard({ errors, theme, ...frame }: PlaceholderFrame & { errors: readonly DocumentFinding[]; theme?: Theme | ThemeRef }) {
  return <ReaderBox {...frame} theme={theme} kind="spec-error" findings={errors} spec />;
}
