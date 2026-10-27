/**
 * One shared value scale across separately mounted charts.
 *
 * A grid answers "which panels read one y scale" for panels inside one grid
 * document. Separately mounted cards ask the same question about an explicit,
 * complete member list the host declares up front, so this module reuses the
 * grid's algorithms instead of deriving scale mathematics a second time:
 *
 * - `scalePanelSemantics` is the grid's unit/format comparison. It lives here
 *   so the grid layout and this coordinator share one implementation.
 * - `inferLinearYDomain` (core/axis) recovers a member's own rendered domain
 *   from a probe layout, the same way the grid reads its panels.
 * - `invalidLinearBreakReason` (core/scale) judges a break against the shared
 *   domain, the same rule bar/column/waterfall apply to their own data.
 *
 * The coordinator is pure. It reads no mount order, no DOM measurement and no
 * React state, so the same member set always yields the same plan. A member
 * that cannot honour the plan is refused BY NAME with a reason, rather than
 * keeping a prop that changed nothing.
 */

import { inferLinearYDomain } from '../axis';
import { getChart } from '../registry';
import { invalidLinearBreakReason, type LinearBreak } from '../scale';
import type { Geometry } from '../types/scene';
import { compareText } from '../text';
import { isRecord } from '../lint/shared';
import { maxOf, minOf } from '../arrays';

export interface SharedScaleMemberRequest {
  /** Stable member identity. The same id keeps its pin across reorder. */
  id: string;
  /** Registered chart type laid out for this member. */
  type: string;
  data: unknown;
  options?: Record<string, unknown>;
  annotations?: unknown[];
}

type SharedScaleRefusalCode =
  | 'scale-group-unknown-type'
  | 'scale-group-not-numeric'
  | 'scale-group-unreadable'
  | 'scale-group-duplicate-id'
  | 'scale-group-mixed-semantics'
  | 'scale-group-unit-mismatch'
  | 'scale-group-format-mismatch'
  | 'scale-group-break-mismatch'
  | 'scale-group-break-invalid'
  | 'scale-group-break-unsupported'
  | 'scale-group-member-unpinned'
  | 'scale-group-incomplete';

interface SharedScaleRefusal {
  /** The refused member, or null when the refusal is about the group itself. */
  memberId: string | null;
  code: SharedScaleRefusalCode;
  message: string;
}

interface SharedScaleMemberPin {
  id: string;
  /** The member's authored options with the shared valueAxis bounds pinned. */
  options: Record<string, unknown>;
  /** The member's own domain before the union. */
  domain: [number, number];
}

export interface SharedScalePlan {
  group: string;
  /** Union domain over the pinned members, or null when the group is refused. */
  domain: [number, number] | null;
  /** Shared break every pinned member honours, or null. */
  break: LinearBreak | null;
  /** Pinned members, in declared order. */
  members: SharedScaleMemberPin[];
  refusals: SharedScaleRefusal[];
  /** Members the coordinator could not read a numeric y domain from. */
  unreadable: string[];
}

const PROBE_SIZE = { width: 720, height: 405 } as const;


function normalizedScaleText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || null;
}

/**
 * The unit and format a panel reads against, or null when its own series
 * disagree. The grid layout calls this for its panels; the coordinator calls it
 * for standalone members, so both judge compatibility by one rule.
 */
export function scalePanelSemantics(
  panel: { type?: string; data?: unknown; options?: Record<string, unknown> | undefined },
): { unit: string | null; format: string | null } | null {
  const panelOptions = panel.options ?? {};
  const series =
    panel.data && typeof panel.data === 'object' && !Array.isArray(panel.data)
      ? (panel.data as { series?: unknown }).series
      : undefined;
  if (!Array.isArray(series) || series.length === 0) {
    return {
      unit: normalizedScaleText(panelOptions.unit),
      format: normalizedScaleText(panelOptions.format),
    };
  }
  const dataSeries = series.filter(
    (entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry) &&
      (entry as { role?: unknown }).role !== 'reference',
  ) as Record<string, unknown>[];
  const units = new Set(
    dataSeries.map((entry) => normalizedScaleText(entry.unit ?? panelOptions.unit)),
  );
  const formats = new Set(
    dataSeries.map((entry) => normalizedScaleText(entry.format ?? panelOptions.format)),
  );
  if (units.size > 1 || formats.size > 1) return null;
  return {
    unit: units.values().next().value ?? normalizedScaleText(panelOptions.unit),
    format: formats.values().next().value ?? normalizedScaleText(panelOptions.format),
  };
}

