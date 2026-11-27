import { Component, createContext, Fragment, useContext, useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import type { Size } from '../core/geometry';
import { NormalizeError } from '../core/normalize/shared';
import { DEFAULT_TARGET, resolveTargetSize } from '../core/target';
import { resolveTheme } from '../core/theme';
import type { RenderTarget } from '../core/types/options';
import type { ThemeRef } from '../core/types/theme';
import type { RefusalFinding } from '../core/schema/refusals';
import type { DocumentFinding } from '../core/doc/diagnostics';
import { BoardplotThemeContext } from './themeContext';
import type { ContainerSizeOptions } from './useContainerSize';
import { LayoutRefusal } from './SizePlaceholder';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import { layoutRefusal } from '../core/emptyData';
import type { RefusedLayout } from '../core/types/scene';

/** Per-type components also accept a width in pixels as a number. */
export type PerTypeSizeOptions = Omit<ContainerSizeOptions, 'size' | 'fallbackSize'> & {
  size?: ContainerSizeOptions['size'] | number;
  fallbackSize?: ContainerSizeOptions['fallbackSize'] | number;
};

export function asSize(size: PerTypeSizeOptions['size']): ContainerSizeOptions['size'] {
  return typeof size === 'number' ? { width: size } : size;
}

function findingOf(error: NormalizeError): RefusalFinding {
  return {
    code: error.code, message: error.message, path: error.path,
    ...(error.suggest ? { suggest: error.suggest } : {}),
    ...(error.fix ? { fix: error.fix } : {}),
  };
}

/** The frame a refusal card takes when a chart prop broke the layout: the asked size, or the default when the size itself is the bad prop. */
function frameSize(size: Parameters<typeof resolveTargetSize>[1], target: RenderTarget | undefined): Size | undefined {
  try { return resolveTargetSize(target ?? DEFAULT_TARGET, size).sizePx; } catch { return undefined; }
}

/**
 * A chart prop the engine cannot draw (a theme name that does not exist, a size
 * written as text, a geo pack that is not registered, an axis bound that is not a
 * number) throws a NormalizeError while the chart renders. The CLI turns that error
 * into a refusal; here it draws the refusal card, so one bad chart does not unmount
 * the host's React root. Any other error keeps travelling up to the host. The card
 * goes when the chart gets new props or inherited settings.
 */
class Boundary extends Component<
  { watch: unknown; inherited: unknown; fallback: Fallback; size?: Size; children: ReactNode },
  { watch: unknown; inherited: unknown; failed?: { error: unknown }; mount: number }
> {
  override state: { watch: unknown; inherited: unknown; failed?: { error: unknown }; mount: number } = { watch: this.props.watch, inherited: this.props.inherited, mount: 0 };

  /** An engine fault (`chart-failed`): the console keeps the error, and the host hears of it as of a refusal. */
  report(error: unknown) {
    if (!(error instanceof NormalizeError) || error.code !== 'chart-failed') return;
    const { cause, type } = error as NormalizeError & { cause: unknown; type: string };
    console.error(cause);
    (this.props.watch as { onRefused?: (result: RefusedLayout) => void }).onRefused?.(layoutRefusal(type, type, this.props.size ?? { width: 0, height: 0 }, error));
  }

  override componentDidCatch(error: unknown) {
    this.report(error);
  }

  static getDerivedStateFromError(error: unknown) {
    return { failed: { error } };
  }

  static getDerivedStateFromProps({ watch, inherited }: { watch: unknown; inherited: unknown }, state: { watch: unknown; inherited: unknown }) {
    return watch === state.watch && inherited === state.inherited ? null : { watch, inherited, failed: undefined };
  }

  override render(): ReactNode {
    const { failed } = this.state;
    if (!failed) return <FallbackContext.Provider value={this}><Fragment key={this.state.mount}>{this.props.children}</Fragment></FallbackContext.Provider>;
    const { error } = failed;
    if (!(error instanceof NormalizeError)) throw error;
    return this.props.fallback([findingOf(error)]);
  }
}

/** The refusal card with these findings. */
type Fallback = (findings: readonly DocumentFinding[]) => ReactNode;
const FallbackContext = createContext<Boundary>(undefined!);

/**
 * The server's card of a refusal. Once hydrated, the boundary holds it, as if the chart had thrown in the browser:
 * the chart mounts afresh after it, also when new props reach the boundary in the same update.
 */
function ChartFailure({ error }: { error: NormalizeError }): ReactNode {
  const boundary = useContext(FallbackContext);
  useIsomorphicLayoutEffect(() => { boundary.setState(({ mount }) => ({ failed: { error }, mount: mount + 1 })); boundary.report(error); }, [error]);
  return boundary.props.fallback([findingOf(error)]);
}

const subscribeNever = () => () => {};
const inBrowser = () => false;

/**
 * What a chart draws when its engine refused its input (a NormalizeError) on the server, where React has no error
 * boundary, and in the hydration of that markup: the card. In the browser the error is thrown to the boundary, as
 * it always was. Any other error of the engine becomes one card that names the chart type, `chart-failed`: it can
 * come from a value the type's schema refuses or from a fault of the engine, so the card does not say which.
 */
export function useChartFailure(failed: unknown, type: string): ReactElement | null {
  const serverPass = useSyncExternalStore(subscribeNever, inBrowser, () => failed !== undefined);
  if (failed === undefined) return null;
  const refused = failed instanceof NormalizeError ? failed
    : Object.assign(new NormalizeError('chart-failed', '', `The ${type} chart could not be drawn.`), { cause: failed, type });
  if (!serverPass) throw refused;
  return <ChartFailure error={refused} />;
}

export function RefusalBoundary({ watch, children, size, fallbackSize, target, theme, background, title, fixedSize }: {
  watch: unknown;
  children: ReactNode;
  title?: unknown;
  fixedSize?: boolean;
  size?: ContainerSizeOptions['size'];
  fallbackSize?: ContainerSizeOptions['fallbackSize'];
  target?: RenderTarget;
  theme?: ThemeRef;
  background?: 'theme' | 'transparent';
}) {
  const inherited = useContext(BoardplotThemeContext);
  const finding = useMemo(() => {
    try {
      // The strict check the public boundary runs: width and height must be finite and above zero.
      resolveTargetSize(target ?? inherited?.target ?? DEFAULT_TARGET, size === 'container' ? fallbackSize : size);
    } catch (error) {
      if (error instanceof NormalizeError) return findingOf(error);
    }
    if (theme !== undefined) {
      try {
        resolveTheme(theme);
      } catch (error) {
        if (error instanceof NormalizeError) return findingOf(error);
      }
    }
    if (background !== undefined && background !== 'theme' && background !== 'transparent') {
      return {
        code: 'invalid-option', path: 'options.background',
        message: "background must be 'theme' or 'transparent'.",
        suggest: 'Use background theme, or transparent to leave the canvas out.',
      };
    }
    return undefined;
  }, [size, fallbackSize, target, inherited?.target, theme, background]);
  // The card takes the asked size, or the default when the size itself is the bad prop.
  const frame = { fixedSize, theme, size: frameSize(size === 'container' ? fallbackSize : size, target), options: typeof title === 'string' ? { title } : {} };
  const fallback: Fallback = (findings) => <LayoutRefusal {...frame} refusals={findings} />;
  return finding ? fallback([finding]) : <Boundary watch={watch} fallback={fallback} size={frame.size} inherited={inherited}>{children}</Boundary>;
}
