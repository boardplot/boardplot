// Number census: reads every printed number of every fixture and compares it with its source value.
//
// Usage: npx tsx scripts/number-census.mjs [--only type|type/id,...] [--widths 960,720,480,400,320]
//          [--locales en,de] [--out dir] [--quiet] [--spec request.json,...]
//
// For each fixture, width and locale it lays the chart out once and reads four surfaces:
// the SVG scene text, the hover card (labelCardContent), the accessible value text
// (interactionValueText) and the claim records (`reading`). A printed number is tied to its
// source value through the interaction record of its owner (series/category or row/column) or
// through its claim record. Findings, one class each:
//   false-zero       a nonzero value prints as zero
//   wrong-scale      the text does not say the source value at its printed precision, but
//                    would under another magnitude or percent scale (k vs M, fraction vs percent)
//   mismatch         the text says no source value of its owner at its printed precision
//   collision        two different values of one row, column or series print the same text where
//                    the authored format tells them apart (or, with no format, two significant digits do)
//   precision-lost   the authored format prints more digits than the drawn text, and the author
//                    did not opt out (fitFormats keeps at least two significant digits)
//   mixed-units      one column, row, axis or key prints two magnitudes of one unit, or a header
//                    names a magnitude that a cell repeats or contradicts
//   derived          a printed total or derived claim does not recompute from its inputs
//   garbled-unit     a unit printed twice or out of place in one text
//   raw-digits       a text prints the binary float of a computed value (twelve or more significant decimals)
//   wrong-marks      a text uses the other decimal mark than the chart's locale marks
// The script exits 0; it is an investigation tool. `--out` writes census.json with every finding.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { listCharts, measure, resolveChartRequest } from '../src/index.ts';
import { getFixtures } from '../src/fixtures/index.ts';
import '../src/core/geo/packs/all.ts';
import { chartNumberMarks } from '../src/core/numberMarks.ts';
import { claimsForChart } from '../src/core/claims/index.ts';
import { interactionRecords } from '../src/core/a11y/records.ts';
import { interactionValueText } from '../src/core/a11y/valueText.ts';
import { labelCardContent } from '../src/react/hover/labelCard.ts';
import { formatWithSpec, parseFormatExample } from '../src/core/formatSpec.ts';
import { recomputeClaim } from '../tests/helpers/recompute.ts';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const only = arg('only')?.split(',');
const WIDTHS = arg('widths', '960,720,480,400,320').split(',').map(Number);
const LOCALES = arg('locales', 'en,de').split(',');
const out = arg('out');
const quiet = args.includes('--quiet');
// --spec a.json,b.json: census of request files ({ type, data, options, annotations }) instead of the fixtures.
const specs = arg('spec')?.split(',');

