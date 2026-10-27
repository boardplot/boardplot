/**
 * Table zod schemas. Validation errors here are the
 * agent's documentation — every closed vocabulary lists its members in the
 * error message, every described field teaches through `describe --schema`.
 */

import * as z from 'zod';
import { valueBandsSchema } from '../../bands';
import { boundedNumber, formatExample, MAGNITUDE_WORDS_DOC } from '../../schema/shared';
import { addDuplicateIdIssues, refusedBaseOptions } from '../../schema/shared';
import type { TableData, TableOptions } from '../../types/table';
import { heatOptionsWithoutEffect } from './encodings/heatOptions';
import { baseOptionsSchema } from '../../schema/shared';
import { BADGE_SECTION_ONLY, BADGE_TEXT_EMPTY, STATUS_VALUES } from './rules';
export { STATUS_VALUES } from './rules';

const idSchema = z.string().min(1).describe('Nonempty reference id.');

const calcRefSchema = z
  .union([
    idSchema.describe('Column id in this row.'),
    z
      .strictObject({
        row: idSchema.describe('Row id.'),
        col: idSchema.optional().describe('Column id. Omitted means the column being evaluated.'),
        previous: z
          .literal(true)
          .optional()
          .describe('Prior member in this group. The first member is n/a.'),
      })
      .refine((value) => value.col === undefined || value.previous === undefined, {
        message: 'cell ref cannot set col and previous together',
      })
      .describe(
        'Cross-row cell. { row } uses the current column; { row, previous: true } uses the prior period in the same columnGroup.',
      ),
  ])
  .describe('Column id on the current row, or a cross-row cell address.');

// ---------- calc AST ----------

const calcSchema: z.ZodType = z.lazy(() =>
  z.union([
    z
      .strictObject({ ref: calcRefSchema.describe('Cell ref: column id or { row, col?, previous? }.') })
      .describe('Reference to a numeric cell.'),
    z.strictObject({ lit: z.number().describe('Constant in source units.') }).describe('Numeric literal, e.g. {lit: 100} for a percent bridge.'),
    z.strictObject({
      op: z.enum(['add', 'sub', 'mul', 'div']).describe('Arithmetic on a and b.'),
      a: calcSchema,
      b: calcSchema,
    }).describe('Binary arithmetic calculation.'),
    z.strictObject({ op: z.literal('abs').describe('Absolute value.'), of: calcSchema }).describe('Absolute-value calculation.'),
    z
      .strictObject({ op: z.literal('delta').describe('a minus b.'), a: calcRefSchema.describe('Current cell.'), b: calcRefSchema.describe('Reference cell.') })
      .describe('a − b.'),
    z
      .strictObject({ op: z.literal('percentDelta').describe('100*(a-b)/b relative change; n.m. when b is zero or negative, n/a when a and b are both zero.'), a: calcRefSchema.describe('Current cell.'), b: calcRefSchema.describe('Reference cell.') })
      .describe(
        '100·(a−b)/b in percent: 6.2 renders "6.2%". b<0, or b=0 with a≠0 → "n.m."; 0/0 → "n/a". Never a silent 0.',
      ),
    z
      .strictObject({ op: z.literal('share').describe('Share of column leaf total.'), of: calcRefSchema.describe('Share denominator cell.') })
      .describe(
        "Row's share of the column's leaf total, in points; leaf shares reconcile to exactly 100.0.",
      ),
  ]).describe('One expression in the typed calculation tree.'),
).describe('Cell or expression.');

// ---------- columns ----------

const FORMAT_DOC =
  "Number format example. Examples: '€1.2m', '1,234', '+1.2%', '1.2pp', '$1.2bn', '(1.0)'. " + MAGNITUDE_WORDS_DOC + " A table holds an authored magnitude: under '$1.2k', 2,496,000 prints as 2,496.0 thousand, not as $2.5M. Percent values are authored in POINTS: 6.2 with format '1.2%' renders '6.2%'. A difference of two percent levels uses 'pp', not '%'. A separator followed by exactly three digits after a nonzero integer part is a thousands mark: '1.000' groups thousands with a dot and prints decimals with a comma; write '0.000' for three decimals.";

/** A value or computed column's format, with where its unit prints. */
const COLUMN_FORMAT_DOC = FORMAT_DOC + " The format's unit, $M for '$1.2m', prints once beside subtitle.measure when every value column shares it; without a measure, or with mixed units, each value head carries it, as 'Q1 ($M)'. unitShown true drops it from the heads too.";