/** Probe one member exactly the way the grid probes one of its panels. */
function probeGeometry(
  member: SharedScaleMemberRequest,
  options: Record<string, unknown>,
): Geometry | null {
  const definition = getChart(member.type);
  if (!definition) return null;
  const valueAxis = isRecord(options.valueAxis) ? options.valueAxis : {};
  return definition.layout(member.data, {
    ...definition.defaults,
    ...options,
    ...(member.annotations ? { annotations: member.annotations } : {}),
    size: { ...PROBE_SIZE },
    // The probe asks for the axis because the member's own break verdict and
    // tick ladder only exist once its value axis is laid out. The pin handed
    // back to the host keeps the author's own axis visibility.
    valueAxis: { ...valueAxis, show: true },
  } as never) as Geometry;
}

/** A member's own domain, read back from its own layout. */
function probeDomain(
  member: SharedScaleMemberRequest,
  options: Record<string, unknown>,
): [number, number] | null {
  const geometry = probeGeometry(member, options);
  return geometry ? inferLinearYDomain(geometry) : null;
}

function yAxisBreak(geometry: Geometry): boolean {
  return geometry.axes.some((axis) => axis.axis === 'y' && axis.break !== undefined);
}

function yTickValues(geometry: Geometry): number[] {
  return geometry.axes
    .filter((axis) => axis.axis === 'y')
    .flatMap((axis) => axis.ticks.map((tick) => tick.at))
    .filter((value): value is number => typeof value === 'number');
}

function requestedBreak(options: Record<string, unknown>): LinearBreak | null {
  const valueAxis = options.valueAxis;
  if (!isRecord(valueAxis)) return null;
  const raw = valueAxis.break;
  if (!isRecord(raw)) return null;
  const { from, to } = raw as { from?: unknown; to?: unknown };
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(from < to)) {
    return { from, to };
  }
  return { from, to };
}

function breakKey(axisBreak: LinearBreak): string {
  return `${axisBreak.from}|${axisBreak.to}`;
}

function pinDomainText(domain: [number, number]): string {
  return `[${domain[0]}, ${domain[1]}]`;
}

function formatText(value: string | null): string {
  return value === null ? 'no format' : `'${value}'`;
}

function unitText(value: string | null): string {
  return value === null ? 'no unit' : `'${value}'`;
}

type Refuse = (memberId: string | null, code: SharedScaleRefusalCode, message: string) => void;

interface MemberReads {
  declared: SharedScaleMemberRequest[];
  domains: Map<string, [number, number]>;
  semantics: Map<string, { unit: string | null; format: string | null } | null>;
  unreadable: string[];
}

/**
 * De-duplicate the declared list, then read each surviving member's own unit,
 * format and y domain. A member that throws or yields no numeric linear domain
 * is refused by name here and never reaches the union.
 */
function readMembers(
  group: string,
  members: readonly SharedScaleMemberRequest[],
  refuse: Refuse,
): MemberReads {
  const declared: SharedScaleMemberRequest[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.id)) {
      refuse(
        member.id,
        'scale-group-duplicate-id',
        `scale group '${group}' declares member id '${member.id}' twice — member ids must be unique and stable`,
      );
      continue;
    }
    seen.add(member.id);
    declared.push(member);
  }

  const semantics = new Map<string, { unit: string | null; format: string | null } | null>();
  const domains = new Map<string, [number, number]>();
  const unreadable: string[] = [];
  for (const member of declared) {
    const options = member.options ?? {};
    semantics.set(member.id, scalePanelSemantics(member));
    let domain: [number, number] | null = null;
    try {
      domain = probeDomain(member, options);
    } catch {
      unreadable.push(member.id);
      refuse(
        member.id,
        'scale-group-unreadable',
        `chart type '${member.type}' could not lay out member '${member.id}' for shared scale group '${group}'`,
      );
      continue;
    }
    if (!domain) {
      unreadable.push(member.id);
      const known = getChart(member.type);
      refuse(
        member.id,
        known ? 'scale-group-not-numeric' : 'scale-group-unknown-type',
        known
          ? `chart type '${member.type}' renders no numeric linear y scale — member '${member.id}' keeps its own scale and cannot join shared scale group '${group}'`
          : `chart type '${member.type}' is not registered — member '${member.id}' cannot join shared scale group '${group}'`,
      );
      continue;
    }
    domains.set(member.id, domain);
  }
  return { declared, domains, semantics, unreadable };
}

/**
 * The members whose unit and format match the group reference. One reference
 * semantics per group, taken from the lowest member id, so the choice does not
 * change when the host reorders the declared list.
 */
