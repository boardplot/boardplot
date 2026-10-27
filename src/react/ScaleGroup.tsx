"use client";

/**
 * Host-scoped shared value scale.
 *
 * `ScaleGroup` wraps separately mounted cards that must read one y scale. The
 * host declares the COMPLETE member set up front, exactly the members it also
 * renders, so server rendering resolves the group from that declared list.
 * Mount order, container size and DOM measurement never contribute: a member
 * that is not declared is not part of the scale, and a declared member that is
 * missing from the rendered tree does not shrink the scale it declared.
 *
 * The resolution itself is `resolveSharedScale` in core/grid/sharedScale, the
 * same union/refusal rule the grid applies to its panels. A chart joins by
 * naming the group in `scaleGroup: { y, id }`; the id is the member id in the
 * declared set, so reordering the cards keeps each card's pin and removing a
 * member recomputes the domain without it.
 *
 * The provider is the only place the coordinator runs. Charts read the pins
 * through `react/scaleGroupContext`, which holds no layout code.
 */

import { useMemo, type ReactElement, type ReactNode } from 'react';
import {
  resolveSharedScale,
  sharedScaleValueAxis,
  type SharedScaleMemberRequest,
} from '../core/grid/sharedScale';
import { ScaleGroupContext, type ScaleGroupContextValue } from './scaleGroupContext';
import { useStableValue } from './useStableValue';

export interface ScaleGroupProps {
  /** Group identity; charts join with `scaleGroup: { y: group, id: memberId }`. */
  group: string;
  /** The complete declared member set. Compared by content, so it may be written inline. */
  members: readonly SharedScaleMemberRequest[];
  children?: ReactNode;
}

export { useScaleGroupPlan } from './scaleGroupContext';
export type { ScaleGroupRef } from './scaleGroupContext';

export function ScaleGroup({ group, members, children }: ScaleGroupProps): ReactElement {
  // By content: a members list written inline is a new array on every render.
  const stableMembers = useStableValue(members);
  const plan = useMemo(() => resolveSharedScale(group, stableMembers), [group, stableMembers]);
  const value = useMemo((): ScaleGroupContextValue => {
    const valueAxisByMember = new Map<string, Record<string, unknown>>();
    for (const member of plan.members) {
      const valueAxis = sharedScaleValueAxis(plan, member.id);
      if (valueAxis) valueAxisByMember.set(member.id, valueAxis);
    }
    return { group, plan, valueAxisByMember };
  }, [group, plan]);
  return <ScaleGroupContext.Provider value={value}>{children}</ScaleGroupContext.Provider>;
}