const columnBase = {
  id: idSchema,
  label: z.string().optional().describe('Visible name; defaults to id.'),
  subLabel: z.string().min(1).optional()
    .describe('Second header line. At the micro step in muted ink: a weekday under a date, an ISO week under a week start. Primary labels keep one baseline.'),
  width: z.number().positive().optional()
    .describe("Width in px. React keeps it and scrolls. SVG narrows authored tracks only when the fixed frame needs it, with table-overflow and a wider-size fix. Value and computed tracks widen for figures, and a row-label track for its labels up to 180 px (table-column-widened). Other content may cut (table-column-clipped); remove width for automatic content sizing."),
  align: z.enum(['left', 'right', 'center']).optional()
    .describe('Cell alignment. Numeric left alignment is accepted but linted.'),
  emphasis: z.enum(['strong', 'muted']).optional()
    .describe("Header and cell emphasis. 'strong' sets the header and its cells to the emphasis weight (700 by default), 'muted' paints them in the muted ink. Paint only — column widths and row heights do not move."),
  band: z.boolean().optional()
    .describe('Column band ground. Neighbouring banded columns read as one block and the first of the run takes the left hairline, so a block inside a column group needs no group of its own. Paint only.'),
  fitFormat: z.literal(false).optional().describe('false: options.fitFormats leaves this column\'s format as authored.'),
  noteLine: z.boolean().optional()
    .describe("Notes below figures. They use the inline step in muted ink. Default false keeps the note inline after the figure, where a 90 px block track cuts it off; a steering block column says sum under its year-to-date figure. The note takes the first line slot whose change line holds no value in that cell, and where every line holds one, or the row prints none, the row grows by one inline line."),
};

const materialitySchema = z
  .strictObject({ pct: z.number().positive().optional().describe('Percent-column threshold in points.'), abs: z.number().positive().optional().describe('Other numeric threshold in source units.') })
  .refine((value) => value.pct !== undefined || value.abs !== undefined, {
    message: 'materiality requires pct and/or abs; values stay visible below the threshold',
  })
  .describe('Display de-emphasis threshold; the value stays visible and recorded.');

const columnSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ ...columnBase, kind: z.literal('rowLabel').describe('Kind.'), maxWidth: z.number().positive().optional().describe('Label width cap in px. Includes indent and affix; explicit width wins.'), maxTextWidth: z.number().positive().optional().describe('Caps how much the label text adds to the column width, in px. The indent, the unit affix and the collapsed hint come on top of it. It is not a hard cap: when the header or another row makes the column wider, labels use that room. Ignored when width is set; maxWidth still caps the whole track.') }),
    z.strictObject({
      ...columnBase,
      kind: z.literal('value').describe('Kind.'),
      format: formatExample.optional().describe(COLUMN_FORMAT_DOC),
      scenario: z.enum(['AC', 'PY', 'PL', 'FC']).optional()
        .describe('Header scenario.'),
      polarity: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe('Which sign is favorable. Judgment tones and directional encodings read it.'),
      materiality: materialitySchema.optional().describe('Mute tones below this threshold; keep values visible.'),
      aggregate: z.enum(['sum', 'none', 'source']).optional()
        .describe("Parent-row aggregation. Default 'sum' over additive children; 'none' where the column format is a percentage, percentage points or a multiple, or the summand rows carry different formats, since those do not add. An explicit 'sum' there warns aggregate-non-additive."),
      nulls: z.enum(['propagate', 'skip']).optional()
        .describe("Default 'propagate'. A missing child then makes the parent '—', with no silent partial sums; 'skip' sums the present values and auto-footnotes 'partial'."),
      percentScale: z.literal('points').optional().describe("Values already in points; percent-scale-suspect stays quiet."),
    }),
    z.strictObject({
      ...columnBase,
      kind: z.literal('computed').describe('Kind.'),
      calc: calcSchema,
      format: formatExample.optional().describe(COLUMN_FORMAT_DOC),
      polarity: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe('Which sign is favorable. Judgment tones and directional encodings read it.'),
      materiality: materialitySchema.optional().describe('Mute tones below this threshold; keep values visible.'),
    }),
    z.strictObject({
      ...columnBase,
      kind: z.literal('text').describe('Kind.'),
      wrap: z.boolean().optional()
        .describe('Wrap prose and grow its row; do not widen the table. A line break (\\n) in a cell starts a new line. Use it for the note column of a scorecard.'),
    }),
    z.strictObject({
      ...columnBase,
      kind: z.literal('status').describe(`Status cell: ${STATUS_VALUES.join(' | ')} or { v: key } (other text refuses: status-value-invalid; numbers draw the missing dash and warn: status-value-number; a later release refuses numbers). Each key has a fixed tone. For free status text, use a text column with a cell tone.`),
      labels: z.partialRecord(z.enum(STATUS_VALUES), z.string().min(1)).optional()
        .describe("Display text per status key, e.g. { pending: 'Learning' }. The key keeps its tone; an unlisted key prints as itself."),
      mark: z.enum(['chip', 'square']).optional()
        .describe("How a status prints. 'chip' (default): a tone wash behind tone-mixed text. 'square': a small tone square before ink text, with no wash."),
    }),
    z.strictObject({
      ...columnBase,
      kind: z.literal('date').describe('Kind.'),
      format: z.string().optional()
        .describe("Date format example. Examples: '30 Sep 2026', 'Sep-26', '2026-09-30'."),
    }),
    z.strictObject({
      ...columnBase,
      kind: z.literal('encoding').describe('Kind.'),
      encoding: z.strictObject({
        type: z.literal('sparkline')
          .describe('Per-row mini line or column over sourceColumns; null values leave gaps in source order.'),
        kind: z.enum(['line', 'column']).optional()
          .describe("Shape. Default 'line'. 'column' is zero-anchored. One y-domain is shared across visible rows of this column."),
        sourceColumns: z.array(idSchema).min(2)
          .describe('Ordered numeric source columns; they remain visible. The last observed source value is labelled from that cell\'s formatted text. Without a column width the track is 88 px or wider, so that label prints whole; a width fixes the track and cuts a longer label.'),
      }).describe('Sparkline over other columns; no own cell values.'),
    }),
  ])
  .describe('Column kinds: rowLabel (exactly one) · value · computed · text · status · date · encoding.');

