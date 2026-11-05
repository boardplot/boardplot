import { describe, expect, it } from 'vitest';

import '../src/core/charts';
import { contrastRatio, mixColors } from '../src/core/color';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { resolvePaint } from '../src/core/svg/paint';
import { MARK_CONTRAST_FLOOR, PALETTE_NORMAL_FLOOR, palettePerceptualDistance } from '../src/core/themeRules';
import type { Paint } from '../src/core/types/scene';
import { getFixtures } from '../src/fixtures';
import { effectiveFill, paintColor, resolveTheme, seriesPaint, themes } from '../src/core/theme';
import { COLOUR_CHECK_CODES, parseThemeJson, validateTheme } from '../src/core/themeValidate';
import { validateTheme as exportedValidateTheme } from '../src/validate';
import boardroomJson from '../src/core/themeFamilies/boardroom.json';
import capitalJson from '../src/core/themeFamilies/capital.json';
import studioJson from '../src/core/themeFamilies/studio.json';
import glassJson from '../src/core/themeFamilies/glass.json';

/** Presets must have no validation errors. Warning counts and reasons must match exactly. */

/**
 * Warnings a preset is allowed to carry, with the reason. The count
 * is exact in both directions: a preset that gets quietly worse fails, and one
 * that gets better fails too until someone lowers the number and says why.
 */
const DECLARED_WARNINGS: Record<string, { count: number; reason: string }> = {
  standard: {
    count: 7,
    reason:
      'Seven findings of the colour check ' +
      'on this preset: two Atlantic ranks ' +
      'under 3:1 as marks, the three tones as text, and two swatch pairs ' +
      '(the accent beside the navy rank and the total). The colorblind bad ' +
      'beside the warn went when status cells took warnFill. ' +
      'The check is scoped to the six gallery presets; ' +
      'the Atlantic ranks keep their current spacing.',
  },
  // Expected warning counts for the four design families.
  // Boardroom and studio carry none.
  capital: {
    count: 3,
    reason:
      'Three `palette-band` findings ' +
      "on the family's own capital ramp: the deep indigo anchor sits under the " +
      'readable lightness band (it is the brand), and the teal and slate ranks ' +
      'that replaced the blue and the pale blue carry less chroma ' +
      'than the band asks. The coral accent and its highlight-bad-similar are ' +
      'gone.',
  },
  glass: {
    count: 2,
    reason:
      "Two `palette-band` findings on the family's own glass ramp (ranks 2/3 " +
      'sit above the readable lightness band — luminous data on the dark ' +
      'ground is the design). Chart fonts are Inter: no metric-class warning.',
  },
  'standard-dark': {
    count: 15,
    reason:
      'Fifteen findings of the colour ' +
      'check on this pre-design-system dark preset: fourteen ' +
      'swatch pairs (the accent beside the neutral mark, the total and three ' +
      'Atlantic ranks, the funnel and gantt greys) and bad as text on its ' +
      'chip. This preset was outside the six gallery presets, like standard.',
  },

};

/**
 * The six presets the gallery shows: each passes every rule of
 * the colour check. A finding here means a reader of a shipped exhibit has to
 * guess at a number, a name or a colour.
 */
const GALLERY_PRESETS = ['boardroom', 'notation', 'capital', 'studio', 'notation-dark', 'glass'] as const;

// DERIVED from the shipped registry, never a hand-written list: a preset
// added tomorrow is validated tomorrow, without anyone remembering this file.
const PRESETS = Object.keys(themes).sort();

