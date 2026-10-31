/** Pure calendar helpers for the gantt layout. Day numbers are UTC-based, DST-proof. */

import type { GanttGranularity } from './layout';

const DAY_MS = 86400000;
export type Unit = 'week' | 'month' | 'quarter' | 'year';

export function dayNum(d: Date): number {
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}
export function dateFromDay(n: number): Date {
  return new Date(n * DAY_MS);
}
export function floorTo(unit: Unit, d: Date): Date {
  switch (unit) {
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // ISO: Monday = 0
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
    }
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case 'quarter':
      return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
    case 'year':
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  }
}
export function nextOf(unit: Unit, d: Date): Date {
  switch (unit) {
    case 'week':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7));
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    case 'quarter':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
    case 'year':
      return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
  }
}
export function ceilTo(unit: Unit, d: Date): Date {
  const f = floorTo(unit, d);
  return dayNum(f) === dayNum(d) ? f : nextOf(unit, f);
}
/** Period starts of `unit` covering [fromDay, toDay). First may precede fromDay. */
export function boundariesOf(unit: Unit, fromDay: number, toDay: number): Date[] {
  const out: Date[] = [];
  let d = floorTo(unit, dateFromDay(fromDay));
  while (dayNum(d) < toDay) {
    out.push(d);
    d = nextOf(unit, d);
  }
  return out;
}

export interface Tier {
  major: Unit;
  minor: Unit;
  majorFmts: string[];
  minorFmts: string[];
}

export const TIERS: Record<GanttGranularity, Tier> = {
  quarters: { major: 'year', minor: 'quarter', majorFmts: ['yyyy', 'yy'], minorFmts: ['QQ'] },
  months: { major: 'quarter', minor: 'month', majorFmts: ['QQ yyyy', 'QQ'], minorFmts: ['MMM', 'MMMMM'] },
  // A bare week number under a month reads as a day ("7" under Feb); 'W7' does not.
  weeks: { major: 'month', minor: 'week', majorFmts: ['MMM yyyy', 'MMM'], minorFmts: ["'W'w"] },
};