const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, Tausend: 1e3, Million: 1e6, Millionen: 1e6, Milliarden: 1e9, '': 1, k: 1e3, K: 1e3, M: 1e6, m: 1e6, B: 1e9, bn: 1e9, Bn: 1e9, Mio: 1e6, Mrd: 1e9, Tsd: 1e3 };
const CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));
const SUPER = { '⁻': '-', '⁺': '', '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };

/** The number marks of a request: the authored marks, else the language's (LocaleSpec). */
const marks = chartNumberMarks;

const ENGLISH = { decimal: '.', thousands: ',' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every number token of a text: value in source units at the printed scale, half step of the last
 * printed digit, the magnitude letter, percent or pp, a currency sign, a bound sign.
 */
export function tokens(text, m) {
  const group = `[${esc(m.thousands)}\\u202f\\u00a0\\u2009' ’]`;
  const re = new RegExp(String.raw`([<>≈~]?)\s?([+\-−]?)\s?(\p{Sc}|[A-Z]{2,3}\$|CHF\s?)?\s?(\d{1,3}(?:${group}\d{3})+(?:${esc(m.decimal)}\d+)?|\d+(?:${esc(m.decimal)}\d+)?|${esc(m.decimal)}\d+)(?:\s?[×x]\s?10([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))?(?:(m)(?![\p{L}])|\s?(thousand|million|billion|Tausend|Millionen|Million|Milliarden|Mrd|Mio|Tsd|bn|Bn|[kKMB])(?![\p{L}]))?\s?(%|pp|p\.p\.)?(?:\s?(\p{Sc}))?`, 'gu');
  const found = [];
  // ISO dates and times are not values.
  text = text.replace(/\d{4}-\d{2}(?:-\d{2})?(?:T[\d:.]+Z?)?/g, (date) => ' '.repeat(date.length));
  for (const match of text.matchAll(re)) {
    const [, bound, signText, prefix, body, exponent, glued, spaced, pct, postfix] = match;
    const letter = glued ?? spaced ?? '';
    // A word glued in front ("W36", "Q1", "FY2024", "H2") is a name, not a value.
    const before = match[0].startsWith(' ') ? ' ' : text[match.index - 1];
    if (!bound && !signText && !prefix && before && /[\p{L}_]/u.test(before)) continue;
    // "6 values", "60 observations": a count beside the value, not the value.
    if (/^\s?(?:values?|observations?|items?|points?|more|outliers?|Werte|Beobachtungen)\b/u.test(text.slice(match.index + match[0].length))) continue;
    const plain = body.replace(new RegExp(group, 'g'), '').replace(m.decimal, '.');
    const value = Number(plain.startsWith('.') ? `0${plain}` : plain);
    if (!Number.isFinite(value)) continue;
    const decimals = plain.includes('.') ? plain.split('.')[1].length : 0;
    const power = exponent ? Number([...exponent].map((char) => SUPER[char]).join('')) : 0;
    const scale = (SCALE[letter] ?? 1) * 10 ** power;
    const sign = signText === '-' || signText === '−' ? -1 : 1;
    const digits = plain.replace('.', '').replace(/^0+/, '');
    found.push({
      text: match[0].trim(), bound: bound || undefined, value: sign * value * scale, half: 0.5 * 10 ** -decimals * scale,
      decimals, letter, scale, pct: pct === '%' ? '%' : pct ? 'pp' : '', currency: prefix?.trim() || postfix || '',
      significant: digits.length || (value === 0 ? 0 : 1), index: match.index,
    });
  }
  return found;
}

/** Whether a token says `raw` at its printed precision under factor f (f converts raw to the printed unit). */
function says(token, raw, f = 1) {
  if (token.bound === '<') return Math.abs(raw * f) < Math.abs(token.value) + token.half * 1e-6 && Math.sign(raw) === Math.sign(token.value || raw);
  if (token.bound === '>') return Math.abs(raw * f) > Math.abs(token.value) - token.half * 1e-6;
  const tolerance = token.half * (1 + 1e-9) + Math.abs(token.value) * 1e-12;
  return Math.abs(raw * f - token.value) <= tolerance;
}

const ALT_FACTORS = [1e3, 1e-3, 1e6, 1e-6, 1e9, 1e-9, 100, 0.01];

/** Header or label text names a magnitude: "(k)", "(M)", "in $M", "$k", "EUR m". */
function namedMagnitude(text) {
  const hit = /(?:\(|\bin\s|^|\s)(?:\p{Sc}|([A-Z]{3})\s?)?(k|K|M|m|B|bn|Mio\.?|Mrd\.?|Tsd\.?)(?:\p{Sc}|\s?([A-Z]{3}))?(?:\)|$|\s)/u.exec(text);
  // Capitals before or after are a currency code ("EUR K"), not the end of a word ("WEEK 1").
  if (!hit || [hit[1], hit[3]].some((code) => code !== undefined && !CURRENCY_CODES.has(code))) return undefined;
  hit[1] = hit[2];
  const key = hit[1].replace('.', '');
  return SCALE[key] ? key : undefined;
}

/** The magnitude a data unit names: "$bn", "k€", "EUR m", "€m", "kEUR", "M units". */
function dataMagnitude(unit) {
  const hit = /^(?:\p{Sc}\s?|[A-Z]{3}\s?)?(thousand|million|billion|k|K|m|M|bn|B|Mio\.?|Mrd\.?|Tsd\.?)(?:\s?(?:\p{Sc}|[A-Z]{3}))?(?:\s|$)/u.exec(unit.trim());
  return hit ? hit[1].replace('.', '') : undefined;
}

function unitKind(token) {
  return `${token.currency}|${token.pct}`;
}

/** The authored format a table cell prints through, as resolve picks it, or a chart's own. */
function authoredFormat(type, data, options, owner) {
  if (type === 'table' && owner?.rowId !== undefined) {
    const row = findRow(data.rows ?? [], owner.rowId);
    const column = (data.columns ?? []).find((entry) => entry.id === owner.colId);
    const cell = row?.cells?.[owner.colId];
    const own = typeof cell === 'object' && cell !== null ? cell.format : undefined;
    return own ?? column?.format ?? row?.format ?? options.format;
  }
  const measure = dimswitchMeasure(type, data, owner);
  if (typeof measure?.format === 'string') return measure.format;
  const series = Array.isArray(data?.series) ? data.series.find((entry) => entry.id === owner?.seriesId) : undefined;
  const example = series?.format ?? options.format ?? options.valueFormat;
  return typeof example === 'string' ? example : undefined;
}

function flatRows(rows) {
  return rows.flatMap((row) => [row, ...flatRows(row.children ?? [])]);
}

/** A dimswitch row is a path [variant, …, measure]; its measure names the format and the scale. */
function dimswitchMeasure(type, data, owner) {
  if (type !== 'dimswitch' || typeof owner?.rowId !== 'string') return undefined;
  let path = [];
  try { path = JSON.parse(owner.rowId); } catch { /* not a path */ }
  return Array.isArray(path) ? (data.measures ?? []).find((entry) => path.includes(entry.id)) : undefined;
}

/**
 * A money row or measure owns its magnitude and precision over its own format (k, M, B with one decimal);
 * a per-unit one only for whole values, its fractions keep the authored precision. A cell or column format wins.
 */
function engineOwnsPrecision(type, data, owner, raw) {
  let scale;
  if (type === 'table') {
    const row = findRow(data.rows ?? [], owner?.rowId ?? '');
    const cell = row?.cells?.[owner?.colId];
    const columnFormat = (data.columns ?? []).find((entry) => entry.id === owner?.colId)?.format;
    if ((typeof cell === 'object' && cell?.format !== undefined) || columnFormat !== undefined) return false;
    scale = row?.scale;
  } else scale = dimswitchMeasure(type, data, owner)?.scale;
  return scale === 'money' || (scale === 'perUnit' && Number.isInteger(raw));
}

function findRow(rows, id) {
  for (const row of rows) {
    if (row.id === id) return row;
    const child = row.children ? findRow(row.children, id) : undefined;
    if (child) return child;
  }
  return undefined;
}

/** The sign a statement row prints with: the product of its own and its parents' `sign`. */
function rowSign(rows, id, sign = 1) {
  for (const row of rows) {
    const own = sign * (row.sign === -1 ? -1 : 1);
    if (row.id === id) return own;
    const child = row.children ? rowSign(row.children, id, own) : undefined;
    if (child !== undefined) return child;
  }
  return undefined;
}

/** The grid panel a scene id belongs to ("emea/point:rev:fy23" is in "emea"), or ''. */
const panelOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');

/** Every string of a request that carries a figure, without its spaces (a wrapped line adds one). */
function authoredFigures(value, into = []) {
  if (typeof value === 'string') { if (/\d/.test(value)) into.push(value.replace(/\s+/g, '')); }
  else if (Array.isArray(value)) for (const entry of value) authoredFigures(entry, into);
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) if (key !== 'format') authoredFigures(entry, into);
  return into;
}

/** Every `unit` string anywhere in a request. */
function unitStrings(value, into = []) {
  if (Array.isArray(value)) for (const entry of value) unitStrings(entry, into);
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (key === 'unit' && typeof entry === 'string') into.push(entry);
    else unitStrings(entry, into);
  }
  return into;
}

