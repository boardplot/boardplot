import { Component, createContext, useContext, useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import type { Size } from '../core/geometry';
import { NormalizeError } from '../core/normalize/shared';
import { DEFAULT_TARGET, resolveTargetSize } from '../core/target';
import { resolveTheme } from '../core/theme';
import type { RenderTarget } from '../core/types/options';
import type { ThemeRef } from '../core/types/theme';
import type { RefusalFinding } from '../core/schema/refusals';
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
  { watch: unknown; inherited: unknown; fallback: Fallback; children: ReactNode },
  { watch: unknown; inherited: unknown; failed?: { error: unknown } }
> {
  override state: { watch: unknown; inherited: unknown; failed?: { error: unknown } } = { watch: this.props.watch, inherited: this.props.inherited };
  /** Raised when a hydrated card hands over: the chart mounts afresh after it. */
  mount = 0;

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
    if (!failed) return <BoundaryContext.Provider key={this.mount} value={this}>{this.props.children}</BoundaryContext.Provider>;
    const { error } = failed;
    if (!(error instanceof NormalizeError)) throw error;
    return this.props.fallback(findingOf(error));
  }
}

/** The refusal card with this finding. */
type Fallback = (finding: RefusalFinding) => ReactNode;
const BoundaryContext = createContext<Boundary>(undefined!);

const subscribeNever = () => () => {};
const zero = () => 0;

/**
 * Draws a chart. On the server, where React has no error boundary, and in the hydration of that markup, an engine
 * refusal (a NormalizeError) the chart throws draws its card instead. In the browser it goes to the boundary, as it
 * always did. Any other error goes on up to the host.
 */
export function useCard<P>(draw: (props: P) => ReactElement, props: P): ReactElement {
  // React reads the server snapshot only on the server and in hydration. Both snapshots are 0, so a chart renders no
  // extra time after hydration.
  let server = false;
  useSyncExternalStore(subscribeNever, zero, () => (server = true, 0));
  try {
    return draw(props);
  } catch (error) {
    // A render that threw is dropped in the browser. This one mounts (a server pass or hydration), so it may call
    // hooks past the ones the chart called before it threw.
    if (!server || !(error instanceof NormalizeError)) throw error;
    const boundary = useContext(BoundaryContext);
    // Once hydrated, the boundary holds the card, as if the chart had thrown in the browser: the chart mounts afresh
    // after it, also when new props reach the boundary in the same update.
    useIsomorphicLayoutEffect(() => {
      boundary.mount++;
      boundary.setState({ failed: { error } });
    }, []);
    return boundary.props.fallback(findingOf(error)) as ReactElement;
  }
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
  const fallback: Fallback = (finding) => <LayoutRefusal {...frame} refusals={[finding]} />;
  return finding ? fallback(finding) : <Boundary watch={watch} fallback={fallback} inherited={inherited}>{children}</Boundary>;
}
