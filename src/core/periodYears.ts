/**
 * The years a CAGR annualises over: from two ISO dates on the 30E/360 day
 * count, or from two category labels that name a year. Its own module, so a
 * chart that only parses dates does not load the label grammar.
 */
import { parseISODate } from './isoDate';

/** A year token: "2024", "FY2024", "FY24", "'24". A bare "24" counts only next to a quarter or half, which shows it is a year. */
function yearOf(token: string, bare = false): { year: number; short: boolean } | null {
  const four = /^(?:FY\s?)?(\d{4})$/i.exec(token);
  if (four) return { year: Number(four[1]), short: false };
  const two = (bare ? /^(?:FY\s?)?['’]?(\d{2})$/i : /^(?:FY\s?['’]?|['’])(\d{2})$/i).exec(token);
  return two ? { year: 2000 + Number(two[1]), short: true } : null;
}

/** English and German month names, long and short, in calendar order. */
const MONTH_NAMES = ['jan(?:uary|uar)?', 'feb(?:ruary|ruar)?', 'mar(?:ch|z)?', 'apr(?:il)?', 'ma[iy]', 'jun[ie]?', 'jul[iy]?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'o[ck]t(?:ober)?', 'nov(?:ember)?', 'de[cz](?:ember)?'].map((name) => new RegExp(`^${name}$`));
const UNIT = String.raw`(?:Q(?<q>[1-4])|H(?<h>[12])|(?<n>[12])H)`;
const UNIT_FIRST = new RegExp(String.raw`^${UNIT}\s?(?<y>.+)$`, 'i');
const UNIT_LAST = new RegExp(String.raw`^(?<y>.+?)\s?${UNIT}$`, 'i');

/**
 * The first month a period phrase names, counted from year 0, and whether its
 * year had two digits. Forms: "2024", "FY24", "Q3 2024", "Q3 FY24", "FY24 Q3",
 * "H2 2024", "2H 2024", "Jan 2024", "January 2024" and "Jan '24", with English
 * or German month names. Trailing forecast markers (F, E, A, P, B) are ignored.
 * Null for anything else, such as "Jan-23", which could be a day.
 */
function periodOf(text: string): { months: number; short: boolean } | null {
  const t = text.replace(/\s?[FEAPB]$/i, '');
  const unit = UNIT_FIRST.exec(t) ?? UNIT_LAST.exec(t);
  const month = unit ? null : /^(?<name>[a-zäöü]+)\.?\s+(?<y>['’]\d{2}|\d{4})$/i.exec(t);
  const g = (unit ?? month)?.groups;
  const month0 = unit
    ? (g!.q ? (Number(g!.q) - 1) * 3 : (Number(g!.h ?? g!.n) - 1) * 6)
    : month ? MONTH_NAMES.findIndex((name) => name.test(g!.name!.toLowerCase().replace('ä', 'a'))) : 0;
  const year = yearOf((g?.y ?? t).trim(), !!unit);
  return year === null || month0 < 0 ? null : { months: year.year * 12 + month0, short: year.short };
}

/** A label's period and the words before it: "Revenue Q4 2023" is Q4 2023 led by "revenue". */
function periodOfLabel(label?: string) {
  const words = label?.trim().split(/\s+/) ?? [];
  for (let k = 0; k < words.length; k++) {
    const period = periodOf(words.slice(k).join(' '));
    if (period) return { ...period, lead: words.slice(0, k).join(' ').toLowerCase(), bareYear: k === words.length - 1 && /^\d{4}$/.test(words[k]!) };
  }
  return null;
}

const PERIOD_WORD = /^(?:q\d?|h\d?|quarter|half|halves|w|wk|kw|cw|weeks?|woche|spring|summer|autumn|fall|winter|early|mid|late|start|end|begin(?:ning)?)$/;

/** True when a lead holds a digit or a word that names a point inside a year, so it is not a name like "Plan". */
function leadIsPeriodic(lead: string): boolean {
  return /\d/.test(lead) || lead.split(/[\s-]+/).some((w) => PERIOD_WORD.test(w) || MONTH_NAMES.some((m) => m.test(w.replace(/\.$/, ''))));
}

/**
 * Years between two labels that name a period, or are two ISO dates. Null when
 * either does not, when the words before the periods differ ("Revenue Q4 2023" to
 * "Cost Q1 2025"), and for week labels, which need a calendar of their own.
 */
export function yearSpanFromLabels(from?: string, to?: string): number | null {
  const dated = yearSpan(from, to);
  if (dated !== null) return dated;
  const a = periodOfLabel(from);
  const b = periodOfLabel(to);
  if (!a || !b || /(?:^|\s)(?:w|wk|kw|cw|week|woche)\s?\d+$/.test(a.lead)) return null;
  // Different leads are fine on a bare last-word year when neither lead is part of the period: "Plan 2024" to "Actual 2026".
  if (a.lead !== b.lead && !(a.bareYear && b.bareYear && !leadIsPeriodic(a.lead) && !leadIsPeriodic(b.lead))) return null;
  // A two-digit start more than 50 years after the end is in the century before ("FY98" to "FY02").
  const start = a.short && a.months > b.months + 600 ? a.months - 1200 : a.months;
  return (b.months - start) / 12;
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
  // The same month and day is whole years, also on 28 February, a month end in only some years.
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()) return b.getUTCFullYear() - a.getUTCFullYear();
  const day = (d: Date): number => {
    const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return d.getUTCDate() === monthEnd ? 30 : Math.min(d.getUTCDate(), 30);
  };
  const days =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 360 +
    (b.getUTCMonth() - a.getUTCMonth()) * 30 +
    (day(b) - day(a));
  return days / 360;
}
