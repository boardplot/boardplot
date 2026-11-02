import { Component, useContext, useMemo, type ReactNode } from 'react';
import type { Size } from '../core/geometry';
import { NormalizeError, resolveSize } from '../core/normalize/shared';
import { resolveTheme } from '../core/theme';
import type { RenderTarget } from '../core/types/options';
import type { ThemeRef } from '../core/types/theme';
import type { RefusalFinding } from '../core/schema/refusals';
import { BoardplotThemeContext } from './themeContext';
import type { ContainerSizeOptions } from './useContainerSize';

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
export function frameSize(size: Parameters<typeof resolveSize>[0], target: RenderTarget | undefined): Size | undefined {
  try { return resolveSize(size, target); } catch { return undefined; }
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
  { watch: unknown; inherited: unknown; fallback: (finding: RefusalFinding) => ReactNode; children: ReactNode },
  { watch: unknown; inherited: unknown; failed?: { error: unknown } }
> {
  override state: { watch: unknown; inherited: unknown; failed?: { error: unknown } } = { watch: this.props.watch, inherited: this.props.inherited };

  static getDerivedStateFromError(error: unknown) {
    return { failed: { error } };
  }

  static getDerivedStateFromProps({ watch, inherited }: { watch: unknown; inherited: unknown }, state: { watch: unknown; inherited: unknown }) {
    return watch === state.watch && inherited === state.inherited ? null : { watch, inherited, failed: undefined };
  }

  override render(): ReactNode {
    const { failed } = this.state;
    if (!failed) return this.props.children;
    const { error } = failed;
    if (!(error instanceof NormalizeError)) throw error;
    return this.props.fallback(findingOf(error));
  }
}

export function RefusalBoundary({ watch, fallback, children, size, fallbackSize, target, theme, background }: {
  watch: unknown;
  fallback: (finding: RefusalFinding) => ReactNode;
  children: ReactNode;
  size?: ContainerSizeOptions['size'];
  fallbackSize?: ContainerSizeOptions['fallbackSize'];
  target?: RenderTarget;
  theme?: ThemeRef;
  background?: 'theme' | 'transparent';
}) {
  const inherited = useContext(BoardplotThemeContext);
  const finding = useMemo(() => {
    try {
      resolveSize(size === 'container' ? fallbackSize : size, target ?? inherited?.target);
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
  return finding ? fallback(finding) : <Boundary watch={watch} fallback={fallback} inherited={inherited}>{children}</Boundary>;
}
