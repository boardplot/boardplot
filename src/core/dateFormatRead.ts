import { dateNames } from './dateNames';

export interface DateFormatNote {
  kind: 'unknown' | 'ambiguous' | 'fiscal';
  message: string;
  suggest?: string;
}

export interface DateFormatRead {
  /** Undefined on a time axis means the automatic text for the tick step. */
  pattern: string | undefined;
  notes: DateFormatNote[];
}

type Context = 'table' | 'time';
const TABLE_DEFAULT = 'd MMM yyyy';
const DATE_TOKENS = /yyyy|YYYY|yy|YY|MMMMM|MMMM|mmmm|MMM|mmm|MM|mm|M|m|dddd|ddd|dd|DD|d|D|QQQ|QQ|Q|ww|w/g;
const TIME_TOKENS = /yyyy|YYYY|yy|YY|MMMM|mmmm|MMM|mmm|MM|mm|M|m|dddd|ddd|dd|DD|d|D|QQQ|QQ|Q|HH|H|hh|h|ss|SSS|a/g;
const SEPARATOR = /^[ ./,–-]+$/;
const ALIASES: Record<string, string> = { YYYY: 'yyyy', YY: 'yy', D: 'd', DD: 'dd', mmm: 'MMM', mmmm: 'MMMM' };

/** Read tokens before examples, keeping quoted words out of token classification. */
function readPattern(text: string, context: Context): string | undefined {
  const parts = text.match(/'[^']*'|[\p{L}]+|[^'\p{L}]+/gu) ?? [];
  if (!parts.length || parts.join('') !== text) return undefined;
  const tokens: string[] = [];
  for (const part of parts) {
    if (part.startsWith("'")) { tokens.push(part); continue; }
    if (/\d/.test(part)) return undefined;
    if (!/\p{L}/u.test(part)) { tokens.push(part); continue; }
    const run = part.match(context === 'table' ? DATE_TOKENS : TIME_TOKENS) ?? [];
    if (run.join('') !== part) return undefined;
    tokens.push(...run);
  }
  const clock = tokens.some(token => /^(?:HH|H|hh|h|ss)$/.test(token));
  const date = tokens.some(token => /^(?:y|Y|d|D|M|Q|w|mmm)/.test(token));
  const result: string[] = [];
  for (const token of tokens) {
    if (token === 'm' || token === 'mm') {
      if (!clock && date) result.push(token === 'm' ? 'M' : 'MM');
      else if (context === 'time' && token === 'mm') result.push(token);
      else return undefined;
    } else {
      result.push(ALIASES[token] ?? token);
    }
  }
  return result.join('');
}

const fiscalNote = (): DateFormatNote => ({
  kind: 'fiscal',
  message: 'The fiscal year is read as the calendar year. A fiscal year that starts in another month is not supported.',
});

interface Name { token: string; month?: number; weekday?: number }

/** English examples work in every language; the selected language adds its own names. */
function exampleNames(language?: string): Map<string, Name> {
  const names = new Map<string, Name>();
  const add = (word: string, name: Name) => {
    // Keep English month examples such as 'Mar-26' when a weekday abbreviation shares the word.
    if (names.get(word)?.month !== undefined && name.month === undefined) return;
    names.set(word, name);
  };
  for (const set of [dateNames('en'), dateNames(language)]) {
    for (const [full, short, longToken, shortToken] of [
      [set.months, set.monthsShort, 'MMMM', 'MMM'],
      [set.days, set.daysShort, 'dddd', 'ddd'],
    ] as const) {
      full.forEach((name, index) => {
        const month = longToken === 'MMMM' ? index + 1 : undefined;
        const weekday = longToken === 'dddd' ? index : undefined;
        const abbreviation = name.slice(0, 3).toLowerCase();
        if (!names.has(abbreviation)) add(abbreviation, { token: shortToken, month, weekday });
        add(name.toLowerCase(), { token: longToken, month, weekday });
      });
      short.forEach((name, index) => add(name.replace(/\.$/, '').toLowerCase(), {
        token: shortToken, month: longToken === 'MMMM' ? index + 1 : undefined,
        weekday: longToken === 'dddd' ? index : undefined,
      }));
    }
  }
  return names;
}

