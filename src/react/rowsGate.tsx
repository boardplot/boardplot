import type { ReactElement } from 'react';
import type { ThemeRef } from '../core/types/theme';
import { LayoutRefusal, LoadingPlaceholder } from './SizePlaceholder';
import { useRowsInput, type RowsProps } from './rowsInput';
import type { ContainerSizeOptions } from './useContainerSize';

/**
 * The rows step of a component that cannot draw without data (TableChart,
 * DimSwitchChart): the refusal card or the busy box while there is none, and
 * the data to draw once there is. It answers before the component's own
 * hooks run, so a table never resolves an absent table.
 */
export function useRowsGate<D>(spec: { type: string; data?: D }, props: RowsProps, frame: ContainerSizeOptions & { theme?: ThemeRef; title?: unknown; source?: unknown }): { element?: ReactElement; data?: D } {
  const mapped = useRowsInput<D>(spec, props);
  if (props.rows === undefined && props.columns === undefined) return { data: spec.data };
  const options = { ...frame, size: frame.size === 'container' ? frame.fallbackSize : frame.size } as Parameters<typeof LoadingPlaceholder>[0]['options'];
  if (mapped.refusals.length) return { element: <LayoutRefusal refusals={mapped.refusals} theme={frame.theme} options={options} /> };
  if (mapped.data === undefined) return { element: <LoadingPlaceholder theme={frame.theme} failure={mapped.failure} options={options} /> };
  return { data: mapped.data };
}
