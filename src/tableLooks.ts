import type { Theme } from './core/types/theme';
import type { DeepPartial } from './core/types/cell';

/** Ready table faces. Apply with theme.overrides; data and chart options stay with the host. */
export const tableLooks: { sheet: DeepPartial<Theme> } = {
  sheet: {
    color: { ink: '#0B1B2B', inkMuted: '#5B6878', axis: '#0B1B2B', grid: '#EDF0F3', rule: '#CDD4DC', leader: '#8193A8', background: '#FFFFFF', neutral: '#5B6878', good: '#147A50', bad: '#B42318', warn: '#8A5A00' },
    type: { family: "'Source Sans 3', system-ui, sans-serif", label: { size: 12.5, weight: 400, lineHeight: 1.44 }, micro: { size: 11, weight: 400, lineHeight: 1.27 } },
    surface: { bandTint: 0.065 },
    table: {
      head: { size: 12, weight: 700, lineHeight: 1.25, case: 'asis' },
      headPad: { top: 5, bottom: 4 },
      section: { weight: 700, lineHeight: 16 / 11, tracking: 0.08, ink: 'ink' },
      rows: { lineHeight: 1.44, pad: 3 },
      weights: { member: 700, measure: 600, subtotal: 600, result: 700, figures: { subtotal: 600, result: 700 } },
      tones: 'fill',
      grounds: { good: '#E5F2EA', goodStrong: '#C8E5D3', warn: '#FBEFD3', bad: '#F7D6D2', subtotal: '#F3F4F5' },
      bar: { fill: 'rgba(11,27,43,0.085)', muted: 'rgba(91,104,120,0.05)' },
      headRule: 'ink', ruleWidths: { head: 2 }, resultRule: 'ink', finalRule: 'double',
      driver: { italic: true }, inks: { driver: '#5B6878' },
      blockRule: 'rule', mark: 'boxed', ofWhich: 'ink', endRule: 'none', glyphs: { missing: '–' },
    },
  },
};