function readExample(text: string, language?: string): DateFormatRead | undefined {
  const fiscal = /^FY([ -]?)(\d{4}|\d{2})$/i.exec(text);
  if (fiscal) return { pattern: `'FY'${fiscal[1]}${fiscal[2]!.length === 4 ? 'yyyy' : 'yy'}`, notes: [fiscalNote()] };
  const quarter = /^(Q|Quarter) *([1-4])(?:([ ./,–-]+)(\d{4}|\d{2}))?$/i.exec(text);
  if (quarter) return {
    pattern: `${quarter[1]!.toLowerCase() === 'q' ? 'QQ' : 'QQQ'}${quarter[4] ? quarter[3]! + (quarter[4].length === 4 ? 'yyyy' : 'yy') : ''}`,
    notes: [],
  };
  const parts = text.match(/[\p{L}]+|\d+|[ ./,–-]+/gu) ?? [];
  if (!parts.length || parts.join('') !== text) return undefined;
  const names = exampleNames(language);
  const localized = dateNames(language);
  const fields: { index: number; text: string; name?: Name }[] = [];
  const pattern = [...parts];
  for (const [index, part] of parts.entries()) {
    if (SEPARATOR.test(part)) continue;
    const name = names.get(part.toLowerCase());
    if (!/^\d+$/.test(part) && !name) return undefined;
    fields.push({ index, text: part, name });
    if (name) {
      pattern[index] = name.token;
      // A period already printed by a localized abbreviation is not a second separator.
      const short = name.token === 'MMM' ? localized.monthsShort[name.month! - 1]
        : name.token === 'ddd' ? localized.daysShort[name.weekday!] : undefined;
      if (short?.endsWith('.') && parts[index + 1]?.startsWith('.')) pattern[index + 1] = parts[index + 1]!.slice(1);
    }
  }
  const months = fields.filter(field => field.name?.month !== undefined);
  const weekdays = fields.filter(field => field.name && field.name.month === undefined);
  const numbers = fields.filter(field => !field.name);
  if (months.length > 1 || weekdays.length > 1) return undefined;
  const notes: DateFormatNote[] = [];
  if (months.length) {
    const month = months[0]!;
    const years = numbers.filter(field => field.text.length === 4);
    const short = numbers.filter(field => field.text.length <= 2);
    if (years.length > 1 || short.length > 2 || years.length + short.length !== numbers.length) return undefined;
    if (years[0]) pattern[years[0].index] = 'yyyy';
    const dayToken = (field: { text: string }) => (field.text.startsWith('0') ? 'dd' : 'd');
    const validDay = (field: { text: string }) => +field.text >= 1 && +field.text <= 31;
    if (years.length) {
      // With a four-digit year, a short number is the day, on either side of the month.
      if (short.length > 1 || (short[0] && !validDay(short[0]))) return undefined;
      if (short[0]) pattern[short[0].index] = dayToken(short[0]);
    } else if (short.length === 2) {
      // '30 Sep 26': the number before the month is the day, the one after it the year.
      const [first, second] = short as [typeof short[0], typeof short[0]];
      if (first.index > month.index || second.index < month.index || !validDay(first)) return undefined;
      pattern[first.index] = dayToken(first);
      pattern[second.index] = 'yy';
    } else if (short[0]) {
      const field = short[0];
      if (field.index < month.index || weekdays.length) {
        // '30 Sep', 'Wed 30 Sep': a number before the month, or beside a weekday, is the day.
        if (!validDay(field)) return undefined;
        pattern[field.index] = dayToken(field);
      } else {
        pattern[field.index] = 'yy';
        const between = parts.slice(month.index + 1, field.index).join('');
        if (+field.text <= 31 && /[ ,]/.test(between)) notes.push({
          kind: 'ambiguous',
          message: `Read '${text}' as month/year. '${field.text}' is the year.`,
          suggest: "Use 'MMM d' for month and day, or write a four-digit year.",
        });
      }
    }
  } else if (numbers.length === 1 && numbers[0]!.text.length === 4) {
    pattern[numbers[0]!.index] = 'yyyy';
  } else if (numbers.length === 2) {
    const year = numbers.find(field => field.text.length === 4);
    const month = numbers.find(field => field !== year);
    if (!year || !month || month.text.length > 2 || +month.text < 1 || +month.text > 12) return undefined;
    pattern[year.index] = 'yyyy';
    pattern[month.index] = month.text.length === 2 ? 'MM' : 'M';
  } else if (numbers.length === 3) {
    const year = numbers[0]!.text.length === 4 ? numbers[0]! : numbers[2]!;
    if (year.text.length !== 4 && year.text.length !== 2) return undefined;
    const pair = numbers.filter(field => field !== year);
    if (pair.some(field => field.text.length > 2 || +field.text < 1 || +field.text > 31)) return undefined;
    const first = pair[0]!, second = pair[1]!;
    // A year in front always reads year, month, day (2026-09-30, 2026/09/30).
    const yearFirst = year === numbers[0];
    const monthFirst = yearFirst || +second.text > 12;
    const day = monthFirst ? second : first, month = monthFirst ? first : second;
    if (+month.text > 12) return undefined;
    const padded = pair.some(field => field.text.startsWith('0')) || pair.every(field => field.text.length === 2);
    pattern[year.index] = year.text.length === 4 ? 'yyyy' : 'yy';
    pattern[day.index] = padded ? 'dd' : 'd';
    pattern[month.index] = padded ? 'MM' : 'M';
    if (!yearFirst && pair.every(field => +field.text <= 12)) notes.push({
      kind: 'ambiguous',
      message: `Read '${text}' as day/month/year, ${+day.text} ${dateNames('en').months[+month.text - 1]} ${year.text}.`,
      suggest: "Write a day above 12, or use the pattern 'MM/dd/yyyy' for month/day/year.",
    });
  } else if (numbers.length || !fields.length) return undefined;
  return { pattern: pattern.join(''), notes };
}

/** One small reader for authored table dates and time ticks, without the date formatter. */
export function readDateFormat(text: string | undefined, context: Context, language?: string): DateFormatRead {
  const fallback = context === 'table' ? TABLE_DEFAULT : undefined;
  if (text === undefined) return { pattern: fallback, notes: [] };
  const pattern = readPattern(text, context);
  if (pattern !== undefined) return { pattern, notes: /'FY'\s*(?:yyyy|yy)/i.test(pattern) ? [fiscalNote()] : [] };
  const example = readExample(text, language);
  if (example) return example;
  return {
    pattern: fallback,
    notes: [{
      kind: 'unknown',
      message: `Date format '${text}' was not read. ${context === 'table' ? "The default 'd MMM yyyy' is used." : 'The default ticks are used.'}`,
      suggest: "Write an example such as '30 Sep 2026' or a pattern such as 'dd.MM.yyyy'. Quote literal words with single quotes.",
    }],
  };
}