describe('every shipped theme preset passes its own validator', () => {
  it('all four bundled family files pass the external JSON schema', () => {
    for (const raw of [boardroomJson, capitalJson, studioJson, glassJson]) {
      expect(parseThemeJson(raw).theme.name).toBe(raw.name);
    }
  });

  // A theme that reaches its tokens through a prototype is checked and returned as an owned plain copy.
  it('parseThemeJson returns an owned plain copy, not the caller object', () => {
    const raw = JSON.parse(JSON.stringify(boardroomJson)) as Record<string, unknown>;
    const theme = parseThemeJson(Object.create(raw)).theme;
    expect(Object.getPrototypeOf(theme)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(theme))).toEqual(raw);
    (raw.color as Record<string, string>).good = '#000000';
    expect(theme.color.good).toBe(boardroomJson.color.good);
  });

  it('the sweep is populated — an empty preset list proves nothing', () => {
    expect(PRESETS.length).toBeGreaterThan(2);
  });

  it('no preset reports an ERROR', () => {
    const failing: string[] = [];
    for (const name of PRESETS) {
      const errors = validateTheme(resolveTheme(name)).filter(
        (warning) => warning.severity === 'error',
      );
      for (const error of errors) failing.push(`${name}: ${error.code} — ${error.message}`);
    }
    expect(
      failing,
      'A shipped preset failing its own validator means the library paints a ' +
        'judgment a reader cannot read. A preset whose at-risk ' +
        'and off-track tones were the same colour would fail here.',
    ).toEqual([]);
  });

  it('the six gallery presets pass the colour check', () => {
    const findings = GALLERY_PRESETS.flatMap((name) =>
      validateTheme(resolveTheme(name))
        .filter((warning) => (COLOUR_CHECK_CODES as readonly string[]).includes(warning.code))
        .map((warning) => `${name}: ${warning.code} — ${warning.message}`));
    expect(findings).toEqual([]);
    // A host's theme build runs the same check through boardplot/validate.
    expect(exportedValidateTheme).toBe(validateTheme);
  });

  // The validator holds series against series, not against the bad tone, so studio drew its third series in a red a reader takes for "bad".
  it('keeps the first three series colours of every preset clear of bad', () => {
    const near: string[] = [];
    for (const name of GALLERY_PRESETS) {
      const { color } = resolveTheme(name);
      color.series.slice(0, 3).forEach((series, rank) => {
        for (const bad of [color.bad, color.badFill ?? color.bad]) {
          const distance = palettePerceptualDistance(series, bad);
          if (distance < PALETTE_NORMAL_FLOOR) near.push(`${name} series[${rank}] ${series} is ${distance.toFixed(1)} from bad ${bad}`);
        }
      });
    }
    expect(near).toEqual([]);
  });

  it('holds the ordered ramps class by class, not only at their base ', () => {
    const base = resolveTheme('boardroom');
    const rampOrder = (color: Partial<typeof base.color>) =>
      validateTheme({ ...base, color: { ...base.color, ...color } }).filter((warning) => warning.code === 'ramp-order');
    // A pale ramp base (series 1 since the theme defaults): the top class does not read as the strongest.
    expect(rampOrder({ series: ['#C9D6F0', ...base.color.series.slice(1)] })).toHaveLength(1);
    // A pale signed fill: its classes merge into one another.
    expect(rampOrder({ goodFill: '#E6F2EA' })[0]?.message).toContain('normal OKLab DeltaE');
    expect(rampOrder({})).toEqual([]);
  });

  // A brand's neutral grey beside its red-brown bad was flagged as reading as loss, although a grey has no hue to borrow.
  it('lets a grey sit near a muted bad and still flags a muted warm accent there', () => {
    const base = resolveTheme('boardroom');
    const loss = (neutralMark: string) => validateTheme({ ...base, color: { ...base.color, bad: '#A05A4B', neutralMark } })
      .filter((warning) => warning.code === 'accent-reads-as-loss').map((warning) => warning.message);
    expect(loss('#787978')).toEqual([]);
    expect(loss('#8C6A62')).toHaveLength(1);
  });

  it('every warning is declared, and every declared count is exact', () => {
    const mismatches: string[] = [];
    for (const name of PRESETS) {
      const count = validateTheme(resolveTheme(name)).length;
      const declared = DECLARED_WARNINGS[name];
      const expected = declared?.count ?? 0;
      if (count !== expected) {
        mismatches.push(
          `${name}: ${count} warning(s), declared ${expected}` +
            (declared ? '' : ' (no declaration at all — add one with a reason)'),
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('pins the glass family warnings: two luminous-ramp band findings, no metric drift', () => {
    const warnings = validateTheme(resolveTheme('glass'));
    expect(warnings.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: 'palette-band', severity: 'warn' },
      { code: 'palette-band', severity: 'warn' },
    ]);
  });

  it('warns when the leading family is outside the calibrated metric class', () => {
    // The width model measures Inter/Helvetica metrics. A theme leading with
    // SF Pro renders bold subtitles wider than measured — the validator must say so
    // BEFORE the theme touches a chart.
    const base = resolveTheme('standard');
    const withFamily = (family: string) => ({ ...base, type: { ...base.type, family } });

    const sf = validateTheme(
      withFamily("-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"),
    ).filter((warning) => warning.code === 'family-outside-metric-class');
    expect(sf).toHaveLength(1);
    expect(sf[0]!.severity).toBe('warn');
    expect(sf[0]!.message).toContain("'-apple-system'");

    // quoted first entries are unquoted before the class check
    expect(
      validateTheme(withFamily("'Helvetica Neue', Helvetica, Arial, sans-serif")).filter(
        (warning) => warning.code === 'family-outside-metric-class',
      ),
    ).toEqual([]);
    expect(
      validateTheme(withFamily('Inter, sans-serif')).filter(
        (warning) => warning.code === 'family-outside-metric-class',
      ),
    ).toEqual([]);

    // A licensed brand font has no bundled metric class (a licensed host passes
    // its own tables): a theme that leads with it gets the warning and the hint.
    const hostFont = validateTheme(withFamily("'Host Brand Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"))
      .filter((warning) => warning.code === 'family-outside-metric-class');
    expect(hostFont).toHaveLength(1);
    expect(hostFont[0]!.severity).toBe('warn');
    expect(hostFont[0]!.message).toContain("'Host Brand Sans'");
    expect(hostFont[0]!.suggest).toContain('boardplot fonts build');

    // role-level family overrides are schema-legal and replace the root
    // family during layout (frame.ts withFamily) — a clean root must not
    // whitelist an off-class subtitle override
    const roleOverride = validateTheme({
      ...base,
      type: {
        ...base.type,
        subtitle: { ...base.type.subtitle, family: "'SF Pro Text', sans-serif" },
      },
    }).filter((warning) => warning.code === 'family-outside-metric-class');
    expect(roleOverride).toHaveLength(1);
    expect(roleOverride[0]!.message).toContain('type.subtitle.family');
  });

  it('no declaration exists for a preset that no longer has warnings', () => {
    // The reverse rot: a preset gets fixed and its exemption stays, so the file
    // under-reports its own health and the next reader re-solves a solved
    // problem .
    const stale = Object.keys(DECLARED_WARNINGS).filter(
      (name) => !PRESETS.includes(name),
    );
    expect(stale, 'declared warnings for presets that no longer exist').toEqual([]);
  });

});

describe('hatch colour rules count the stripe share the hatch draws', () => {
  // The rules counted every hatched cell as at least 28% stripe while 0.75 px every 6 px draws 12.5%, and the
  // forecast rule then darkened pale forecasts nearly to black (standard sky #55BEF7 -> #2e6785) to lift an
  // averaged cell the drawn hatch never shows.
  it('averages a hatched cell at stripe width over gap, and keeps a light preset forecast in its series colour', () => {
    const standard = resolveTheme('standard');
    const ink = { ...standard, pattern: { ...standard.pattern, hatchColor: 'ink' as const } };
    expect(effectiveFill('#55BEF7', 'hatch45', ink)).toBe(mixColors(ink.color.ink, ink.color.background, 0.75 / 6));
    expect(paintColor(standard, seriesPaint(1, undefined, 'FC'))).toBe('#55BEF7');
  });
});

describe('dot connectors keep the non-text floor in every preset', () => {
  // The dumbbell connector and range rail drew at 2:1 on light pages and 2.77:1 on glass, under WCAG 1.4.11's 3:1.
  it('draws the dumbbell connector, range rail and caps at 3:1 or more on the page', () => {
    const fixtures = getFixtures('dot').filter((f) => ['share-shift-dumbbell', 'dot-range-benchmark'].includes(f.id));
    expect(fixtures).toHaveLength(2);
    const weak: string[] = [];
    for (const name of Object.keys(themes)) {
      const theme = resolveTheme(name);
      for (const fixture of fixtures) {
        const layout = layoutResolvedRequest(resolveChartRequest({ type: 'dot', data: fixture.data, options: fixture.options, theme: name }));
        if (layout.refused) throw new Error(`${name} ${fixture.id} refused`);
        const marks = layout.scene.filter((node) => ['connector', 'rangeRail', 'rangeCap'].includes(node.part ?? ''));
        expect(marks.length, `${name} ${fixture.id}`).toBeGreaterThan(0);
        for (const node of marks) {
          const ratio = contrastRatio(resolvePaint((node as { stroke: Paint }).stroke, theme), theme.color.background);
          if (ratio < MARK_CONTRAST_FLOOR) weak.push(`${name} ${node.id} ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(weak).toEqual([]);
  });
});
