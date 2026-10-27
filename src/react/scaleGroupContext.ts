"use client";

/**
 * The context a chart reads to join a declared shared scale group.
 *
 * This module stays small on purpose. A chart entry calls
 * `useSharedScaleValueAxis` on every render, so importing the provider here
 * would put `resolveSharedScale` and the chart layouts it probes into every
 * default chart bundle. The provider resolves the plan once and hands the
 * per-member valueAxis overrides through the context value; readers do a map
 * lookup.
 */

import { createContext, useContext } from 'react';
import type { SharedScalePlan } from '../core/grid/sharedScale';

/** The `scaleGroup` fields a chart names to join a declared group. */
export type ScaleGroupRef = { y?: string; id?: string };

/** Null when no provider is above the chart, so a standalone chart is unchanged. */
export const ScaleGroupContext = createContext<ScaleGroupContextValue | undefined>(undefined);

export interface ScaleGroupContextValue {
  group: string;
  plan: SharedScalePlan;
  /** The pinned valueAxis override per member id, resolved once by the provider. */
  valueAxisByMember: ReadonlyMap<string, Record<string, unknown>>;
}

/** The resolved plan of the enclosing group, or null outside a matching one. */
export function useScaleGroupPlan(group: string | undefined): SharedScalePlan | null {
  const context = useContext(ScaleGroupContext);
  if (!context || group === undefined || context.group !== group) return null;
  return context.plan;
}

/**
 * The pinned valueAxis for this chart's member, or null when the chart is not
 * in a matching group, names no member, or was refused. A refused member keeps
 * its own scale; `plan.refusals` names it and states why.
 */
export function useSharedScaleValueAxis(
  scaleGroup: ScaleGroupRef | undefined,
): Record<string, unknown> | null {
  const context = useContext(ScaleGroupContext);
  if (!context || scaleGroup?.y === undefined || context.group !== scaleGroup.y) return null;
  const memberId = scaleGroup.id;
  if (memberId === undefined) return null;
  return context.valueAxisByMember.get(memberId) ?? null;
}