const ownerKey = (owner) => JSON.stringify(Object.entries(owner ?? {}).filter(([, v]) => v !== undefined).sort());

/** Source numbers a record holds: its value, its fields, its share and comparison values. */
function recordNumbers(record, m = ENGLISH) {
  const numbers = [];
  const add = (value, name) => {
    if (value?.kind === 'number' && value.state === 'value' && typeof value.raw === 'number') numbers.push({ raw: value.raw, name, value });
  };
  add(record.value, 'value');
  for (const field of record.fields ?? []) {
    add(field.value, field.key);
    // A statistic the record states as text ("4.4 to 9.3 days", "4,4 bis 9,3" in German marks) holds its figures.
    if (field.value?.kind === 'text' && typeof field.value.raw === 'string' && field.key !== 'date') {
      // A figure printed with its magnitude ("$79.25k") is read in source units already: the unit's scale applies once.
      for (const token of tokens(field.value.raw, m)) numbers.push({ raw: token.value, name: `${field.key}(text)`, ...(token.letter ? { scaled: true } : {}) });
    }
  }
  if (record.share) { add(record.share.numerator, 'share.numerator'); add(record.share.denominator, 'share.denominator'); add(record.share.percent, 'share.percent'); }
  for (const [i, comparison] of (record.comparisons ?? []).entries()) {
    for (const key of ['base', 'delta', 'percent', 'value']) add(comparison[key], `comparison${i}.${key}`);
  }
  return numbers;
}