// ---------- cells & rows ----------


/** Cell bands: the shared schema checks them (non-empty, ascending); these item notes are short because discovery lists every row. */
const cellBandsSchema = z
  .array(z.strictObject({
    tone: z.enum(['good', 'warn', 'bad', 'neutral']).optional().describe('Tone.'),
    to: boundedNumber.describe('Upper bound.'),
    label: z.string().trim().min(1).optional().describe('Name.'),
  }))
  .superRefine((bands, ctx) => {
    const checked = valueBandsSchema.safeParse(bands);
    if (!checked.success) for (const issue of checked.error.issues) ctx.addIssue(issue as never);
  });

const cellObjectSchema = z
  .strictObject({
    v: z.union([z.number().describe('Numeric source value, before display formatting.'), z.string().describe('Text, status or ISO date source value, interpreted by the column kind.'), z.null().describe('Missing value, distinct from zero.')]).optional().describe('Value before formatting. null means missing, as for a scalar null cell.'),
    note: z.string().optional().describe("Inline annotation, e.g. '(−51%)'."),
    strong: z.literal(true).optional().describe('Strong good. Kept under exceptions.'),
    tone: z.enum(['good', 'bad', 'warn', 'neutral']).optional().describe('Cell judgment tone.'),
    bands: cellBandsSchema.optional().describe("Value bands. Each band has an upper bound `to` (cell units before formatting, ascending), a `tone` (default neutral) and a `label`. The cell takes the first band whose `to` is at or above its value: below the first bound it takes the first band, above the last it takes the last. Precedence: cell `tone`, then bands, then sign judgement. Missing, n/a, n.m., suppressed and open cells are not judged; text cells ignore bands. The label shows on hover and in the accessible table."),
    href: z.string().optional().describe('HTML renderer emits a link; SVG renders text.'),
    state: z.enum(['na', 'nm', 'suppressed', 'open']).optional()
      .describe("Explicit non-value state; 'na' → n/a · 'nm' → n.m. · 'suppressed' → — with footnote · 'open' → a period still to come, empty on the band ground. Distinct from null (missing → '—')."),
    missing: z.enum(['blank', 'dash']).optional().describe('Override the missing glyph for this cell. blank leaves no glyph; dash uses the theme missing glyph.'),
    heat: z.literal(false).optional().describe('Keeps the cell out of its heat lane. false draws it unshaded in the muted ink and leaves it out of the range (a calendar M0 diagonal).'),
    format: formatExample.optional().describe(FORMAT_DOC + " On a cell: a value cell prints through its own format, ahead of its row's and its column's. A YoY column in '+1.2%' prints the change of a share KPI in points with '+1.2pp' on that one cell. The text, the hover card, the accessible table and the width fitting all use it."),
  })
  .describe('Composite cell: value plus note/tone/href/state/format.');

const cellSchema = z.union([z.number().describe('Numeric cell in source units.'), z.string().describe('Text, status or ISO date cell, according to column kind.'), z.null().describe('Missing cell, distinct from zero and explicit non-value states.'), cellObjectSchema]).describe('Scalar cell, missing value or annotated cell object.');

