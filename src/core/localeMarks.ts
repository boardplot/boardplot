import { splitNumberMarks } from './numberMarks';
import type { LocaleSpec } from './types/options';
import type { LintWarning } from './types/scene';

const POINT_GROUPING_LANGUAGES = new Set('de es it pt nl da el tr id vi hr sl ro'.split(' '));
const SPACE_GROUPING_LANGUAGES = new Set('fr nb no nn sv fi pl cs sk ru uk bg lt lv et hu sr'.split(' '));
const POINT_DECIMAL_REGIONS = new Set('CH LI MX US PR PA PE GT HN NI SV DO 419'.split(' '));

export function localeMarksWarnings(locale: LocaleSpec | undefined): LintWarning[] {
  if (locale?.language === undefined || locale.decimal !== undefined) return [];
  const { language } = splitNumberMarks(locale.language);
  const [primary = '', next, afterScript] = language.split('-', 3);
  const pointGrouping = POINT_GROUPING_LANGUAGES.has(primary);
  if (!pointGrouping && !SPACE_GROUPING_LANGUAGES.has(primary)) return [];

  // A script subtag can sit between the language and region.
  const region = next?.length === 4 ? afterScript : next;
  if (region && POINT_DECIMAL_REGIONS.has(region) && !(primary === 'fr' && region === 'CH')) return [];

  const thousands = pointGrouping ? '.' : ' ';
  return [{
    code: 'locale-marks-unset', severity: 'info', field: ['options', 'locale'],
    message: `The chart uses a decimal point. To use the usual marks for '${language}', set options.locale to { language: '${language}', decimal: ',', thousands: '${thousands}' }.`,
  }];
}