function textOf(node) {
  return node.lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * One case: one fixture at one width and locale. `measured` is a `measure()` result of exactly this
 * request (the scorecard's own render), so a caller that already laid the chart out pays no second layout.
 */
export function censusCase(type, fixture, width, localeName, measured) {
  const fixtureLocale = fixture.options?.locale ?? {};
  const locale = localeName === 'de' ? { ...fixtureLocale, language: 'de', decimal: ',', thousands: '.' } : fixtureLocale;
  const request = {
    type, data: structuredClone(fixture.data),
    options: { ...structuredClone(fixture.options ?? {}), size: { width }, ...(Object.keys(locale).length ? { locale } : {}) },
    annotations: structuredClone(fixture.annotations ?? fixture.options?.annotations ?? []),
  };
  const m = marks(request.options.locale);
  // Text the author wrote (titles, notes, names, labels) prints as written, in the author's marks.
  m.authored = authoredFigures({ data: request.data, options: fixture.options, annotations: request.annotations });
  const item = { fixture: `${type}/${fixture.id}`, width, locale: localeName };
  const findings = [];
  const flag = (cls, surface, detail) => findings.push({ ...item, class: cls, surface, ...detail });
  if (measured === undefined) {
    // A coded error is a refusal; any other error is a bug the caller reports as a census error.
    try { measured = measure(request); } catch (error) { if (error?.code === undefined) throw error; return { item, status: 'refused', findings, code: error.code }; }
  }
  const geometry = measured.geometry;
  if (!geometry) return { item, status: 'refused', findings };
  const resolved = resolveChartRequest(request);
  const claims = claimsForChart(type, geometry);
  const records = interactionRecords({ request: resolved, geometry, scope: { chart: 'census' }, claims });
  const texts = geometry.scene.filter((node) => node.t === 'text' && node.opacity !== 0).map((node) => ({ id: node.id, text: textOf(node) }))
    .filter((entry) => entry.text !== '');
  const textById = new Map(texts.map((entry) => [entry.id, entry.text]));
  const options = request.options;
  const data = request.data;
  const fitFormats = options.fitFormats === true;
  // Data authored in a unit with a magnitude ("$bn", "k€", "EUR m") is in that unit; one chart unit for all.
  const authoredUnit = typeof options.unit === 'string' ? options.unit : typeof options.unit?.label === 'string' ? options.unit.label : undefined;
  const unitLetter = authoredUnit ? dataMagnitude(authoredUnit) : undefined;
  // A table's unit is the unit its formats print in, not the unit of its cells.
  const dataScale = unitLetter && type !== 'table' ? SCALE[unitLetter] : 1;
  const seriesScale = new Map((Array.isArray(data?.series) ? data.series : []).filter((entry) => typeof entry?.unit === 'string' && dataMagnitude(entry.unit))
    .map((entry) => [entry.id, SCALE[dataMagnitude(entry.unit)]]));
  const ownerScale = (owner) => seriesScale.get(owner?.seriesId) ?? dataScale;
  // Every unit a chart, a panel or a series authors ("$m" on a grid panel): the scales its data may be in.
  const authoredScales = type === 'table' ? [] : [...new Set(unitStrings({ options, data }).map(dataMagnitude).filter(Boolean).map((letter) => SCALE[letter]))];
  const scalesFor = (owner) => [...new Set([ownerScale(owner), ...authoredScales])];

  // Owner -> printed texts in the SVG: table cells by id, chart labels by owner.
  const printedByOwner = new Map();
  const addPrinted = (owner, id, text, group) => {
    const key = `${panelOf(id)}|${ownerKey(owner)}`;
    group = group.map((entry) => `${panelOf(id)}|${entry}`);
    if (!printedByOwner.has(key)) printedByOwner.set(key, []);
    printedByOwner.get(key).push({ id, text, group });
  };
  for (const entry of texts) {
    const cell = /^(?:.*\/)?cell:([^:]+):(.+)$/.exec(entry.id);
    if (cell) addPrinted({ rowId: cell[1], colId: cell[2] }, entry.id, entry.text, [`col:${cell[2]}`, `row:${cell[1]}`]);
  }
  const NOT_VALUES = new Set(['category', 'series', 'axisTitle', 'legend', 'title', 'subtitle']);
  for (const label of geometry.labels ?? []) {
    // Event labels name events and their dates; they print no value of the owner.
    if (label.hidden || NOT_VALUES.has(label.kind) || !label.owner || label.id.startsWith('event:')) continue;
    // The pvm net change is the difference of two totals, not a value of its owner column: its claim (below) checks it.
    if (label.claimId === 'pvm:delta') continue;
    const text = textById.get(label.nodeId ?? `label:${label.id}`) ?? label.text;
    if (!text) continue;
    addPrinted(label.owner, label.id, text, [`kind:${label.kind}:${label.owner.seriesId ?? ''}`]);
  }

  // Header and row-label magnitudes of a table, for hoisted units.
  const headerScale = new Map();
  for (const entry of texts) {
    const header = /^(?:.*\/)?header:(.+)$/.exec(entry.id);
    if (header) headerScale.set(`col:${header[1]}`, { text: entry.text, letter: namedMagnitude(entry.text) });
  }
  const labelColumn = (data.columns ?? []).find((column) => column.kind === 'rowLabel')?.id;
  // The unit a whole table reads in: its label column's header ("EUR K") or the subtitle ("in €M").
  const labelHeader = labelColumn ? headerScale.get(`col:${labelColumn}`) : undefined;
  if (labelHeader?.letter) headerScale.set('label-header', labelHeader);
  const subtitle = texts.find((entry) => /(?:^|\/)frame:subtitle:/.test(entry.id));
  if (type === 'table' && subtitle && namedMagnitude(subtitle.text)) headerScale.set('subtitle', { text: subtitle.text, letter: namedMagnitude(subtitle.text) });
  if (labelColumn) for (const entry of texts) {
    const cell = /^(?:.*\/)?cell:([^:]+):(.+)$/.exec(entry.id);
    if (cell && cell[2] === labelColumn) headerScale.set(`row:${cell[1]}`, { text: entry.text, letter: namedMagnitude(entry.text) });
  }

  // 1. Every record value against what each surface prints for its owner.
  const groupValues = new Map();
  for (const record of records) {
    // An event card states the event's own words and dates, no value of the chart.
    if (record.event) continue;
    const numbers = recordNumbers(record, m);
    if (numbers.length === 0) continue;
    const owner = record.target.owner;
    const example = authoredFormat(type, data, options, owner);
    const surfaces = [];
    // A card or a description of a table cell reads beside the cell's header and row label.
    const groups = owner?.rowId !== undefined ? [`col:${owner.colId}`, `row:${owner.rowId}`] : [];
    for (const printed of printedByOwner.get(`${record.target.panel ?? ''}|${ownerKey(owner)}`) ?? []) surfaces.push({ surface: 'svg', ...printed });
    try {
      const card = labelCardContent(record, resolved.options.locale?.language);
      for (const row of card.rows) if (row.kind === 'value') surfaces.push({ surface: 'hover', id: record.label, text: row.value ?? row.text, group: groups, card: true });
    } catch { /* events and other cards without a value row */ }
    if (record.value.kind === 'number') surfaces.push({ surface: 'a11y', id: record.label, text: interactionValueText(record.value, resolved.options.locale?.language), group: groups, card: true, only: record.value });
    for (const printed of surfaces) {
      const candidates = printed.only ? [{ raw: printed.only.raw, name: 'value', value: printed.only }] : numbers;
      checkPrinted(printed, candidates, example, owner);
    }
  }

  /** A zero is honest when the authored format rounds the value to zero too ("+1.1%" prints −0.02% as 0.0%). */
  function honestZero(raw, example) {
    if (!example) return false;
    try { return !/[1-9]/.test(formatWithSpec(raw, parseFormatExample(example))); } catch { return false; }
  }

  function checkPrinted(printed, candidates, example, owner) {
    // A text in the other decimal mark is its own finding (wrong-marks); its figures cannot be read here.
    if (wrongMarks(printed.text, m)) return;
    // An aspect or a ratio label ("(4:5)", "16:9") names a shape, not a value.
    if (/^\(?\d+:\d+\)?$/.test(printed.text.trim())) return;
    const found = tokens(printed.text, m);
    if (found.length === 0) return;
    // A percent beside a value and its comparison (target, median, base) can be their ratio or change.
    if (found.some((token) => token.pct === '%')) {
      const value = candidates.find((candidate) => candidate.name === 'value');
      if (value) for (const other of candidates) if (other !== value && other.raw !== 0) {
        candidates = [...candidates, { raw: (value.raw / other.raw) * 100, name: `value/${other.name}`, derived: true },
          { raw: (value.raw / other.raw - 1) * 100, name: `value/${other.name}-1`, derived: true }];
      }
    }
    const context = [...printed.group.map((key) => key.replace(/^[^|]*\|/, '')), 'label-header', 'subtitle'].map((key) => headerScale.get(key)).find((entry) => entry?.letter);
    const contextScale = context ? SCALE[context.letter] : undefined;
    // The token and candidate that agree, by the printed scale, by the header's, or by percent.
    // The closest agreement wins: "−0.5 index (Apr 1 = 0)" is the −0.5, not the 0 whose half step reaches it.
    let best;
    for (const dataScale of scalesFor(owner)) for (const token of found) for (const candidate of candidates) {
      const raw = candidate.raw * (candidate.scaled ? 1 : dataScale);
      const factors = [1];
      if (token.pct === '%' || type === 'cohort') factors.push(100);
      // A statement row with sign −1 prints its cost negative; a dimswitch statement prints costs negative.
      if (type === 'dimswitch') factors.push(...factors.map((f) => -f));
      if (type === 'table' && rowSign(data.rows ?? [], owner?.rowId) === -1) factors.push(...factors.map((f) => -f));
      if (contextScale && !token.letter) factors.push(1 / contextScale, 100 / contextScale);
      // A bare figure of data authored in "€m" prints in that unit; the unit stands in the frame or after it.
      if (dataScale !== 1 && !token.letter) factors.push(1 / dataScale);
      for (const f of factors) if (says(token, raw, f)) {
        const error = token.bound ? 0.5 : Math.abs(raw * f - token.value) / (token.half || 1);
        if (!best || error < best.error) best = { token, candidate, f: f * dataScale, error };
      }
    }
    if (best) {
      const { token, candidate } = best;
      if (token.value === 0 && !token.bound && candidate.raw !== 0 && options.smallValues !== 'zero' && !honestZero(candidate.raw, example)) {
        flag('false-zero', printed.surface, { id: printed.id, text: printed.text, raw: candidate.raw, field: candidate.name });
      }
      if (contextScale && token.letter && printed.surface === 'svg') {
        flag('mixed-units', printed.surface, { id: printed.id, text: printed.text, raw: candidate.raw, why: `header "${context.text}" names ${context.letter}, cell prints ${token.letter}` });
      }
      if (printed.surface === 'svg' && candidate.name === 'value') {
        for (const key of printed.group) {
          if (!groupValues.has(key)) groupValues.set(key, []);
          groupValues.get(key).push({ raw: candidate.raw, text: token.text, token, id: printed.id, example, owner, f: best.f });
        }
        precision(printed, token, candidate.raw, example, best.f, owner);
      }
      return;
    }
    // A drawn label with a word beside its figure is a name ("Point 2", "Smallest 10%", "2 top products"), not a value.
    if (printed.surface === 'svg' && /\p{L}{3,}/u.test(found.reduce((rest, token) => rest.replace(token.text, ' '), printed.text))) return;
    // No agreement: a scale error when another factor makes it agree, else a mismatch.
    const token = found.length === 1 ? found[0] : found.reduce((a, b) => (Math.abs(b.value - candidates[0].raw) < Math.abs(a.value - candidates[0].raw) ? b : a));
    const scale = ownerScale(owner);
    for (const candidate of candidates) {
      const alt = ALT_FACTORS.find((f) => says(token, candidate.raw * (candidate.scaled ? 1 : scale), f) && !scalesFor(owner).some((other) => Math.abs(other * f / scale - 1) < 1e-9));
      if (alt !== undefined) {
        flag('wrong-scale', printed.surface, { id: printed.id, text: printed.text, raw: candidate.raw, field: candidate.name, why: `agrees only with the value scaled by ${alt}` });
        return;
      }
    }
    // Sum-consistent rounding moves a share off its nearest rounding by one step (reading.rounding).
    // A table share column rounds by largest remainder to exactly 100% (resolve), the same one step.
    const shareColumn = (type === 'table' && (data.columns ?? []).find((column) => column.id === owner?.colId)?.calc?.op === 'share')
      || /share/i.test(printed.id);
    // A share with no `rounding` takes its chart's default; stacked100 columns and areas default to sum-consistent.
    const shareRecord = options.rounding === undefined && candidates.some((candidate) => candidate.name === 'share.percent');
    if ((options.rounding === 'sum-consistent' || shareColumn || shareRecord) && candidates.some((candidate) => says({ ...token, half: token.half * 3 }, candidate.raw, token.pct === '%' ? 100 : 1) || says({ ...token, half: token.half * 3 }, candidate.raw))) return;
    // A rebased series prints its index, which no record holds.
    if (options.rebase100 || options.rebase !== undefined || options.index !== undefined) return;
    if (token.value === 0 && !token.bound && candidates.some((candidate) => candidate.raw !== 0 && !honestZero(candidate.raw, example))) {
      flag('false-zero', printed.surface, { id: printed.id, text: printed.text, raw: candidates[0].raw, field: candidates[0].name });
      return;
    }
    flag('mismatch', printed.surface, { id: printed.id, text: printed.text, raw: candidates.map((candidate) => `${candidate.name}=${candidate.raw}`).slice(0, 4).join(' ') });
  }

  /** The authored example prints more of this value than the drawn text, and the author did not ask for less. */
  function precision(printed, token, raw, example, f, owner) {
    // A printed zero is the false-zero check's; it can agree at several scales.
    if (!example || raw === 0 || token.bound || token.value === 0) return;
    if (engineOwnsPrecision(type, data, owner, raw)) return;
    let spec;
    try { spec = parseFormatExample(example); } catch { return; }
    const authored = tokens(formatWithSpec(raw, { ...spec, decimalSep: m.decimal, thousandsSep: spec.thousandsSep ? m.thousands : '' }), m)[0];
    // The authored format is the level's; a relative change prints its own percent ("+220%" under '1.2').
    if (!authored || unitKind(authored) !== unitKind(token)) return;
    // Steps in source units: the drawn text's against the authored one's.
    const drawnStep = token.half / f;
    const authoredStep = authored.half / (authored.pct === '%' && token.pct === '%' ? f : 1);
    if (drawnStep <= authoredStep * 1.0001) return;
    const why = fitFormats ? 'fitFormats' : options.magnitude ? `options.magnitude ${options.magnitude}` : 'engine';
    // fitFormats is the author's opt-in to shorter formats; it still keeps two significant digits.
    if (fitFormats && (token.significant >= 2 || authored.significant < 2)) return;
    flag('precision-lost', printed.surface, { id: printed.id, text: printed.text, raw, why: `${why}: authored ${example} prints ${authored.text}` });
  }

  // 2. Collisions and mixed magnitudes inside one column, row or series.
  // A table whose rows name their own formats reads one unit per row; its columns mix units by design.
  const rowFormatted = type === 'table' && flatRows(data.rows ?? []).some((row) => row.format !== undefined || row.scale !== undefined);
  for (const [key, entries] of groupValues) {
    const byText = new Map();
    for (const entry of entries) {
      if (!byText.has(entry.text)) byText.set(entry.text, []);
      byText.get(entry.text).push(entry);
    }
    for (const [text, same] of byText) {
      const distinct = [...new Map(same.map((entry) => [entry.raw, entry])).values()];
      if (distinct.length < 2) continue;
      for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
        const a = distinct[i], b = distinct[j];
        if (Math.abs(a.raw - b.raw) <= Math.abs(a.raw) * 1e-12) continue;
        // fitFormats is the author's opt-in to shorter formats: two significant digits are its promise, not distinctness.
        if (fitFormats && a.token.significant >= 2) continue;
        const tell = tellsApart(a, b);
        if (!tell) continue;
        flag('collision', 'svg', { id: `${a.id} & ${b.id}`, text, raw: `${a.raw} & ${b.raw}`, why: tell, group: key });
        i = distinct.length;
        break;
      }
    }
    const kinds = new Map();
    for (const entry of entries) {
      const kind = unitKind(entry.token);
      if (!kinds.has(kind)) kinds.set(kind, new Set());
      kinds.get(kind).add(entry.token.letter);
    }
    for (const [kind, letters] of kinds) {
      if (letters.size < 2 || (rowFormatted && key.includes('|col:'))) continue;
      // A bare figure beside "k" figures is mixed only when the bare one is 1,000 or more.
      const lettered = [...letters].filter(Boolean);
      const bareLarge = letters.has('') && entries.some((entry) => unitKind(entry.token) === kind && !entry.token.letter && Math.abs(entry.token.value) >= 1000);
      if (lettered.length >= 2 || bareLarge) {
        const sample = entries.filter((entry) => unitKind(entry.token) === kind).map((entry) => entry.text);
        flag('mixed-units', 'svg', { id: key, text: [...new Set(sample)].slice(0, 6).join(' · '), why: `magnitudes ${[...letters].map((l) => l || 'none').join(', ')}` });
      }
    }
  }

  function tellsApart(a, b) {
    if (a.example) {
      try {
        const spec = parseFormatExample(a.example);
        const local = { ...spec, decimalSep: m.decimal, thousandsSep: spec.thousandsSep ? m.thousands : '' };
        // A cost line prints with its sign flipped (f < 0): +0.08 and −0.06 both print −0.1.
        const ta = formatWithSpec(Math.sign(a.f) * a.raw, local), tb = formatWithSpec(Math.sign(b.f) * b.raw, local);
        return ta !== tb ? `authored ${a.example} prints ${ta} and ${tb}` : undefined;
      } catch { return undefined; }
    }
    // No authored format: the engine's precision is the author's choice of none.
    return undefined;
  }

  // 3. Claims: the displayed text says the raw value, and a derivation recomputes.
  for (const claim of claims) {
    if (claim.output.state === 'value' && typeof claim.output.raw === 'number' && claim.output.displayed) {
      const found = tokens(claim.output.displayed, m);
      // A histogram bin's claim displays its range label, not its count.
      if (found.length > 0 && !/^annotation-/.test(claim.op) && !claim.op.startsWith('quadrant') && !claim.op.startsWith('histogram-bin-count') && !/count@/.test(claim.op)) {
        // A table cell reads in the magnitude its header or row label names.
        const cell = /^(?:.*\/)?cell:([^:]+):(.+)$/.exec(claim.nodeId ?? '');
        const context = [...(cell ? [`col:${cell[2]}`, `row:${cell[1]}`] : []), 'label-header', 'subtitle'].map((key) => headerScale.get(key)).find((entry) => entry?.letter);
        const contextScale = context ? SCALE[context.letter] : 1;
        const raw = claim.output.raw * dataScale;
        const signed = type === 'dimswitch' || (cell && rowSign(data.rows ?? [], cell[1]) === -1);
        const shareCell = cell && (data.columns ?? []).find((column) => column.id === cell[2])?.calc?.op === 'share';
        const ok = found.some((token) => says(token, raw) || (signed && says(token, -raw)) || ((token.pct === '%' || type === 'cohort') && says(token, raw, 100)) || (!token.letter && says(token, raw, 1 / dataScale))
          || (!token.letter && says(token, raw, 1 / contextScale))
          || (shareCell && says({ ...token, half: token.half * 3 }, raw, token.pct === '%' ? 1 : 0.01)));
        if (!ok) {
          const token = found[0];
          const alt = ALT_FACTORS.find((f) => found.some((t) => says(t, raw, f)));
          if (token.value === 0 && !token.bound && claim.output.raw !== 0) flag('false-zero', 'reading', { id: claim.id, text: claim.output.displayed, raw: claim.output.raw, why: claim.op });
          else if (alt !== undefined) flag('wrong-scale', 'reading', { id: claim.id, text: claim.output.displayed, raw: claim.output.raw, why: `${claim.op}, scaled by ${alt}` });
          else flag('mismatch', 'reading', { id: claim.id, text: claim.output.displayed, raw: claim.output.raw, why: claim.op });
        }
      }
    }
    try {
      const verdict = recomputeClaim(claim);
      if (verdict && verdict.status === 'mismatch') flag('derived', 'reading', { id: claim.id, text: claim.output.displayed, raw: claim.output.raw, why: `${claim.op}: recomputes to ${verdict.expected}` });
    } catch { /* ops recompute does not know */ }
  }

  // 4. Axis ticks and keys: one magnitude per axis; units printed once per text.
  const tickGroups = new Map();
  for (const entry of texts) {
    const tick = /^(?:(.*)\/)?axis:([^:]+):tick:/.exec(entry.id) ?? /^(?:(.*)\/)?(key|legend)[:-]/.exec(entry.id);
    if (!tick) continue;
    const key = `${tick[1] ?? ''}:${tick[2]}`;
    if (!tickGroups.has(key)) tickGroups.set(key, []);
    tickGroups.get(key).push(...tokens(entry.text, m));
  }
  for (const [key, found] of tickGroups) {
    const kinds = new Map();
    for (const token of found) {
      const kind = unitKind(token);
      if (!kinds.has(kind)) kinds.set(kind, new Set());
      kinds.get(kind).add(token.letter);
    }
    for (const [kind, letters] of kinds) {
      const bareLarge = letters.has('') && found.some((token) => unitKind(token) === kind && !token.letter && Math.abs(token.value) >= 1000);
      if ([...letters].filter(Boolean).length >= 2 || (letters.size >= 2 && bareLarge)) {
        flag('mixed-units', 'svg', { id: key, text: found.filter((token) => unitKind(token) === kind).map((token) => token.text).slice(0, 8).join(' · '), why: `magnitudes ${[...letters].map((l) => l || 'none').join(', ')}` });
      }
    }
  }
  const authoredNumbers = new Set();
  const collectNumbers = (value) => {
    if (typeof value === 'number') authoredNumbers.add(value);
    else if (Array.isArray(value)) value.forEach(collectNumbers);
    else if (value && typeof value === 'object') Object.values(value).forEach(collectNumbers);
  };
  collectNumbers(request.data);
  const surfacesText = [...texts.map((entry) => ({ surface: 'svg', id: entry.id, text: entry.text }))];
  for (const record of records) {
    // An authored value reads exact, residue and all (a source number is the author's): only a computed one is a finding.
    const authoredRaw = record.value.derived === undefined && authoredNumbers.has(record.value.raw);
    if (record.value.kind === 'number' && !authoredRaw) surfacesText.push({ surface: 'a11y', id: record.label, text: interactionValueText(record.value, resolved.options.locale?.language) });
    try { for (const row of labelCardContent(record, resolved.options.locale?.language).rows) surfacesText.push({ surface: 'hover', id: record.label, text: row.text }); } catch { /* no card */ }
  }
  for (const entry of surfacesText) {
    for (const why of garbled(entry.text, m)) {
      flag(why.startsWith('binary float') ? 'raw-digits' : why.startsWith('decimal') ? 'wrong-marks' : 'garbled-unit', entry.surface, { id: entry.id, text: entry.text, why });
    }
  }
  return { item, status: 'drawn', findings };
}

/** A unit written twice, or a currency sign after a bare figure in English marks. */
/** The exception file: findings a reviewed PR accepted, one reason each. */
export const EXCEPTIONS_FILE = new URL('./number-census-exceptions.json', import.meta.url);
const exceptionKey = (entry) => JSON.stringify([entry.fixture, entry.width, entry.locale, entry.surface, entry.text]);

/** The findings no exception names, matched exactly by fixture, width, locale, surface and text. */
export function unexcepted(findings, exceptions) {
  const unexplained = exceptions.find((entry) => typeof entry.reason !== 'string' || !entry.reason.trim());
  if (unexplained) throw new Error(`Number census exception without a reason: ${exceptionKey(unexplained)}`);
  const accepted = new Set(exceptions.map(exceptionKey));
  return findings.filter((finding) => !accepted.has(exceptionKey(finding)));
}

/** One failure line: where it prints, what it prints, the source value and the rule it breaks. */
export function failureLine(finding) {
  const source = finding.raw === undefined || finding.raw === '' ? '' : ` source ${finding.raw}`;
  return `NUMBER ${finding.fixture} @${finding.width} ${finding.locale} ${finding.surface}: ${JSON.stringify(finding.text)}${source} — ${finding.class}${finding.why ? ` (${finding.why})` : ''}`;
}

export function garbled(text, m) {
  const why = [];
  const paren = [...text.matchAll(/\((?:[^()]*?\s)?(k|M|B|bn|%|pp|\p{Sc}[kMB]?|[kMB]\p{Sc})\)/gu)].map((hit) => hit[1]);
  if (paren.length >= 2 && new Set(paren).size < paren.length) why.push(`unit ${paren[0]} in parentheses twice`);
  if (/(%\s*%|pp\s*%|%\s*pp|(\p{Sc})\s*\2)/u.test(text)) why.push('unit sign doubled');
  if (/\d\s?([kMB])\s?\1(?![\p{L}])/u.test(text)) why.push('magnitude letter doubled');
  if (/\d\s?[kMB]\s?\((?:k|M|B)\)/u.test(text)) why.push('magnitude on the figure and in parentheses');
  if (m.decimal === '.' && /^[−+-]?\d[\d,.]*\s\$$/u.test(text.trim())) why.push('dollar sign after the figure');
  // Residue is twelve or more significant digits after the mark; an exact tiny value (0.0000000000003) is not.
  if (/\d[.,]0*[1-9]\d{11,}/u.test(text)) why.push('binary float residue printed (twelve or more significant decimals)');
  const marks = wrongMarks(text, m);
  if (marks) why.push(marks);
  return why;
}

/** A figure written with the other decimal mark than the chart's marks. */
function wrongMarks(text, m) {
  if (m.authored?.length) {
    text = text.replace(/\s+/g, '');
    // A wrapped line is a part of an authored text; a card row can hold an authored text and more.
    if (m.authored.some((piece) => piece.includes(text))) return undefined;
    for (const piece of m.authored) text = text.split(piece).join(' ');
  }
  if (m.decimal === '.' && /(?<![\d,])\d{1,3},(?:\d{1,2}|\d{4,})(?![\d,])/u.test(text)) return "decimal comma in a chart with '.' marks";
  if (m.decimal === ',' && /(?<![\d.])\d{1,3}\.(?:\d{1,2}|\d{4,})(?![\d.])/u.test(text)) return "decimal point in a chart with ',' marks";
  return undefined;
}

function main() {
  const charts = listCharts().map(({ type }) => type).filter((type) => !only || only.some((entry) => entry.split('/')[0] === type));
  const all = [];
  let cases = 0, drawn = 0;
  const started = performance.now();
  const sources = specs
    ? specs.map((file) => { const spec = JSON.parse(readFileSync(file, 'utf8')); return { type: spec.type, fixtures: [{ ...spec, id: basename(file, '.json') }] }; })
    : charts.map((type) => ({ type, fixtures: getFixtures(type) }));
  for (const { type, fixtures } of sources) {
    for (const fixture of fixtures) {
      if (!specs && only && !only.some((entry) => entry === type || entry === `${type}/${fixture.id}`)) continue;
      for (const locale of LOCALES) for (const width of WIDTHS) {
        cases++;
        let result;
        try { result = censusCase(type, fixture, width, locale); } catch (error) {
          all.push({ fixture: `${type}/${fixture.id}`, width, locale, class: 'census-error', surface: '-', text: String(error.message ?? error).slice(0, 200) });
          continue;
        }
        if (result.status === 'drawn') drawn++;
        all.push(...result.findings);
      }
    }
    if (!quiet) process.stderr.write(`${type} done, ${all.length} findings, ${((performance.now() - started) / 1000).toFixed(0)} s\n`);
  }
  // One finding per fixture, class, surface, id and text across widths and locales.
  const unique = new Map();
  for (const finding of all) {
    const key = JSON.stringify([finding.fixture, finding.class, finding.surface, finding.id, finding.text, finding.why]);
    const seen = unique.get(key);
    if (seen) seen.cases.push(`${finding.locale}@${finding.width}`);
    else unique.set(key, { ...finding, cases: [`${finding.locale}@${finding.width}`] });
  }
  const findings = [...unique.values()];
  const byClass = {};
  for (const finding of findings) byClass[finding.class] = (byClass[finding.class] ?? 0) + 1;
  const summary = { cases, drawn, findings: findings.length, raw: all.length, byClass, fixtures: new Set(findings.map((finding) => finding.fixture)).size };
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(resolve(out, 'census.json'), JSON.stringify({ summary, findings }, null, 1) + '\n');
  }
  console.log(JSON.stringify(summary));
  if (!out) for (const finding of findings) console.log(`${finding.class}\t${finding.surface}\t${finding.fixture}\t${finding.id}\t${JSON.stringify(finding.text)}\traw=${finding.raw ?? ''}\t${finding.why ?? ''}\t[${finding.cases.length}]`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('number-census.mjs')) main();