const rowSchema: z.ZodType = z.lazy(() =>
  z.strictObject({
    id: idSchema,
    label: z.string().optional().describe('Visible name; defaults to id.'),
    parentId: idSchema.optional().describe('Flat canonical hierarchy. Alternative: nested `children` sugar.'),
    kind: z.enum(['section', 'member', 'measure', 'detail', 'split', 'subtotal', 'result', 'driver']).optional().describe('Presentation kind. subtotal: children add up to it; result: a calc of rows above, never added; driver: explains a line, never added.'),
    sign: z.literal(-1).optional().describe('Subtracts from its parent.'),
    operator: z.enum(['+', '−', '×', '÷', '=']).optional().describe('Operator glyph.'),
    final: z.literal(true).optional().describe('Closing rule under a result.'),
    rung: z.number().int().nonnegative().optional().describe('Presentation rung. Section and split rows do not add depth.'),
    role: z.enum(['data', 'total', 'section']).optional().describe('Data, total or section row.'),
    relation: z.enum(['additive', 'ofWhich', 'displayOnly']).optional()
      .describe("Which rows a parent sums. 'ofWhich' and 'displayOnly' are EXCLUDED from parent aggregation — display hierarchy is not the accounting model."),
    totalPolicy: z.enum(['derive', 'validate', 'source']).optional()
      .describe("derive: computed from children (authored value linted). validate (default when a value is authored): authored value displays, difference vs the computed sum is reported — verify ≠ overwrite. source: trusted, no comparison."),
    calc: calcSchema.optional()
      .describe('Calculation per numeric column. Same algebra as computed columns. Requires relation ofWhich or displayOnly. Cross-row refs { row } and { row, previous: true } are for this field.'),
    format: formatExample.optional().describe(FORMAT_DOC + " On a row: a calc row (and an inline row) prints its result through it everywhere, so a MoM subrow prints +1.2% in a money column; a data row prints its cells through it on every column that names no format of its own, so KPI rows carry their own units across month columns."),
    polarity: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe('Row judgment direction. It overrides the column polarity in every column that judges a change, and judges every cell of a calc or inline row; a level column without a polarity stays uncoloured. A table that colours both directions prints a note naming the rows that read the other way.'),
    inline: z.literal(true).optional()
      .describe("Line below the parent value. Its row label stays on that baseline; it has no row of its own. Requires relation 'displayOnly'. Its values carry data-id cellline:<parentRow>:<column>:<line> (not cell:<row>:<column>). Scene-ID components escape % as %25 and : as %3A. Authored IDs stay unchanged."),
    inlineGroup: idSchema.optional()
      .describe('Which switch hides this line. Rows that share a group hide together; the default is the row id.'),
    scale: z.enum(['money','perUnit','count','percent']).optional().describe('Row precision. The max absolute value uses only cells without a cell or column format. Money: 1 decimal in k at max >= 1000, else whole units; it climbs k, M, B by its largest value unless options.magnitude is thousand or million, which a money row follows (whole thousands from 100,000 up). Per unit: fractional values keep authored precision. Without a format, start whole at max >= 10, else 1 decimal, then raise precision for rounding error above 1%, up to 20 decimals. Integer-only rows keep those defaults. It overrides table magnitude. Currency goes in unitAffix. Scaled money and automatic count rows add decimals for rounding error above 1%, up to 20; held whole thousands stay whole. Nonzero stays nonzero. Count/percent keep format.'),
    fitFormat: z.literal(false).optional().describe('false: options.fitFormats leaves this row\'s format as authored.'),
    unitAffix: z.string().min(1).optional()
      .describe("Unit beside the row label. Muted ink on the same line: $M, # orders. It takes no second line, so the change lines under the label stay level with the ones under the values. A forced options.magnitude overrides it with the scale letter it hoists out of this row's cells."),
    missing: z.enum(['blank', 'dash']).optional()
      .describe("Row gap glyph. 'blank' leaves a MISSING cell of this row empty, 'dash' prints the em dash; omitted, the row takes options.nulls. Set it on a change line with no value in a block column, so that slot stays empty while the real gaps keep their dash. The explicit states na, nm and suppressed keep their glyphs."),
    spacer: z.number().nonnegative().optional().describe('Gap before the row in px; the first drawn row takes none.'),
    foldable: z.literal(false).optional()
      .describe('Never folds. No toggle or mark; its children always show.'),
    badge: z.strictObject({
      text: z.string().trim().min(1, BADGE_TEXT_EMPTY).describe('Text.'),
      tone: z.enum(['good', 'warn', 'bad', 'neutral']).optional().describe('Default neutral.'),
    }).optional().describe('Section chip. Refused on other rows.'),
    cells: z.record(idSchema.describe('Column id for this cell.'), cellSchema).optional().describe('Cells by column id; computed columns and calc rows use their calculation.'),

    children: z.array(rowSchema).optional().describe('Child rows; normalized to parentId.'),
  }).describe('One authored table row and optional descendants.')
    .refine((row) => row.inline !== true || row.relation === 'displayOnly' || row.kind === 'result' || row.kind === 'driver', {
      message: "inline requires relation 'displayOnly': a line printed inside its parent's cell must never be summed into it",
      path: ['inline'],
    })
    .superRefine((row, ctx) => {
      const displayOnly = row.kind === 'result' || row.kind === 'driver';
      if (displayOnly && row.relation !== undefined && row.relation !== 'displayOnly') ctx.addIssue({ code: 'custom', path: ['relation'], message: row.kind === 'result' ? 'a result is computed from rows above; adding it to a parent counts it twice' : 'a driver explains a row; adding it to a parent counts a different measure', params: { refused: true } });
      if (row.sign !== undefined && (displayOnly || (row.relation ?? 'additive') !== 'additive')) ctx.addIssue({ code: 'custom', path: ['sign'], message: 'sign requires relation additive', params: { refused: true } });
      if (row.final !== undefined && row.kind !== 'result') ctx.addIssue({ code: 'custom', path: ['final'], message: 'final requires kind result', params: { refused: true } });
      if (row.badge !== undefined && row.role !== 'section') ctx.addIssue({ code: 'custom', path: ['badge'], message: BADGE_SECTION_ONLY, params: { refused: true } });
    }),
).describe('Recursive table row.');