function compatibleMembers(reads: MemberReads, refuse: Refuse): string[] {
  const candidates = reads.declared.filter((member) => reads.domains.has(member.id));
  const referenceId = candidates.map((member) => member.id).sort()[0];
  const reference = referenceId === undefined ? null : reads.semantics.get(referenceId) ?? null;
  const compatible: string[] = [];
  if (reference === null) {
    for (const member of candidates) {
      refuse(
        member.id,
        'scale-group-mixed-semantics',
        `member '${member.id}' declares series with conflicting unit or format values — the group cannot state one shared scale`,
      );
    }
    return compatible;
  }
  for (const member of candidates) {
    const own = reads.semantics.get(member.id);
    if (own === null || own === undefined) {
      refuse(
        member.id,
        'scale-group-mixed-semantics',
        `member '${member.id}' declares series with conflicting unit or format values — the group cannot state one shared scale`,
      );
      continue;
    }
    if (own.unit !== reference.unit) {
      refuse(
        member.id,
        'scale-group-unit-mismatch',
        `member '${member.id}' reads ${unitText(own.unit)} while the group reads ${unitText(reference.unit)} — one shared scale would compare different quantities`,
      );
      continue;
    }
    if (own.format !== reference.format) {
      refuse(
        member.id,
        'scale-group-format-mismatch',
        `member '${member.id}' reads ${formatText(own.format)} while the group reads ${formatText(reference.format)}`,
      );
      continue;
    }
    compatible.push(member.id);
  }
  return compatible;
}

/**
 * One shared break, or none. A member that requests a different span than its
 * peers is refused by name and leaves the group instead of keeping a break the
 * others do not draw.
 */
function agreedBreak(
  group: string,
  declared: readonly SharedScaleMemberRequest[],
  compatible: string[],
  refuse: Refuse,
): { compatible: string[]; break: LinearBreak | null; requestedBy: string[] } {
  const breakByMember = new Map<string, LinearBreak>();
  for (const member of declared) {
    const requested = requestedBreak(member.options ?? {});
    if (requested) breakByMember.set(member.id, requested);
  }
  const requestedBy = [...breakByMember.keys()].sort();
  if (breakByMember.size === 0) return { compatible, break: null, requestedBy };
  const keys = new Set([...breakByMember.values()].map(breakKey));
  if (keys.size === 1) {
    return { compatible, break: [...breakByMember.values()][0]!, requestedBy };
  }
  for (const memberId of requestedBy) {
    refuse(
      memberId,
      'scale-group-break-mismatch',
      `member '${memberId}' requests a different valueAxis.break than its peers in group '${group}' — no shared break is applied`,
    );
  }
  return {
    compatible: compatible.filter((memberId) => !breakByMember.has(memberId)),
    break: null,
    requestedBy,
  };
}

/** Judge the shared break against the union domain, the rule the charts use. */
function validSharedBreak(
  union: [number, number],
  sharedBreak: LinearBreak | null,
  requestedBy: readonly string[],
  refuse: Refuse,
): LinearBreak | null {
  if (!sharedBreak) return null;
  const reason = invalidLinearBreakReason(union, sharedBreak, []);
  if (reason === undefined) return sharedBreak;
  for (const memberId of requestedBy) {
    refuse(
      memberId,
      'scale-group-break-invalid',
      `valueAxis.break on member '${memberId}' cannot apply to the shared domain ${pinDomainText(union)}: ${reason}`,
    );
  }
  return null;
}

/**
 * Probe every ordered member a second time with the pinned bounds, so the plan
 * states what the member's layout actually did with them. A member whose probe
 * lands elsewhere, or whose own layout ignores the break, is refused by name.
 */
