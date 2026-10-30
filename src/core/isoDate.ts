/** A UTC date. setUTCFullYear, not Date.UTC, which reads years 0–99 as 1900–1999. */
export function utcDate(year: number, month: number, day = 1): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

/** Parse ISO dates (yyyy-mm-dd) without timezone surprises. */
export function parseISODate(s: string): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(year, month - 1, day);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}