const baseTableDataSchema = z
  .strictObject({
    columnGroups: z
      .array(z.strictObject({ id: idSchema.describe('Column-group id.'), label: z.string().describe('Group heading.'), columns: z.array(idSchema.describe('Member column id.')).min(1).describe('Contiguous member columns.'), band: z.boolean().optional().describe('Give this group a banded ground, the way the full-year block of a management report is set off from the months beside it.'), note: z.string().min(1).optional().describe('Heading qualifier after \u00b7. Lowercase and untracked: the period the block covers, such as Jul 1-15 or full month.'), spacer: z.number().nonnegative().optional().describe('Empty px track before the group. The metric blocks of a cohort grid stand 16 px apart. It draws no cell, takes no hover, and replaces the divider hairline this group would otherwise open with.'), heading: z.boolean().optional().describe('Draw it. Default true; false keeps the membership (hover series, previous: true calcs), the label as the hover noun, the band, the spacer and the divider, and draws no heading. Where no group draws one, the head loses its group row.'), hoverSeries: z.enum(['shown', 'all']).optional().describe("Hover series. 'shown' (default) draws the group's members on screen in the sparkline hover card; 'all' draws every member in columns[] order, those a column toggle hides included, so a block can show history it does not draw. A hidden member stays out of everything else the table draws, measures and counts.") }).describe('One header group over contiguous member columns.'))
      .optional()
      .describe('Two-row headers. Members must exist, belong to at most one group, and be contiguous in columns[] order.'),
    columnToggles: z
      .array(
        z.strictObject({
          id: idSchema,
          label: z.string().min(1).describe('Column-toggle label.'),
          columns: z.array(idSchema.describe('Column id controlled by this toggle.')).min(1).describe('Columns toggled within one header group.'),
          defaultVisible: z.boolean().optional()
            .describe('Visible before options.columnVisibility; defaults false.'),
        }).describe('One control showing or hiding a group of columns.'),
      )
      .optional()
      .describe('Column toggle groups. Every member must exist, belong to one toggle, and stay inside one columnGroup.'),
    columns: z.array(columnSchema).min(1).describe('Display order; exactly one rowLabel column.'),
    rows: z.array(rowSchema).min(1).describe('Row hierarchy; totalPosition determines resolved display order.'),
    levelNouns: z
      .array(
        z.strictObject({
          one: z.string().min(1).describe('Singular noun, e.g. "market".'),
          other: z.string().min(1).describe('Plural noun, e.g. "markets".'),
        }).describe('Singular and plural noun for the children of one level.'),
      )
      .optional()
      .describe('Child nouns by level. Indexed by the level they name: levelNouns[1] names level-1 children. A collapsed parent appends "· 4 markets" only where the noun is authored — nothing is invented.'),
  })
  .superRefine((data, ctx) => {
    const columnIds = new Set(data.columns.map((column) => column.id));
    const groupByColumn = new Map<string, string>();
    for (const group of data.columnGroups ?? []) {
      for (const columnId of group.columns) groupByColumn.set(columnId, group.id);
    }
    const toggleIds = new Set<string>();
    const claimed = new Map<string, string>();
    for (const [toggleIndex, toggle] of (data.columnToggles ?? []).entries()) {
      if (toggleIds.has(toggle.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['columnToggles', toggleIndex, 'id'],
          message: `duplicate-toggle-id: toggle id '${toggle.id}' appears more than once`,
        });
      }
      toggleIds.add(toggle.id);
      let referencesValid = true;
      for (const [columnIndex, columnId] of toggle.columns.entries()) {
        if (!columnIds.has(columnId)) {
          referencesValid = false;
          ctx.addIssue({
            code: 'custom',
            path: ['columnToggles', toggleIndex, 'columns', columnIndex],
            message: `toggle-ref-invalid: toggle '${toggle.id}' references unknown column '${columnId}'`,
          });
          continue;
        }
        const owner = claimed.get(columnId);
        if (owner !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['columnToggles', toggleIndex, 'columns', columnIndex],
            message: `toggle-ref-invalid: column '${columnId}' already belongs to toggle '${owner}'`,
          });
        } else {
          claimed.set(columnId, toggle.id);
        }
      }
      if (referencesValid) {
        // One toggle, one header group — or no group at all. A
        // toggle whose columns carry no group is a control over a plain run
        // of columns, which is what a board with a single head row asks
        // for; a toggle that straddles two groups, or one group and the
        // columns outside it, would move a heading's span under the reader.
        const groupIds = new Set(toggle.columns.map((columnId) => groupByColumn.get(columnId)));
        if (groupIds.size !== 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['columnToggles', toggleIndex, 'columns'],
            message: `toggle-group-span: every member of toggle '${toggle.id}' must belong to one columnGroup, or none of them to any`,
          });
        }
      }
    }
  })
  .describe(
    'Consulting-grade table. Percent values in POINTS (6.2 = 6.2%). null cell = missing → "—"; explicit states: na/nm/suppressed. ' + FORMAT_DOC,
  ) as unknown as z.ZodType<TableData>;