function pinMembers(
  group: string,
  ordered: readonly SharedScaleMemberRequest[],
  domains: Map<string, [number, number]>,
  union: [number, number],
  sharedBreak: LinearBreak | null,
  refuse: Refuse,
): SharedScaleMemberPin[] {
  const pins: SharedScaleMemberPin[] = [];
  for (const member of ordered) {
    const own = member.options ?? {};
    const valueAxis = isRecord(own.valueAxis) ? own.valueAxis : {};
    const pinned: Record<string, unknown> = {
      ...own,
      valueAxis: {
        ...valueAxis,
        min: union[0],
        max: union[1],
        ...(sharedBreak ? { break: sharedBreak } : {}),
      },
    };
    let probe: Geometry | null = null;
    try {
      probe = probeGeometry(member, pinned);
    } catch {
      probe = null;
    }
    if (!sharedBreak) {
      const landed = probe ? inferLinearYDomain(probe) : null;
      if (landed && landed[0] === union[0] && landed[1] === union[1]) {
        pins.push({ id: member.id, options: pinned, domain: domains.get(member.id)! });
        continue;
      }
      refuse(
        member.id,
        'scale-group-member-unpinned',
        `chart type '${member.type}' resolved y domain ${landed ? pinDomainText(landed) : 'none'} for member '${member.id}' instead of the shared ${pinDomainText(union)} — the member is excluded from group '${group}'`,
      );
      continue;
    }
    // A broken scale is piecewise, so inferLinearYDomain cannot read its domain
    // back. The member's own break verdict is the authority: it emits
    // axis-break-unsupported when its type ignores the option and
    // axis-break-invalid when its own data forbids the span.
    const verdict = probe?.warnings.find(
      (warning) => warning.code === 'axis-break-unsupported' || warning.code === 'axis-break-invalid',
    );
    if (!probe || verdict || !yAxisBreak(probe)) {
      refuse(
        member.id,
        verdict?.code === 'axis-break-invalid' ? 'scale-group-break-invalid' : 'scale-group-break-unsupported',
        verdict
          ? `member '${member.id}' in scale group '${group}': ${verdict.message}`
          : `chart type '${member.type}' draws no y-axis break for member '${member.id}' in scale group '${group}'`,
      );
      continue;
    }
    const outside = yTickValues(probe).filter((value) => value < union[0] || value > union[1]);
    if (outside.length > 0) {
      refuse(
        member.id,
        'scale-group-member-unpinned',
        `chart type '${member.type}' ticked ${outside.join(', ')} outside the shared domain ${pinDomainText(union)} for member '${member.id}' — the member is excluded from group '${group}'`,
      );
      continue;
    }
    pins.push({ id: member.id, options: pinned, domain: domains.get(member.id)! });
  }
  return pins;
}

/**
 * Resolve one declared scale group.
 *
 * Every member is judged against the others on unit and format, the union
 * domain is the grid's own min/max union, and each member is probed a second
 * time with the pinned bounds so the plan states what the member's layout
 * actually did with them. Members whose probe lands elsewhere, whose type has
 * no numeric linear y scale, or whose break its layout ignores are refused.
 */
export function resolveSharedScale(
  group: string,
  members: readonly SharedScaleMemberRequest[],
): SharedScalePlan {
  const refusals: SharedScaleRefusal[] = [];
  const refuse: Refuse = (memberId, code, message) => {
    refusals.push({ memberId, code, message });
  };

  const reads = readMembers(group, members, refuse);
  const empty = (): SharedScalePlan => ({
    group,
    domain: null,
    break: null,
    members: [],
    refusals: sortRefusals(refusals),
    unreadable: [...new Set(reads.unreadable)].sort(),
  });

  const agreement = agreedBreak(group, reads.declared, compatibleMembers(reads, refuse), refuse);
  const ordered = reads.declared.filter((member) => agreement.compatible.includes(member.id));
  const incomplete = `scale group '${group}' pins only one member after refusals, so no shared domain is claimed`;
  if (ordered.length < 2) {
    if (ordered.length === 1) refuse(null, 'scale-group-incomplete', incomplete);
    return empty();
  }

  const union: [number, number] = [
    minOf(ordered.map((member) => reads.domains.get(member.id)![0])),
    maxOf(ordered.map((member) => reads.domains.get(member.id)![1])),
  ];
  const sharedBreak = validSharedBreak(union, agreement.break, agreement.requestedBy, refuse);
  const pins = pinMembers(group, ordered, reads.domains, union, sharedBreak, refuse);
  if (pins.length < 2) {
    refuse(null, 'scale-group-incomplete', incomplete);
    return empty();
  }

  return {
    group,
    domain: union,
    break: sharedBreak,
    members: pins,
    refusals: sortRefusals(refusals),
    unreadable: [...new Set(reads.unreadable)].sort(),
  };
}

/** Refusals are reported in a stable order, independent of declaration order. */
function sortRefusals(refusals: SharedScaleRefusal[]): SharedScaleRefusal[] {
  return [...refusals].sort((a, b) =>
    (a.memberId ?? '') === (b.memberId ?? '')
      ? compareText(a.code, b.code)
      : compareText(a.memberId ?? '', b.memberId ?? ''));
}

/** The valueAxis override for one member, or null when it is not pinned. */
export function sharedScaleValueAxis(
  plan: SharedScalePlan,
  memberId: string | undefined,
): Record<string, unknown> | null {
  if (memberId === undefined || plan.domain === null) return null;
  const member = plan.members.find((candidate) => candidate.id === memberId);
  const valueAxis = member?.options.valueAxis;
  return isRecord(valueAxis) ? valueAxis : null;
}
