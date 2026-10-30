/**
 * The years a CAGR annualises over: from two ISO dates on the 30E/360 day
 * count, or from two category labels that name a year. Its own module, so a
 * chart that only parses dates does not load the label grammar.
 */
import { parseISODate, utcDate } from './isoDate';

/**
 * The point in years a category label names: "2024" and "FY2024" give 2024,
 * "FY24" and "'24" give 2024, "Q3 2024" and "2024 Q3" give 2024.5, "24"
 * gives 2024.5. Trailing forecast markers (F, E, A, P, B) are ignored.
 * Null when the label names no year.
 */
function yearFromLabel(label?: string): number | null {
  if (!label) return null;
  const whole = yearFromToken(label.trim());
  if (whole !== null) return whole;
  // "EBITDA FY24", "Revenue 2025F": the year is the last word.
  const words = label.trim().split(/\s+/);
  return words.length > 1 ? yearFromToken(words[words.length - 1]!) : null;
}

/** A quarter or half prefix makes a bare two-digit year unambiguous ("24"). */
function periodYear(token: string): number | null {
  return /^\d{2}$/.test(token) ? 2000 + Number(token) : yearFromToken(token);
}

function yearFromToken(label: string): number | null {
  const text = label.trim().replace(/\s?[FEAPB]$/i, '');
  const quarter = text.match(/^Q([1-4])\s?'?(\d{2,4})$/i) ?? text.match(/^(?:FY\s?)?'?(\d{2,4})\s?Q([1-4])$/i);
  if (quarter) {
    const first = /^Q/i.test(text);
    const year = periodYear(first ? quarter[2]! : quarter[1]!);
    const q = Number(first ? quarter[1] : quarter[2]);
    return year === null ? null : year + (q - 1) / 4;
  }
  const half = text.match(/^H([12])\s?'?(\d{2,4})$/i);
  if (half) {
    const year = periodYear(half[2]!);
    return year === null ? null : year + (Number(half[1]) - 1) / 2;
  }
  const four = text.match(/^(?:FY\s?)?(\d{4})$/i);
  if (four) return Number(four[1]);
  const two = text.match(/^(?:FY\s?'?|')(\d{2})$/i);
  if (two) return 2000 + Number(two[1]);
  return null;
}

/** Years between two labels that name a year; null when either does not. */
export function yearSpanFromLabels(from?: string, to?: string): number | null {
  const a = yearFromLabel(from);
  const b = yearFromLabel(to);
  return a === null || b === null ? null : b - a;
}

/**
 * Year span between ISO dates on the 30E/360 (ISDA) day count; null without
 * both dates. The last day of any month counts as day 30, so an end-of-month
 * anniversary is a whole period: 2024-02-29 to 2025-02-28 is one year, not
 * 359/360 of one (a plain 30/360 reads the short February as a missing day).
 */
export function yearSpan(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return null;
  const day = (d: Date): number => {
    const monthEnd = utcDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getUTCDate();
    return d.getUTCDate() === monthEnd ? 30 : Math.min(d.getUTCDate(), 30);
  };
  const days =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 360 +
    (b.getUTCMonth() - a.getUTCMonth()) * 30 +
    (day(b) - day(a));
  return days / 360;
}