export const tableOptionsObject = baseOptionsSchema.safeExtend(refusedBaseOptions('table')).safeExtend({
  mountCollapsed: z.boolean().optional().describe('Default true. false removes closed descendants from the React DOM and defers offscreen leaf paint.'),
  signs: z.enum(['signed', 'operators', 'plain']).optional().describe('How sign -1 rows print. signed (default) negates them; operators draws + − × =; plain draws neither.'),
  driverTones: z.enum(['grouped', 'always', 'never']).optional().describe("Driver tones. 'grouped' (default): drivers with a parentId whose parent is not a section heading do, as statement lines do. 'always': every driver. 'never': driver ink only, as before 0.28. Neutral figures and labels keep the driver ink."),
  judgements: z.enum(['all', 'exceptions']).optional().describe('Which tones show. exceptions: strong good and bad only.'),
  variant: z.enum(['steering', 'benchmark', 'status', 'receipts', 'hierarchy']).optional()
    .describe("Variant defaults only; no variant changes what a cell accepts. Default 'hierarchy'. 'steering': total on top, no group band. 'benchmark': strong row labels, no group band. 'status': square status chips. 'receipts': dates align right. A status cell, in any variant, takes a status-column key; for free status text use a text column with a cell tone."),
  encodings: z.record(
    idSchema,
    z.union([
      z.literal('polarityBadge')
        .describe('Tinted polarity badge behind a signed value.'),
      z.literal('heat')
        .describe('Cell tint that keeps the formatted value visible; the bare name means cap at the largest magnitude in the column, alpha 0.18, totals untinted.'),
      z.literal('inCellBar')
        .describe('Horizontal magnitude bar behind a right-aligned value, with reserved text space.'),
      z.literal('arrow')
        .describe("Direction glyph before a computed value with polarity. On a percent column the change itself is cut: a rise over 10 is a strong arrow, over 2 a weak one. Elsewhere the cut is the change's share of the column's largest change. The key says which rule applies."),
      z.strictObject({
        type: z.literal('arrow').describe('Select the arrow lane.'),
        scale: z.enum(['absolute', 'relative']).optional().describe("'absolute' cuts the change itself at 10 and 2 (points on a percent column); 'relative' cuts its share of the column's largest change at 10% and 2%. Default 'absolute' on a percent column, 'relative' elsewhere."),
      }).describe('Arrow lane with an authored cut.'),
      z.strictObject({
        type: z.literal('heat').describe('Select the heat lane.'),
        cap: z.strictObject({
          pct: z.number().positive().optional().describe('Percent-column tint cap in points. Example: 20 for a ±20% YoY lane.'),
          abs: z.number().positive().optional().describe('Other numeric tint cap in source units.'),
        }).optional().describe('Where the lane saturates; without it the largest magnitude in the column does, on both sides of zero. One lane per table, on a variance column.'),
        alpha: z.number().min(0).max(1).optional().describe("Tint weight at the cap; default 0.18, and 0.26 on scale 'status', where every painted cell takes it. Text stays readable up to 0.18 on every shipped theme and up to 0.35 on a status ground; above that the figures take the contrast ink."),
        excludeTotals: z.boolean().optional().describe('Leave total rows untinted; default true. Heat reads a variance, and a total has none worth colouring.'),
        steps: z.number().int().min(2).max(9).optional().describe('Band count. 5 gives the cohort ladder: 6 / 14 / 26 / 42 % of the ink over the background, then the full ink with inverse text, from the theme token surface.heatSteps. A stepped lane measures the data rows only, so a closing row does not set the scale.'),
        scale: z.enum(['column', 'absolute', 'diverging', 'status']).optional().describe("Where a band comes from. 'column' (default) normalises over this column's own min and max; with two or more such columns the table adds the note that shading compares values within each column. 'absolute' cuts at bins, so every column of a grid reads on one scale. 'diverging' measures the distance from the column average and paints good above and bad below; under polarity 'lowerIsBetter' the sides swap. 'status' is a traffic light against the same centre: a value within tolerance of it paints warn, farther above good and farther below bad, the other way round on a column with polarity lowerIsBetter; it reads no steps, bins, span or cap."),
        bins: z.array(z.number()).min(1).optional().describe("Ascending band edges. On scale 'absolute' a value takes the band of the last edge it reaches (e.g. [30, 40, 50, 60] gives five bands); on 'diverging' they are the |distance| edges, default [1, 4]. Given without steps, they set the band count themselves."),
        span: z.number().positive().optional().describe("Spread that fills a column ramp. Measured in column units; a smaller spread takes bands from the lightest up, so a spread of 1 point is not painted like one of 30. Omitted, every column's own min and max fill the ramp."),
        center: z.literal('total').optional().describe("Centre: column total. On scales 'diverging' and 'status' a reader can check every band against that printed figure. Omitted, or in a column without a total row value, the centre is the average of the column's data rows."),
        tolerance: z.strictObject({
          pct: z.number().nonnegative().optional().describe('Percent of the centre. 5 reads 62 to 68 as warn around 65.'),
          abs: z.number().nonnegative().optional().describe('Column units. 2 reads 63 to 67 as warn around 65.'),
        }).optional().describe("Warn band of scale 'status'. A value at most this far from the centre paints warn, the boundary included; default { pct: 5 }. Give exactly one of pct and abs."),
        columns: z.array(idSchema).optional().describe('Further columns this rule paints. A sixty-column cohort grid names its lane once instead of sixty times, and a column that carries its own entry keeps it. Leave a column out to keep it unshaded.'),
      }).superRefine((encoding, ctx) => {
        // An option the scale does not read is refused.
        for (const { key, message } of heatOptionsWithoutEffect(encoding)) ctx.addIssue({ code: 'custom', path: [key], message, params: { refused: true } });
      }).describe('Heat lane with an authored cap, alpha, totals rule, band ramp and scale.'),
    ]).describe('Visual encoding applied to this column.'),
  ).optional()
    .describe('Per-column opt-in visual encodings.'),
  totalPosition: z.enum(['top', 'bottom']).optional()
    .describe('Total-row position; variant supplies the default.'),
  density: z.enum(['compact', 'regular', 'relaxed', 'cohort', 'cohort-small']).optional().describe("Cell spacing. Before a size refusal, the static table retries with compact spacing, tight margins and automatic height unless belowMinimum is 'refuse'. Where a fixed width or height still misses, cell air, column gaps and margins shrink to 2 px air and 4 px gaps, and row air to 1 px where the height misses; a 'table-tight-spacing' warning names the size for compact spacing. 'cohort' and 'cohort-small' are the fixed matrix grids of a cohort table: rows of 26 px (20 px) whatever the level, cells one (two) steps under the label, heads on the axis step, and value columns centred unless the column names its own alignment."),
  nulls: z.enum(['blank', 'dash']).optional().describe("What a MISSING cell prints. 'dash' (the default) keeps the em dash; 'blank' leaves it empty, which is what a cohort staircase needs — a cohort acquired in May has not been observed at M8, and a triangle of dashes is noise. The explicit states na, nm and suppressed keep their glyphs."),
  figures: z.boolean().optional().describe('Print the cell figures; default true. false draws the heat grounds alone in 22 px cells, over any width authored for the figures, on 14 px rows or the line box of the text a row still prints where that is taller, so a sixty-column triangle fits one screen. The heads keep their labels and the numbers stay in the markup for a reader who cannot see the grounds. Refused on a table without a heat lane in encodings.'),
  expansion: z
    .strictObject({
      depth: z.union([z.number().int().nonnegative().describe('Expand parents at levels below this depth.'), z.literal('all').describe('Expand every parent row.'), z.literal('totals').describe('The totals step: every parent folds and the level-0 data rows hide, so the totals and the section headings show. A table without a total row keeps its level-0 rows, folded, under open section headings.')]).optional()
        .describe("Parents at levels below depth start expanded; 'all' or omission expands every parent; 'totals' shows the totals alone."),
      collapsed: z.array(idSchema).optional()
        .describe('Row-id overrides applied after depth.'),
      expanded: z.array(idSchema).optional()
        .describe('Row-id overrides applied last; they win over collapsed.'),
      rootsHidden: z.boolean().optional()
        .describe('Hide level-0 data rows and subtrees. The totals and the section headings stay: this is the totals-only step of a depth control, which collapsing a parent cannot reach, because a collapsed parent still draws its own row.'),
    })
    .optional().describe('Expansion order: depth, collapsed, expanded.'),
  columnVisibility: z.record(idSchema.describe('Column-toggle group id.'), z.boolean().describe('True shows the group; false hides it.')).optional()
    .describe('Visibility by column-toggle id.'),
  inlineVisibility: z.record(idSchema.describe('Inline-line group id.'), z.boolean().describe('True shows the lines of that group; false hides them.')).optional()
    .describe("Visibility by inlineGroup. An absent group is visible, so a Changes control hides every MoM line of a table with one entry."),
  magnitude: z.enum(['auto', 'thousand', 'million']).optional()
    .describe("Money scale for all rows and columns. 'thousand' prints whole thousands, 'million' keeps the example's decimals, and no column rolls up on its own. The scale letter leaves the cells and hoists to the frame, the column header or, where the format sits on the row, the row label. 'auto' (the default) lets each column and money row pick from its own largest value."),
  foldOn: z.enum(['row', 'toggle']).optional()
    .describe("React only. What folds a parent row. 'row': a click on the row folds it, and selects it too where the host made it selectable. 'toggle': only the fold mark folds; a row click only selects. Default: 'toggle' for a selectable row, else 'row'. Enter and Space follow the click."),
  groupGround: z.enum(['expanded', 'always', 'none']).optional()
    .describe("Group row ground. 'expanded' (default): only an open group's header row. 'always': folded or open, as before 0.28. 'none': no group ground. The Total keeps its ground. Absent: theme table.groupGround."),
  anchorWash: z.boolean().optional()
    .describe('Wash expanded level-0 anchors; no control.'),
  stickyLabels: z.union([
    z.boolean(),
    z.number().int().min(1),
    z.strictObject({
      head: z.union([z.enum(['table', 'page']), z.literal(false)]).optional()
        .describe("Head pin mode. 'table' (default): in the table's own scroll box, which the host sizes. 'page': to the page scroll at `top` px; the body has no vertical scroll box, and no overflow ancestor may sit above the table. false: no pinned head."),
      columns: z.number().int().min(0).optional()
        .describe('Columns. Default 1.'),
      top: z.number().min(0).optional()
        .describe("Offset in px. Clears a host toolbar. Default 0; above 0 needs head: 'page'."),
      sections: z.boolean().optional()
        .describe('Section label. Default false. true keeps the active section label under the head until the next section starts.'),
    }).refine((value) => (value.top ?? 0) === 0 || value.head === 'page', {
      message: "stickyLabels.top needs head: 'page'",
      path: ['top'],
    }),
  ]).optional()
    .describe("Pin header and columns. React only; static output shows the whole table. true pins one column, a number pins that many (2 for a cohort grid), and the last carries a hairline shadow. The object form sets head, columns, top and sections. Page mode is refused with React fillHeight. Off in print."),
  frameFill: z.enum(['values', 'none']).optional()
    .meta({ default: 'values' })
    .describe("Under rowExtent 'frame'. 'values' (default): automatic value tracks grow in whole pixels, up to maxGrowth (default 2.5). An unauthored label track takes the rest. 'none': columns keep their widths; an empty track carries the row ground and rules to the edge."),
  rowLabelLines: z.union([z.literal(1), z.literal(2)]).optional()
    .meta({ default: 2 })
    .describe("Lines a row label may take before it is cut with an ellipsis (default 2). A label breaks at a space or after _ - / or a dot, so a long campaign name wraps instead of ending in '…'. 1 keeps every label on one line. The hover card always prints the full name."),
  lastTrackFlex: z.boolean().optional()
    .describe('Extend the last track to the frame edge only when it has no authored width and rowExtent is tracks. Default false.'),
  rowExtent: z.enum(['tracks', 'frame']).optional()
    .meta({ default: 'frame' })
    .describe("Where rows end. 'frame' (default) fills the width inside the frame margins. An explicit 'frame' also carries row grounds and rules through authored side margins. frameFill controls track growth. 'tracks' stops rows at the last column. Column bands stop at their columns. Tables use horizontal rules and explicit column separators; there is no single vertical end rule."),
  sortIndicator: z.enum(['all', 'sorted']).optional()
    .describe("Which sortable headers draw a chevron. 'all' (the default) draws one on every sortable header; 'sorted' draws it on the sorted one alone and keeps the others' reserve, so no track moves."),
  levelOffset: z.number().int().min(-4).max(4).optional()
    .describe('Shift non-total rows down the level ladder. Default 0. A board whose top rows are groups rather than KPI lines reads one rung too heavy: 1 steps them down in size, weight, air, ground, indent and label ink, -1 steps them up. The rungs stay floored at the top and at the deepest step.'),
  cellPadX: z.number().min(0).max(24).optional()
    .describe('Horizontal cell padding in px. Default 12; only when it cannot fit, use 5 for 20–24 columns or 3 for 25 or more.'),
  groupRule: z.enum(['label', 'span']).optional()
    .meta({ default: 'span' })
    .describe("Heading rule. 'span' (default) rules every column of the group, so it shows which columns the heading covers; 'label' underlines the heading text alone."),
  groupAlign: z.enum(['left', 'center', 'right']).optional()
    .meta({ default: 'center' })
    .describe("Heading position. 'center' (default) centres the heading over its columns; in the React grid a group wider than the visible scroll area starts its heading at the first column, and the heading stays in view while the group scrolls. 'left' always starts it at the first column, 'right' ends it at the last. A heading wider than its columns starts at the first column."),
  fitFormats: z.boolean().optional()
    .describe('Fit figures to authored widths. Remove decimals, then use the next unit up.'),
  maxGrowth: z.union([z.number().min(1), z.literal(false)]).optional()
    .meta({ default: 2.5 })
    .describe('Value-track growth cap; default 2.5, false removes the cap. Applies to SVG and React frame fill; the label track takes the remaining width. Also caps React container fit growth.'),
  labelIndent: z.strictObject({ base: z.number().min(0).max(120).describe('Level-0 start from row edge, padding included.'), step: z.number().min(0).max(48).optional().describe('px per rung; default 16.') }).optional()
    .describe('Tree indent from row edge. Absent: cell air without marks; cell air plus 24 with outlineMarks: true or interactive fold buttons. Then 16 per rung.'),
  outlineMarks: z.boolean().optional()
    .meta({ default: false })
    .describe('Fold marks beside parent rows. Drawn in static SVG/PNG and read-only grids. Default false: no marks or gutter. true draws the marks and reserves their gutter. Interactive grids keep their fold buttons either way.'),
})
  // figures: false takes the figures off the heat cells and shrinks every row
  // to the heat pitch, so a table without a heat lane printed its numbers
  // into 14 px rows. A column is heat where resolveCellEncoding makes it so:
  // the bare 'heat' or the object form, which is always a heat lane.
  .superRefine((options, ctx) => {
    if (options.figures !== false) return;
    if (Object.values(options.encodings ?? {}).some((entry) => entry === 'heat' || typeof entry === 'object')) return;
    ctx.addIssue({
      code: 'custom',
      path: ['figures'],
      message: "figures: false needs a heat column: give a column a heat lane in encodings, or drop 'figures'",
    });
  }).describe('Table framing, presentation, encodings, hierarchy visibility, sibling sort and top-N. sort.categories reorders data rows within each parent; sort.segments is refused. topN nests the remaining siblings under Others and reuses resolve and claims.') ;
export const tableOptionsSchema = tableOptionsObject as unknown as z.ZodType<TableOptions>;

export const tableDataSchema = baseTableDataSchema.superRefine((data, ctx) => {
  addDuplicateIdIssues(ctx, data.columnGroups ?? [], ['columnGroups'], {
    name: 'column group',
    keys: 'group membership and header scene identities',
  });
  addDuplicateIdIssues(ctx, data.columnToggles ?? [], ['columnToggles'], {
    name: 'column toggle',
    keys: 'column visibility and control identities',
  });
  addDuplicateIdIssues(ctx, data.columns, ['columns'], {
    name: 'column',
    keys: 'cells, calculations and scene identities',
  });

  const rows: { id: string; issuePath: PropertyKey[] }[] = [];
  const walk = (entries: TableData['rows'], prefix: PropertyKey[]): void => {
    entries.forEach((row, index) => {
      const issuePath = [...prefix, index, 'id'];
      rows.push({ id: row.id, issuePath });
      if (row.children) walk(row.children, [...prefix, index, 'children']);
    });
  };
  walk(data.rows, ['rows']);
  addDuplicateIdIssues(ctx, rows, [], {
    name: 'row',
    keys: 'hierarchy, cells and scene identities',
  });
});
