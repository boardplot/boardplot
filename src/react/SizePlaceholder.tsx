import { lazy, Suspense, useContext, useRef, useEffect, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { chartString } from '../core/strings/ui';
import { resolveSize } from '../core/normalize/shared';
import { normalizeOptionShapes } from '../core/normalize/optionShapes';
import type { OptionsInput } from '../core/types/optionInput';
import type { BaseOptions } from '../core/types/options';
import type { Size } from '../core/geometry';
import type { RefusedLayout } from '../core/types/scene';
import type { RefusalFinding } from '../core/schema/refusals';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Theme, ThemeRef } from '../core/types/theme';
import { EMPTY_DATA } from '../core/emptyData';
import { readerStrings } from '../core/readerStrings';
import { placeholderStyle, BoardplotThemeContext, type BoardplotStrings } from './themeContext';

const Reader = lazy(() => import('./ReaderBox').catch(() => ({
  // A missing card chunk must not take down the dashboard or lose the reserved frame.
  default: (props: ReaderProps) => <LoadingPlaceholder {...props} failed />,
})));

export interface RefusalProps {
  onRefused?: (result: RefusedLayout) => void;
  renderRefused?: (result: RefusedLayout) => ReactNode;
}
export interface EmptyProps {
  /** Called once when the chart has no categories, series, rows or points. */
  onEmpty?: () => void;
}
export interface PlaceholderFrame {
  options?: OptionsInput<Pick<BaseOptions, 'title' | 'source' | 'size' | 'margin' | 'canvas' | 'locale' | 'target' | 'strings'>>;
  size?: Size;
  fixedSize?: boolean;
}

type ReaderProps = PlaceholderFrame & RefusalProps & {
  result?: RefusedLayout;
  theme?: Theme | ThemeRef; kind: 'refused' | 'empty' | 'spec-error'; findings?: readonly DocumentFinding[]; children?: ReactNode; spec?: boolean;
};

const noStore = () => () => {};
const mounted = () => true;
const unmounted = () => false;

/**
 * The card's status line and its content: the host's `renderRefused` for a refusal, else the children or the hint.
 * The card and its first frame read them here, so both say the same.
 */
export function readerText({ kind, result, renderRefused, children }: Pick<ReaderProps, 'kind' | 'result' | 'renderRefused' | 'children'>, language: string | undefined, host: BoardplotStrings | undefined) {
  const defaults = readerStrings(language);
  const strings = { ...defaults, ...host } as typeof defaults & Record<string, string>;
  const wording = kind === 'refused' ? 'refusal' : kind === 'spec-error' ? 'failure' : kind;
  const heading = kind === 'refused' && strings.refusalMessage.includes('{') ? defaults.refusalMessage : strings[`${wording}Message`]!;
  const content = kind === 'refused' && result && renderRefused ? renderRefused(result) : children;
  return { strings, heading, hint: strings[`${wording}Hint`]!, content };
}

/**
 * The server pass and the pass that hydrates it draw the card's first frame: its status line, the host's content and
 * its diagnostics, with no lazy load, so the server HTML holds the card's message and hydration meets the same markup.
 * After mount the full card loads and takes its place.
 */
export function ReaderBox(props: ReaderProps): ReactElement {
  const shown = useSyncExternalStore(noStore, mounted, unmounted);
  const first = <LoadingPlaceholder {...props} />;
  return <Suspense fallback={first}>{shown ? <Reader {...props} /> : first}</Suspense>;
}

export function SizePlaceholder(props: RefusalProps & EmptyProps & PlaceholderFrame & { result: RefusedLayout; theme: Theme }): ReactElement {
  const { result } = props;
  const empty = usePlaceholderNotice(props);
  return <ReaderBox {...props} size={result.size} kind={empty ? 'empty' : 'refused'} findings={result.warnings} />;
}

/** Reader failure state; full mode discloses messages and suggestions. Codes, paths and fixes stay in data attributes in both modes. */
export function LayoutRefusal(props: PlaceholderFrame & { refusals: readonly RefusalFinding[]; theme?: Theme | ThemeRef }): ReactElement {
  return <ReaderBox {...props} kind="spec-error" findings={props.refusals} />;
}

/** Busy state does not report a refusal. A failed chunk uses the reader failure state. With a `kind` it is the reader card's first frame. */
export function LoadingPlaceholder({ failure, failed, kind, findings, children, result, renderRefused, ...frame }: PlaceholderFrame & RefusalProps & { theme?: ThemeRef | Theme; failure?: string; failed?: boolean; kind?: ReaderProps['kind']; findings?: readonly DocumentFinding[]; children?: ReactNode; result?: RefusedLayout }): ReactElement {
  const settings = useContext(BoardplotThemeContext);
  const options = normalizeOptionShapes('', { options: frame.options }).chart.options as Pick<BaseOptions, 'title' | 'source' | 'size' | 'locale' | 'target'> | undefined;
  const locale = options?.locale ?? settings?.locale;
  const wording = { locale, strings: settings?.strings };
  if (failure !== undefined) return <ReaderBox {...frame} kind="spec-error" findings={[{ code: 'chunk-load-failed', message: failure }]} />;
  const target = options?.target ?? settings?.target;
  const size = frame.size ?? resolveSize(options?.size, target);
  const reader = kind && !failed ? readerText({ kind, result, renderRefused, children }, typeof locale === 'string' ? locale : locale?.language, settings?.strings) : undefined;
  const busy = failed ? 'load-failed' : reader ? 'card' : 'loading';
  return <div role="status" dir={settings?.direction ?? 'ltr'} {...{
    [`data-bp-${busy}`]: reader ? undefined : '',
    [`data-bp-${kind}`]: kind === 'refused' ? findings?.[0]?.code : kind ? '' : undefined,
  }}
    data-bp-diagnostics={reader && !findings?.length ? undefined : JSON.stringify(findings)} style={placeholderStyle(size, frame.fixedSize)}>
    {reader && findings?.map((finding, index) => <span hidden key={index} data-bp-error-code={finding.code} data-bp-error-path={finding.path ?? ''} />)}
    {options?.title}<div>{failed ? chartString(wording, 'loadingFailed') : reader ? reader.heading : children ?? chartString(wording, 'loading')}</div>
    {reader && <div>{reader.content === undefined ? reader.hint : reader.content}</div>}{options?.source}</div>;
}

/** Empty specs use the same reader frame and the same once-per-entry callback. */
export function EmptyPlaceholder(props: EmptyProps & PlaceholderFrame & { theme?: Theme | ThemeRef }): ReactElement {
  usePlaceholderNotice(props);
  return <ReaderBox {...props} kind="empty" />;
}

function usePlaceholderNotice({ onEmpty, result, onRefused }: EmptyProps & RefusalProps & { result?: RefusedLayout }) {
  const empty = !result || result.warnings[0]?.code === EMPTY_DATA;
  const notified = useRef(false);
  // The callbacks sit in a ref: an inline one is new on every render and must not fire the effect again.
  const listeners = useRef({ onEmpty, onRefused });
  listeners.current = { onEmpty, onRefused };
  useEffect(() => {
    if (empty) { if (!notified.current) listeners.current.onEmpty?.(); }
    else listeners.current.onRefused?.(result!);
    notified.current = empty;
  }, [empty, result]);
  return empty;
}
