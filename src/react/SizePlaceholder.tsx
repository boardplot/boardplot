import { lazy, Suspense, useContext, useRef, useEffect, type ReactElement, type ReactNode } from 'react';
import { chartString } from '../core/strings/ui';
import { resolveSize } from '../core/normalize/shared';
import type { BaseOptions } from '../core/types/options';
import type { Size } from '../core/geometry';
import type { RefusedLayout } from '../core/types/scene';
import type { RefusalFinding } from '../core/schema/refusals';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Theme, ThemeRef } from '../core/types/theme';
import { EMPTY_DATA } from '../core/emptyData';
import { placeholderStyle, BoardplotThemeContext } from './themeContext';

const Reader = lazy(() => import('./ReaderBox').catch(() => ({
  // A missing card chunk must not take down the dashboard or lose the reserved frame.
  default: (props: Parameters<typeof ReaderBox>[0]) => <LoadingPlaceholder {...props} failed />,
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
  options?: Pick<BaseOptions, 'title' | 'source' | 'size' | 'margin' | 'canvas' | 'locale' | 'target' | 'strings'>;
  size?: Size;
  fixedSize?: boolean;
}

/** Keep the slot stable while the reader card loads; SSR uses the same safe frame. */
export function ReaderBox(props: PlaceholderFrame & RefusalProps & {
  result?: RefusedLayout;
  theme?: Theme | ThemeRef; kind: 'refused' | 'empty' | 'spec-error'; findings?: readonly DocumentFinding[]; children?: ReactNode; spec?: boolean;
}): ReactElement {
  return <Suspense fallback={<LoadingPlaceholder {...props} />}><Reader {...props} /></Suspense>;
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

/** Busy state does not report a refusal. A failed chunk uses the reader failure state. */
export function LoadingPlaceholder({ failure, failed, kind, findings, children, ...frame }: PlaceholderFrame & { theme?: ThemeRef | Theme; failure?: string; failed?: boolean; kind?: string; findings?: readonly DocumentFinding[]; children?: ReactNode }): ReactElement {
  const settings = useContext(BoardplotThemeContext);
  const wording = { locale: frame.options?.locale ?? settings?.locale, strings: settings?.strings };
  if (failure !== undefined) return <ReaderBox {...frame} kind="spec-error" findings={[{ code: 'chunk-load-failed', message: failure }]} />;
  const target = frame.options?.target ?? settings?.target;
  const size = frame.size ?? resolveSize(frame.options?.size, target);
  return <div role="status" dir={settings?.direction ?? 'ltr'} {...{
    [`data-bp-${failed ? 'load-failed' : 'loading'}`]: '',
    [`data-bp-${kind}`]: kind === 'refused' ? findings?.[0]?.code : kind ? '' : undefined,
  }}
    data-bp-diagnostics={JSON.stringify(findings)} style={placeholderStyle(size, frame.fixedSize)}>{frame.options?.title}<div>{failed ? chartString(wording, 'loadingFailed') : children ?? chartString(wording, 'loading')}</div>{frame.options?.source}</div>;
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
