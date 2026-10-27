/** Parse ISO 8601 date-times without the host's zone: a module of its own so the schema reads it without the time-axis engine. */

const MINUTE = 60_000;
const HOUR = 3_600_000;

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

export interface ParsedTime { wall: number; offset?: number }

/** An ISO 8601 date or date-time: its wall-clock fields as UTC ms, and its offset when it names one. */
export function parseTimeText(text: string): ParsedTime | null {
  const m = ISO_TIME.exec(text.trim());
  if (!m) return null;
  const [year, month, day, hour = 0, minute = 0, second = 0] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((v) => (v === undefined ? undefined : Number(v))) as number[];
  if (month! < 1 || month! > 12 || day! < 1 || day! > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const fraction = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (date.getUTCDate() !== day) return null;
  const wall = date.getTime() + hour * HOUR + minute * MINUTE + second * 1000 + fraction;
  const zone = m[8];
  if (zone === undefined) return { wall };
  if (zone === 'Z' || zone === 'z') return { wall, offset: 0 };
  const sign = zone[0] === '-' ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const offset = sign * (Number(digits.slice(0, 2)) * HOUR + Number(digits.slice(2) || '0') * MINUTE);
  return { wall, offset };
}

