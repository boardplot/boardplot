import { lazy, Suspense, useContext, useEffect, useRef, type ReactNode, type ReactElement } from 'react';
import { NormalizeError, resolveSize } from '../core/normalize/shared';
import { canvasMargin, resolveTheme, themeForWidth } from '../core/theme';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Theme, ThemeRef } from '../core/types/theme';
import { localeStrings, stringFields } from '../core/strings';
import { sourceLine } from '../core/notes';
import { footerType } from '../core/footer';
import { checkThemeShape } from '../core/themeShape';
import { linkThemeShapeRules } from '../core/themeShapeRules';
import { readerStrings } from '../core/readerStrings';
import { DEFAULT_LOAD_FAILED_TEXT, placeholderStyle, BoardplotThemeContext } from './themeContext';
import { fullDiagnostics } from './diagnostics';
import type { PlaceholderFrame, RefusalProps } from './SizePlaceholder';
import type { RefusedLayout } from '../core/types/scene';

const DiagnosticDetails = lazy(() => import('./DiagnosticDetails').catch(() => ({ default: () => <span>{DEFAULT_LOAD_FAILED_TEXT}</span> })));
linkThemeShapeRules();

/** The reader frame is shared by empty, refused and invalid charts. */
export default function ReaderBox({ theme: ref, options = {}, size: explicitSize, fixedSize, kind, findings = [], children: suppliedChildren, result, onRefused, renderRefused, spec }: PlaceholderFrame & RefusalProps & {
  result?: RefusedLayout;
  theme?: Theme | ThemeRef; kind: 'refused' | 'empty' | 'spec-error'; findings?: readonly DocumentFinding[]; children?: ReactNode; spec?: boolean;
}): ReactElement {
  const children = kind === 'refused' && result && renderRefused ? renderRefused(result) : suppliedChildren;
  const settings = useContext(BoardplotThemeContext);
  const full = fullDiagnostics(settings?.diagnostics);
  const locale = options.locale ?? settings?.locale;
  const language = typeof locale === 'string' ? locale : locale?.language;
  const defaults = readerStrings(language);
  const strings = { ...defaults, ...settings?.strings };
  const wording = kind === 'refused' ? 'refusal' : kind === 'spec-error' ? 'failure' : kind;
  const heading = kind === 'refused' && strings.refusalMessage.includes('{') ? defaults.refusalMessage : strings[`${wording}Message`];
  const hint = strings[`${wording}Hint`];
  const minimum = findings[0]?.expected?.minimum as Record<string, number> | undefined;
  const legacy = full && kind === 'refused' && settings?.strings?.refusalMessage?.includes('{')
    ? stringFields(settings?.strings?.refusalMessage, minimum ?? {}, language) : undefined;
  const target = options.target ?? settings?.target;
  const size = explicitSize ?? resolveSize(options.size, target);
  const warned = useRef(false);
  useEffect(() => {
    // A host that takes the refusal through onRefused handles it; the console stays quiet.
    if (warned.current || !findings.length || (kind === 'refused' && onRefused)) return;
    warned.current = true;
    // A text line first: a console capture that keeps only text (a test runner,
    // an agent reading the log) would print the findings array as [Object].
    const lines = findings.map((finding) => `${finding.code}${finding.path ? ` at ${finding.path}` : ''}: ${finding.message}`);
    (kind === 'spec-error' ? console.error : console.warn)(`Boardplot ${kind}: ${lines.join('; ')}`, findings);
  }, [findings, kind, onRefused]);
  const theme = themeForWidth(placeholderTheme(ref ?? settings?.theme), size.width);
  const margin = { ...canvasMargin(theme, size.width), ...options.margin, ...options.canvas?.margin };
  const area = useRef<HTMLDivElement>(null);
  const hintBox = useRef<HTMLDivElement>(null);
  const headlineBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const read = () => {
      // A resize queued before the box unmounted can arrive after React cleared the refs.
      const node = headlineBox.current, box = area.current, hint = hintBox.current;
      if (!node || !box || !hint || !node.clientWidth || !box.clientHeight) return;
      const height = Math.max(0, box.clientHeight - hint.offsetHeight - 2 * theme.space.labelPad);
      // Read the browser's line breaks, including hyphens and CJK. This node owns only visible text.
      node.textContent = heading;
      node.style.maxHeight = '';
      node.style.webkitLineClamp = '';
      let prefix = heading.trim();
      while (node.scrollHeight > height && /\s/.test(prefix)) {
        prefix = prefix.replace(/\s+\S+$/, '');
        node.textContent = prefix + '…';
      }
      if (node.scrollHeight > height) {
        // A single token cannot be cut at whitespace. Break it inside the available lines.
        node.style.webkitLineClamp = String(Math.max(1, Math.floor(height / parseFloat(getComputedStyle(node).lineHeight))));
        node.style.maxHeight = `${height}px`;
      }
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(area.current!);
    observer.observe(hintBox.current!);
    return () => observer.disconnect();
  }, [heading, theme.space.labelPad]);
  return <div role={full && kind === 'spec-error' ? 'alert' : 'status'} dir={settings?.direction ?? 'ltr'}
    aria-label={options.title || undefined} data-bp-refused={kind === 'refused' ? findings[0]?.code : undefined}
    data-bp-empty={kind === 'empty' ? '' : undefined} data-bp-spec-error={kind === 'spec-error' ? '' : undefined}
    data-bp-diagnostics={findings.length ? JSON.stringify(findings) : undefined} style={{
      ...placeholderStyle(size, fixedSize), boxSizing: 'border-box', minHeight: 0,
      display: 'flex', flexDirection: 'column', padding: `${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px`,
      fontFamily: theme.type.family, color: theme.color.ink, background: theme.color.background,
    }}>
    {findings.map((finding, index) => <span hidden key={index} data-bp-error-code={finding.code} data-bp-error-path={finding.path ?? ''} />)}
    {options.title && <div title={options.title} style={{ fontSize: theme.type.title.size, fontWeight: theme.type.title.weight, flexShrink: 0 }}>{options.title}</div>}
    <div ref={area} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'auto' }}>
      <div style={{ textAlign: 'center', maxWidth: '42ch', width: '100%', paddingBlock: theme.space.labelPad, lineHeight: 1.45 }}>
        <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'normal' }}>
          <div ref={headlineBox} aria-hidden="true" title={heading} style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{heading}</div>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{heading}</span>
        </div>
        <div ref={hintBox} title={typeof children === 'string' ? children : hint} style={{ fontSize: 13, color: theme.color.inkMuted, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3,
          overflow: 'hidden', wordBreak: 'normal', hyphens: 'none' }}>{children === undefined ? hint : children}</div>
      </div>
    </div>
    {options.source && <div style={{ fontSize: footerType(theme.type.footnote, target).size, color: theme.color.inkMuted, overflowWrap: 'anywhere', flexShrink: 0 }}>{sourceLine(options.source, options.strings?.source ?? strings.source ?? localeStrings(language).source)}</div>}
    {full && findings.length > 0 && <div style={{ flexShrink: 0, maxHeight: '40%', overflow: 'auto' }}>
      <Suspense fallback={<span data-bp-loading="" />}><DiagnosticDetails spec={spec} errors={findings} theme={theme} label={strings.diagnosticDetails} message={legacy} /></Suspense>
    </div>}
  </div>;
}

/** Invalid specs still keep valid theme tokens; references go through the normal resolver. */
function placeholderTheme(ref?: Theme | ThemeRef): Theme {
  try {
    if (ref && typeof ref === 'object' && !('preset' in ref)) {
      if (!checkThemeShape(ref).length) return ref;
    } else return resolveTheme(ref);
  }
  catch (error) {
    if (!(error instanceof NormalizeError)) throw error;
  }
  return resolveTheme();
}
