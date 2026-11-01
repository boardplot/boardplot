/**
 * Worked recipes on the reference pages: a heading, the prose, an optional
 * full spec and an optional tsx block each, printed after the annotation
 * table. A fence without a language in the prose is not run. check-manual
 * renders every spec and tsx block of docs/reference/dimswitch.md, and
 * tests/chart-sizing.test.ts renders the table recipe.
 */
const QUARTERS = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'];

/**
 * The dimswitch worked example: invented daily sums of four leaf channels from
 * Friday 21 Aug to Wednesday 7 Oct 2026 (day 0 is 21 Aug), summed into windows
 * as a host does, so every sum, ref and total is consistent.
 */
const DIMSWITCH_LEAVES = {
  brand: { orders: 62, nc: 0.34, aov: 81, spend: 820 },
  generic: { orders: 48, nc: 0.52, aov: 74, spend: 1480 },
  social: { orders: 33, nc: 0.61, aov: 69, spend: 1150 },
  email: { orders: 41, nc: 0.08, aov: 88 },
};
const DIMSWITCH_WEEKDAY = [0.9, 1.12, 1.06, 1, 0.97, 0.94, 0.86]; // Sunday first, as getUTCDay counts.
function dimswitchDay(leaf, day) {
  const base = DIMSWITCH_LEAVES[leaf];
  const weekday = DIMSWITCH_WEEKDAY[new Date(Date.UTC(2026, 7, 21 + day)).getUTCDay()];
  const push = leaf === 'generic' && day >= 30 ? 1 + 0.03 * (day - 30) : 1; // Generic search spend rises from 20 Sep.
  const grow = leaf === 'social' ? 1 + 0.008 * day : 1;
  const orders = Math.round(base.orders * weekday * grow * (1 + (push - 1) * 0.25));
  return {
    orders, nc: Math.round(orders * base.nc), rev: Math.round(orders * base.aov * (1 + 0.04 * Math.sin(day / 3))),
    ...(base.spend ? { spend: Math.round(base.spend * weekday * push) } : {}),
  };
}
const DIMSWITCH_ROLLUP = { total: ['brand', 'generic', 'social', 'email'], search: ['brand', 'generic'], brand: ['brand'], generic: ['generic'], social: ['social'], email: ['email'] };
/** Sums of one member over days first to last. A field no leaf has stays absent: Email has no spend. */
function dimswitchSums(member, [first, last]) {
  const sums = {};
  for (const leaf of DIMSWITCH_ROLLUP[member]) {
    for (let day = first; day <= last; day++) for (const [field, value] of Object.entries(dimswitchDay(leaf, day))) sums[field] = (sums[field] ?? 0) + value;
  }
  return sums;
}
// Range 14 Sep to 7 Oct (days 24 to 47); Prior the 24 days before. W41 runs Monday to Wednesday, so its ref is Monday to Wednesday of W40.
const DIMSWITCH_WINDOWS = [
  { period: { id: 'range', label: 'Range', subLabel: '14 Sep–7 Oct', kind: 'range' }, days: [24, 47] },
  { period: { id: 'prior', label: 'vs prior', subLabel: '21 Aug–13 Sep', kind: 'prior' }, days: [0, 23] },
  { period: { id: 'w38', label: '14 Sep', subLabel: 'W38' }, days: [24, 30], ref: [17, 23] },
  { period: { id: 'w39', label: '21 Sep', subLabel: 'W39' }, days: [31, 37], ref: [24, 30] },
  { period: { id: 'w40', label: '28 Sep', subLabel: 'W40' }, days: [38, 44], ref: [31, 37] },
  { period: { id: 'w41', label: '5 Oct', subLabel: 'W41', partial: true }, days: [45, 47], ref: [38, 40] },
];
const DIMSWITCH_CUBE = {
  dimension: {
    label: 'Channel',
    total: { id: 'total', label: 'Total', heading: 'All channels' },
    members: [
      { id: 'search', label: 'Paid search' },
      { id: 'brand', label: 'Brand search', parentId: 'search' },
      { id: 'generic', label: 'Generic search', parentId: 'search' },
      { id: 'social', label: 'Paid social' },
      { id: 'email', label: 'Email' },
    ],
    headline: ['spend', 'revenue'],
  },
  changeLabel: 'WoW',
  groupHeadings: { 'Paid media': 'Paid media, channels with spend' },
  measures: [
    { id: 'orders', label: 'Orders', value: { field: 'orders' }, scale: 'count', judge: { family: 'volume', base: 'orders' } },
    { id: 'new', label: 'New customers', value: { field: 'nc' }, scale: 'count', splitOf: 'orders', judge: { family: 'volume', base: 'nc' } },
    { id: 'existing', label: 'Existing customers', value: { op: 'sub', a: { field: 'orders' }, b: { field: 'nc' } }, scale: 'count', parentId: 'orders' },
    {
      id: 'share', label: 'New-customer share', value: { op: 'div', a: { field: 'nc' }, b: { field: 'orders' }, factor: 100 },
      scale: 'percent', change: 'pp', judge: { family: 'rate', base: 'orders' },
    },
    { id: 'revenue', label: 'Net revenue', value: { field: 'rev' }, scale: 'money', unit: 'USD', divider: true },
    { id: 'aov', label: 'AOV', value: { op: 'div', a: { field: 'rev' }, b: { field: 'orders' } }, scale: 'perUnit', unit: 'USD', judge: { family: 'volume', base: 'orders' } },
    { id: 'spend', label: 'Marketing spend', value: { field: 'spend' }, scale: 'money', unit: 'USD', group: 'Paid media' },
    {
      id: 'cac', label: 'CAC', value: { op: 'div', a: { field: 'spend' }, b: { field: 'nc' } },
      scale: 'perUnit', unit: 'USD', group: 'Paid media', judge: { family: 'cost', base: 'nc' },
    },
  ],
  periods: DIMSWITCH_WINDOWS.map((window) => window.period),
  facts: DIMSWITCH_WINDOWS.flatMap((window) => Object.keys(DIMSWITCH_ROLLUP).map((memberId) => ({
    memberId, periodId: window.period.id, sums: dimswitchSums(memberId, window.days), ...(window.ref ? { ref: dimswitchSums(memberId, window.ref) } : {}),
  }))),
};
const DIMSWITCH_ROW = (variant, member, measure) => JSON.stringify([variant, member, ...(measure ? [measure] : [])]);
/** The statement example: invented per-order sums of one shop, Range, Prior and three weeks (the last one running). */
const STATEMENT_SUMS = {
  range: { orders: 2400, revbd: 172800, returns: 2160, gp: 75060, shipi: 6000, pay: 4320, ship: 25200, pick: 6480, spend: 72000, disc: 8400 },
  prior: { orders: 2200, revbd: 156200, returns: 1760, gp: 67430, shipi: 5720, pay: 3960, ship: 23320, pick: 5940, spend: 70400, disc: 7480 },
  w1: { orders: 800, revbd: 56800, returns: 640, gp: 24710, shipi: 2000, pay: 1440, ship: 8480, pick: 2160, spend: 25600, disc: 2800 },
  w2: { orders: 860, revbd: 62780, returns: 860, gp: 27250, shipi: 2150, pay: 1550, ship: 8940, pick: 2320, spend: 24940, disc: 3010 },
  w3: { orders: 380, revbd: 27360, returns: 300, gp: 11910, shipi: 950, pay: 680, ship: 3990, pick: 1030, spend: 11400, disc: 1140 },
  w3ref: { orders: 370, revbd: 27010, returns: 330, gp: 11550, shipi: 930, pay: 670, ship: 3850, pick: 1000, spend: 11100, disc: 1220 },
  w0: { orders: 760, revbd: 53960, returns: 680, gp: 23230, shipi: 1900, pay: 1370, ship: 8130, pick: 2050, spend: 25080, disc: 2660 },
};
const perOrder = (field) => ({ op: 'div', a: { field }, b: { field: 'orders' } });
const cmLine = (id, label, field, extra = {}) => ({ id, label, value: perOrder(field), format: '1.2', change: 'absolute', judge: { family: 'effect' }, ...extra });
const STATEMENT_CUBE = {
  dimension: { label: 'Shop', total: { id: 'total', label: 'Total', heading: 'Orders' }, members: [], headline: ['orders'] },
  changeLabel: 'WoW',
  effectLabel: 'Margin effect',
  groupHeadings: { 'Contribution margin': 'Contribution margin · USD per order · changes in USD' },
  measures: [
    { id: 'orders', label: 'Orders', value: { field: 'orders' }, scale: 'count', judge: { family: 'volume', base: 'orders' } },
    { id: 'income', label: 'Income', format: '1.2', change: 'absolute', judge: { family: 'effect' }, group: 'Contribution margin' },
    cmLine('gp', 'Gross profit', 'gp', { partOf: 'income', drivers: { op: 'mul', a: { op: 'sub', a: { measure: 'aovbd' }, b: { measure: 'ret' } }, b: { measure: 'gm' } } }),
    cmLine('shipi', 'Delivery charges', 'shipi', { partOf: 'income' }),
    cmLine('aovbd', 'Price before discounts', 'revbd'),
    cmLine('ret', 'Returns and refunds', 'returns'),
    { id: 'gm', label: 'Gross margin', value: { op: 'div', a: { field: 'gp' }, b: { op: 'sub', a: { field: 'revbd' }, b: { field: 'returns' } }, factor: 100 }, scale: 'percent', change: 'pp', judge: { family: 'effect' } },
    { id: 'costs', label: 'Costs', format: '1.2', change: 'absolute', judge: { family: 'effect' }, sign: -1, group: 'Contribution margin' },
    cmLine('pay', 'Payment fees', 'pay', { partOf: 'costs' }),
    cmLine('ship', 'Delivery', 'ship', { partOf: 'costs' }),
    cmLine('pick', 'Handling', 'pick', { partOf: 'costs' }),
    { ...cmLine('cm2', 'Margin after order costs', 'gp', { group: 'Contribution margin' }), result: true, value: { op: 'sub', a: { measure: 'income' }, b: { measure: 'costs' } } },
    { id: 'mkt', label: 'Sales costs', format: '1.2', change: 'absolute', judge: { family: 'effect' }, sign: -1, group: 'Contribution margin' },
    cmLine('spend', 'Advertising', 'spend', { partOf: 'mkt' }),
    cmLine('disc', 'Promotions', 'disc', { partOf: 'mkt' }),
    { ...cmLine('cm3', 'Final margin', 'gp', { group: 'Contribution margin' }), result: true, value: { op: 'sub', a: { measure: 'cm2' }, b: { measure: 'mkt' } } },
  ],
  periods: [
    { id: 'range', label: 'Range', subLabel: '7 to 23 Sep', kind: 'range' },
    { id: 'prior', label: 'vs prior', subLabel: '21 Aug to 6 Sep', kind: 'prior' },
    { id: 'w1', label: '7 Sep', subLabel: 'W37' },
    { id: 'w2', label: '14 Sep', subLabel: 'W38' },
    { id: 'w3', label: '21 Sep', subLabel: 'to 23 Sep', partial: true },
  ],
  facts: [
    { memberId: 'total', periodId: 'range', sums: STATEMENT_SUMS.range },
    { memberId: 'total', periodId: 'prior', sums: STATEMENT_SUMS.prior },
    { memberId: 'total', periodId: 'w1', sums: STATEMENT_SUMS.w1, ref: STATEMENT_SUMS.w0 },
    { memberId: 'total', periodId: 'w2', sums: STATEMENT_SUMS.w2, ref: STATEMENT_SUMS.w1 },
    { memberId: 'total', periodId: 'w3', sums: STATEMENT_SUMS.w3, ref: STATEMENT_SUMS.w3ref },
  ],
};

/** The dimswitch guide: the sections an AI needs to configure the table end to end. */
const DIMSWITCH = [
  {
    title: 'What the table is for',
    text: [
      'Use `dimswitch` for a KPI report over one dimension and a run of periods: for example orders, revenue, spend and CAC by channel, week by week. The reader switches the same numbers between two variants: KPI rows with the channels under each KPI, or channel rows with the KPIs under each channel. The reader also opens the rows level by level, shows split measures, and shows or hides the change lines.',
      'The host supplies additive sums: one set for each member and period. Boardplot computes ratios, differences, changes, judgement and display formats from these sums. The layout result keeps the calculation records in `computedCells`. Amount and change records contain a full expression in `op` and its source values in `inputs`. Source references name the member, period, `sums` or `ref` window, and field.',
      'CLI and MCP manifests publish amount, change and partition records. The reading lists numeric derivations and marks whether each value is drawn. A hidden record has an empty displayed value. Exact raw values stay unchanged. Unavailable results retain their state as records without an arithmetic promise; the reading does not list them as numeric derivations. Effect and Shapley records still lack source operands and are not published as verifiable calculations.',
      'Do not use `dimswitch` for these cases:\n\n- Two dimensions at once, such as channel by country: use `table` with a row tree, or draw one `dimswitch` for each country.\n- A plain list: use `table`. A statement with authored figures and no sums per period, such as a printed annual P&L: use `table` with `sign`, `kind: \"subtotal\"`, `\"result\"` and `\"driver\"` rows. A statement that Boardplot computes from sums per period, such as a contribution margin per order by week, is a `dimswitch` statement: see [Statements](#statements-subtotals-results-and-drivers).\n- One KPI over time: use `line`. One figure with its change: use `kpi`.\n- Calendar logic: Boardplot does no date arithmetic. The host computes every window, its sums and its reference sums.',
      'Read the sections below in order: [Mental model](#mental-model), [Host data](#host-data-what-to-supply-and-how-to-compute-it), [Measures](#measures-values-formats-changes-and-judgement), [Statements](#statements-subtotals-results-and-drivers), [View options](#view-options), [Worked example](#worked-example), [React usage](#react-usage) and [Common mistakes](#common-mistakes). The [Data](#data) and [Options](#options) tables above list every field.',
    ],
  },
  {
    title: 'Mental model',
    text: [
      'The data is a cube with three axes: the measures (one measure is one KPI), one hierarchical dimension (members with `parentId`, under one Total) and the periods. Each value cell is computed from the sums of one member in one window.',
      'The columns are the same in every view. The label column comes first; its head is `KPI` in by-measure and `dimension.label` in by-member. The Range column shows the whole selection. The vs prior column shows the change of Range against the Prior window. Then comes one column for each displayed period. The label, Range and vs prior columns stay pinned while the periods scroll.',
      '`variant` chooses the row tree. `by-measure` (the default) puts the measures of the Total at the top and the members under each measure. This is the outline of the [worked example](#worked-example) at depth 3 with splits off:\n\n```\nKPI                                (head of the label column)\nALL CHANNELS                       section row: dimension.total.heading\nOrders                             rung 0: a measure of the Total\n  Paid search                      rung 1: a top-level member\n    Brand search                   rung 2: a child member\n    Generic search\n  Paid social\n  Email\nNew customers                      the same members under every measure\n  ...\nNew-customer share\nNet revenue                        divider: true draws a rule above it\nAOV\nPAID MEDIA, CHANNELS WITH SPEND    section row of the group "Paid media"\nMarketing spend\n  Paid search\n    Brand search\n    Generic search\n  Paid social                      Email has no spend, so it has no row here\nCAC\n  ...\n```',
      '`by-member` starts with the Total block, then a section row with `dimension.label`, then one row for each top-level member. An open member row shows its member block: its measures one step in, then its child members. This is the same example in by-member at depth 3:\n\n```\nChannel                            (head of the label column: dimension.label)\nTotal                              the Total block: always open, no figures\n  Orders\n  New customers\n  New-customer share\n  Net revenue\n  AOV\n  Paid media                       group label row\n    Marketing spend\n    CAC\nCHANNEL                            section row: dimension.label\nPaid search                        rung 0; folded, it shows its headline figure\n  Orders                           the member block\n  ...\n  Paid media\n    Marketing spend\n    CAC\n  Brand search                     rung 1: a child member with its own block\n    Orders\n    ...\n  Generic search\nPaid social\nEmail                              no spend: no Paid media group\n  Orders\n  ...\n```',
      '`depth` opens the row tree level by level, like the outline buttons 1, 2 and 3 of a spreadsheet. Every row that can fold has an outline level, and depth d shows the rows of level d or less. Without a statement, the levels are the member levels, with the same meaning in both variants. Depth 1 shows the measures of the Total only; by-member also shows the top-level members as folded rows. Depth 2 also shows every measure of the top-level members. Depth 3 also shows every measure of their children. In general, depth d shows the measures of the Total and of d − 1 member levels; by-member also shows the next member level as folded rows. The maximum depth is the number of member levels plus one, so 3 for a dimension with two levels. A statement adds levels: see [Depth with a statement](#statements-subtotals-results-and-drivers). Section rows, group label rows, split rows and change lines take no level.',
      'On a fixed height, such as a slide or a print canvas, a table that misses the height at its `depth` draws one fold shallower, down to depth 1. By-member then also folds the Total. The table keeps the deepest fold that fits and warns with `dimswitch-depth-folded`, whose fix sets `options.depth`. An open height grows to its rows and never folds. A folded table sets the decimals of each change column from the rows it draws, so a hidden row with a small change does not keep a decimal on the figures of the rows that show. Where depth 1 still misses, the size refusal names the least height the folded table needs.',
      'These are the row counts of the worked example. They include section rows and group label rows, not change lines.\n\n| variant | splits | depth 1 | depth 2 | depth 3 |\n|---|---|---|---|---|\n| by-measure | off | 9 | 28 | 42 |\n| by-measure | on | 10 | 32 | 48 |\n| by-member | off | 13 | 36 | 52 |\n| by-member | on | 14 | 40 | 58 |',
      '`splits` is a separate switch, not a depth. A split is a measure with `parentId`: it shows only when splits are on, one step under its root measure, wherever the root measure has a row (under the Total and under every member). A dual-role measure has `splitOf` instead: with splits off it is a root measure of its own, and with splits on it moves under its root measure. In the worked example, New customers is dual-role and Existing customers is a split of Orders.',
      '`group` collects measures. In by-measure each group starts a section row. `groupHeadings` sets the text of that row, and `dimension.total.heading` names the section over the measures before the first group. by-measure has section rows only when at least one measure has a group. In by-member each member block shows a group label row with the measures of the group under it. A member for which no measure of the group applies shows no group label row. `divider: true` draws a rule above the rows of a measure, to start a family of KPIs without a section row.',
      'In by-member the Total block is open unless `expansion.collapsed` names its row. A folded Total shows its headline like a folded member row, and a table on a fixed height folds it after depth 1 (see below). `inTotalBlock: false` leaves a measure out of the Total block, for example a platform KPI that has no meaning for the total; by-measure keeps the Total row of that measure. A folded member row shows its headline: the first measure in `dimension.headline` that applies to the member. The measure label and unit follow the member label, for example `Paid search  Marketing spend, USD`. An open member row shows no figures.',
    ],
  },
  {
    title: 'Host data: what to supply and how to compute it',
    text: [
      'Boardplot does no date arithmetic. Do these steps in the host, in SQL or in code, and pass the result as `data`:\n\n1. Choose the windows. Range is the selection, for example 14 Sep to 7 Oct. Prior is the window of the same length directly before it, here 21 Aug to 13 Sep. The displayed periods are the calendar units inside the range, such as ISO weeks (Monday to Sunday) or months.\n2. Mark the partial periods. A period is partial when the range cuts it, or when it is still running (its last day is after the last day with data). Set `partial: true`. Boardplot mutes the column and never judges it.\n3. Find the reference window of each displayed period. For a full period, it is the unit before: W39 for W40. For a partial period, it is the same days of the unit before: W41 from Monday to Wednesday compares with Monday to Wednesday of W40. For a month cut after day 7, use days 1 to 7 of the month before; when the month before is shorter, stop at its last day. Range has no reference window of its own: it compares with Prior.\n4. Sum each additive field for each member and window. Put the sums of the window in `sums` and the sums of its reference window in `ref`. Supply one fact for the Total and for each member in each period, including Range and Prior. Range and Prior take no `ref`.\n5. Write `periods` in this order: the range block, the prior block, then the displayed periods. `label` is the first head line and `subLabel` the second, such as `14 Sep` and `W38`. The prior `label` heads the vs prior column, so write `vs prior` there and put the dates of the Prior window in its `subLabel`.',
      'Supply sums, never ratios. A field in `sums` is a total that you can add: orders, revenue, spend, new customers, sessions. Do not put a ratio, an average or a rate in `sums`. Boardplot computes CAC as the spend sum divided by the new-customer sum of the same window, which is the weighted ratio. An average of daily ratios gives a different, wrong number: a day with spend 100 and 1 new customer (CAC 100) and a day with spend 900 and 30 new customers (CAC 30) average to 65, but the true CAC is 1,000 / 31 = 32.3. Boardplot also needs the parts to compute the ratio again for each member and for the Total.',
      'This query sketch gives one result row for each member and window. `daily` holds one row for each day and leaf channel. `rollup` maps each member to the leaves it covers; the total covers every leaf. `windows` holds Range, Prior and each displayed period, with `ref_first` and `ref_last` null for Range and Prior.\n\n```\nSELECT w.period_id, r.member_id,\n  SUM(CASE WHEN d.day BETWEEN w.first_day AND w.last_day THEN d.orders END)        AS orders,\n  SUM(CASE WHEN d.day BETWEEN w.first_day AND w.last_day THEN d.new_customers END) AS nc,\n  SUM(CASE WHEN d.day BETWEEN w.first_day AND w.last_day THEN d.spend END)         AS spend,\n  SUM(CASE WHEN d.day BETWEEN w.ref_first AND w.ref_last THEN d.orders END)        AS ref_orders,\n  SUM(CASE WHEN d.day BETWEEN w.ref_first AND w.ref_last THEN d.new_customers END) AS ref_nc,\n  SUM(CASE WHEN d.day BETWEEN w.ref_first AND w.ref_last THEN d.spend END)         AS ref_spend\nFROM windows AS w\nCROSS JOIN rollup AS r\nJOIN daily AS d ON d.leaf_id = r.leaf_id\nGROUP BY w.period_id, r.member_id;\n```\n\nMap each result row to one fact: `{ "memberId": member_id, "periodId": period_id, "sums": { "orders": orders, "nc": nc, "spend": spend }, "ref": { "orders": ref_orders, "nc": ref_nc, "spend": ref_spend } }`. A SQL `SUM` over no rows gives NULL. Change that NULL to 0 for a field that applies to the member, and remove the key for a field that does not apply. The [React usage](#react-usage) example does this mapping.',
      'A measure applies to a member when every local field that its `value` reads has a number in at least one fact of that member. Otherwise Boardplot leaves the row of that measure out for that member. If the Total lacks a field, the measure is left out everywhere, with the warning `dimswitch-measure-omitted` and an entry in `reading.omissions`. With `dimension.sums: true` the Total has a field when at least one member has a number for it. The three states of a field mean different things:\n\n- Absent or `null` in every fact of the member: the measure does not apply. Use this for a structural absence, such as spend for Email. A SQL export that gives `null` works as it is.\n- `null` in some facts only: the measure applies, and those values are missing. Their cells print the missing glyph (—).\n- `0`: data. A window without activity is 0.',
      'To keep a row when the selected windows hold only `null` for a field, declare the field on the member: `{ "id": "email", "label": "Email", "fields": ["spend"] }` (and `dimension.total.fields` for the Total). The row then stays and prints the missing glyph. A statement line never leaves by applicability: see [Statements](#statements-subtotals-results-and-drivers). Decide applicability on the whole source data, not on the selected range, so rows do not appear and disappear when the reader changes the range. Source tables often fill spend with 0 for channels that never have spend. Remove that field or set it to `null` for those members; a 0 draws Marketing spend 0 and CAC 0.0 rows.',
      'By default Boardplot uses the sums that you supply for every member and for the Total. Members do not have to add up to their parent: a channel list can leave out small channels, and members can overlap. Set `dimension.sums: true` only for a true partition. Boardplot then derives the sums of each parent, and of the Total, from its children, so supply no fact for the Total or for a parent member; for both `sums` and `ref`, and records the difference to any supplied parent sum as a reconciliation record. A field that a child reports in no fact adds up over the other children. A child that reports a field in any period owes it in every period: a `null` value, a missing field or a missing fact makes the parent value `null`, and the Total prints the missing glyph. A missing fact or field also gives the warning `dimswitch-fact-missing`, which names the member and the periods. Send `null` for an unknown value and `0` for none.',
    ],
  },
  {
    title: 'Measures: values, formats, changes and judgement',
    text: [
      '`value` is an expression over the field names in `sums`: `{ "field": "orders" }`, or `{ "op": "add" | "sub" | "mul" | "div", "a": ..., "b": ..., "factor": 100 }`. An operand can also be another measure, `{ "measure": "income" }`, or a number. A percent measure enters as a fraction: a margin of 42.5% reads 0.425. Expressions nest, and `factor` multiplies the result of its own operation. Examples:\n\n- Existing customers: `{ "op": "sub", "a": { "field": "orders" }, "b": { "field": "nc" } }`\n- CAC: `{ "op": "div", "a": { "field": "spend" }, "b": { "field": "nc" } }`\n- New-customer share in percent: `{ "op": "div", "a": { "field": "nc" }, "b": { "field": "orders" }, "factor": 100 }`\n- CPM: `{ "op": "div", "a": { "field": "spend" }, "b": { "field": "impressions" }, "factor": 1000 }`',
      '`{ "total": expression }` evaluates its whole expression against `dimension.total.id` in the same window. This includes expanded measure references, prior, displayed-period `ref`, and plan. Nested Total operands keep that scope. Total fields do not become required member fields. A missing Total input keeps the applicable member row and prints missing. `show: "withData"` still checks the member fields. Calculation records name the Total member and source window. Use this operand in measure values, including driver values; `drivers` formulas still accept only measure references and numbers.',
      'Boardplot evaluates the expression on the sums of each member and window, and again on the reference sums for the change. A missing operand gives a missing cell (—). A division by zero prints n.m.; 0 divided by 0 prints n/a.',
      '`scale` sets the precision of a row from its own values. Boardplot takes the largest absolute value of the row in Range and in the displayed periods; the vs prior column and the change lines do not count.\n\n- `money`: 1,000 or more prints thousands with one decimal (364.3k). Below 1,000 the row prints whole units (980). If a nonzero value would print as 0.0k, the whole row prints whole units (5,520, 40 and 450).\n- `perUnit`: fractional values keep the precision in `format`. Without a format, start with whole units at 10 or more, else one decimal; add decimals when rounding error exceeds 1%, up to 20 decimals. Integer-only rows keep the starting precision. It never abbreviates: 2,400 stays 2,400.\n- `count`: keeps `format`; the default is `1,234`.\n- `percent`: keeps `format`; the default is `1.2%`. The value must already be in percent: use `factor: 100`.\n- No `scale`: keeps `format` as written; the default is `1,234`.\n\nScaled `money` and automatic `count` rows add decimals when rounding error exceeds 1%, up to 20 decimals. The row keeps one precision and its existing magnitude. An explicit whole-thousand scale stays whole.',
      '`money` drops the prefix, suffix and decimals of `format`. `perUnit` drops the prefix and suffix, but keeps authored precision for fractional values. Put the currency in `unit`. The unit prints after the KPI label, such as `Net revenue USD`, and not in the cells. Member rows and split rows repeat no unit. A `%` or `pp` unit next to a percent format is left out, because the cells already show it. A nonzero value never prints as zero: the row takes more decimals (0.004).',
      'Each period value has a change line under it, and Range has the vs prior column. `change: "relative"` (the default) prints the percent change against the reference: whole percent from 5% and at 0% (+7%), and one decimal below 5% (+4.2%). With `relative`, a change of 1,000% or more, or a reference of 0 or less, prints n.m. A missing reference prints n/a. 0 against 0 prints nothing. A displayed period whose facts carry no `ref` has no change line at all, and a period where only some facts lack `ref` prints n/a for those members. `change: "pp"` prints the difference of the two percent levels with one decimal (+0.9pp). Use `pp` for shares and rates. `change: "absolute"` prints the current value minus the reference value, in the measure format with a sign (+0.4). Use it on statement lines, where the changes add up down the statement.',
      '`judge` colours a measure. `family` sets the direction and the default thresholds: `volume` (higher is better, [2, 10]), `cost` (lower is better, [5, 15]) and `rate` (higher is better, [3, 10]). The thresholds are relative percent changes. A favourable change of at least the first threshold is good, and of at least the second threshold strong good. An adverse change of at least the first threshold is warn, and of at least the second threshold bad. A smaller change is neutral. A `pp` measure is also judged on the relative change of its level: a share that goes from 40% to 41.2% is +3% relative, which is good for a `rate`, while the cell prints +1.2pp. There is no lower-is-better rate family in 0.24.0: for a rate where lower is better (a return rate or a bounce rate), use `cost`, which shares `thresholds.cost` with CAC. A statement line can use the family `effect` instead: see [Statements](#statements-subtotals-results-and-drivers).',
      '`measures[].bands` colours Range and displayed-period values. Each band has `to`, optional `tone` and optional `label`. Use a nonempty list with finite, strictly ascending bounds. The first band with `value <= to` wins. Below all bounds uses the first; above all bounds uses the last. Values are unrounded and in their original units; percent levels use percentage points. An omitted tone means neutral. Partial or missing values stay neutral. Bands use the current sample floors when `judge.base` exists; changes still use `judge` and both windows. Without bands, level colours stay unchanged.',
      'A ratio of the Total divides the Total sums. Total CAC divides all spend by all new customers, including the new customers of members without spend. For a paid-only CAC, supply a field such as `nc_paid` that is absent or `null` for members without spend, and use it as the denominator.',
      '`judge.base` accepts a field name or a nonempty list of unique field names, such as `["orders", "sessions"]`. All listed fields must meet their own `minimumSample` floor in every required window. Missing or null fields fail, even with the default floor of zero. Equality passes. Changes require current and reference samples; value bands require only the current sample. Total-dependent measures also check the same declared fields in their Total windows. No extra base field is inferred. A failed floor changes only the tone; values and changes stay visible. Without bands, Range stays neutral and the vs prior column carries its judgement. A measure without `judge` prints its comparison changes muted.',
      'A `money` or `count` measure without `judge` is a size, not a performance. Its period cells draw a grey bar, scaled to the largest full period of the row. Its Range cells draw a bar scaled to the largest member of the same measure; the Total row has no Range bar.',
      'The order of `measures` is the row order; splits follow their root measure. A split cannot have splits of its own, and a measure cannot have both `parentId` and `splitOf`. `dimension.headline` lists the measures for folded member rows in by-member: put the measure that best sums up a paid channel first (spend), then a fallback for the members where it does not apply (revenue).',
    ],
  },
  {
    title: 'Statements: subtotals, results and drivers',
    text: [
      'A statement is a group of measures that add up to results, such as a contribution-margin (CM) statement per order or a P&L in money. It sits in the same table as the KPIs, under its own section. Give its measures one `group`: that group is the statement. A group is a statement when any of its measures has `partOf`, `sign`, `result` or `drivers`, or is named by the `partOf` or `drivers` of another measure. A part takes the group of its subtotal, so give `group` to the top-level lines only.',
      'Each statement line has one of four roles:\n\n- **Part**: a measure with `partOf` set to the id of its subtotal, such as Shipping with `partOf: "costs"`.\n- **Subtotal**: a measure that other measures name in `partOf`, such as Costs. Leave out its `value`: Boardplot adds up its parts with their signs. If you give it a `value`, Boardplot keeps that value and warns `dimswitch-subtotal-footing` when it differs from the sum of the parts by more than half a printed unit. Boardplot never overwrites it.\n- **Result**: a top-level measure with `result: true` and a `value` that names its lines, such as Margin after order costs = `{ "op": "sub", "a": { "measure": "income" }, "b": { "measure": "costs" } }`. A result takes no `sign` and no `partOf`. The last result of each statement block takes the closing rule, a double rule by default (theme `table.finalRule`).\n- **Driver**: a measure that the `drivers` formula of another line names, such as Price before discounts for Gross profit. A driver explains that line, prints in its block, and is never added. It takes no `sign`, `result` or `drivers`.',
      'Supply costs as positive sums and set `sign: -1` on the line that subtracts. Set it on the subtotal Costs, not on each part: the contribution sign of a line is the product of the signs up its `partOf` chain, so Shipping under Costs subtracts. Boardplot computes values, relative changes and n.m. rules on the supplied values, before any sign. The table option `signs` decides how a sign prints:\n\n- `"signed"` (the default): a line with contribution sign −1 prints its value and its absolute changes negated, so the column adds up from top to bottom. Relative and pp changes keep their sign. A driver is never negated, and a result prints its own value, negative or not.\n- `"operators"`: values print as supplied, and an operator stands before the label: − for a line with `sign: -1`, + for a later part of a block, = for a result, and for a driver the operator of its place in the formula (−, ×, ÷ or +).\n- `"plain"`: neither.\n\nIn `operators` mode a cost that rises prints a positive change, because values print as supplied; the colour still shows the effect. Each figure rounds on its own, so a printed subtotal can differ by one in the last digit from the sum of its printed parts; Boardplot adds the exact values.',
      'Write a per-order line as a ratio of sums: `{ "op": "div", "a": { "field": "ship" }, "b": { "field": "orders" } }`. Use the same denominator for every line of a per-unit statement, so the parts add up to their subtotal in every window. Boardplot divides the sums of each window, so Range is the weighted value of the whole selection, never an average of the weeks. Give statement lines a fixed `format` such as `1.2` when small changes need a fixed decimal place. Use `scale: "perUnit"` to keep that precision for fractional values and place the currency in `unit`. Omit `scale` to keep the format on every value. Boardplot assumes no currency. Put the currency in `unit`, in the group heading or in the format (`€1.2`, `CHF 1.2`).',
      'Set `change: "absolute"` on statement lines. In `signed` mode, the absolute changes of the parts then add up to the change of their subtotal, and the changes of the lines add up to the change of each result. A percent driver, such as a gross margin, uses `pp`. `relative` stays possible, but relative changes do not add up.',
      'A line with drivers names them in a formula over `{ "measure": id }` and numbers. Gross profit per order = (price before discounts − returns per order) × gross margin is `"drivers": { "op": "mul", "a": { "op": "sub", "a": { "measure": "aovbd" }, "b": { "measure": "ret" } }, "b": { "measure": "gm" } }`. A percent measure enters the formula as a fraction. Boardplot checks in every window that the formula gives the value of the line, and warns `dimswitch-driver-footing` when it does not; the warning names a percent driver that has a `factor: 100` value but no `scale: "percent"`. The drivers print in the block of the line they explain, after its parts: here under Income, after Gross profit and Delivery charges. Set `partOf` on a driver to place it elsewhere. A line can have at most six drivers. Define a percent driver on the base the formula uses: a gross margin of `{ "op": "div", "a": { "field": "gp" }, "b": { "op": "sub", "a": { "field": "revbd" }, "b": { "field": "returns" } }, "factor": 100 }` with `scale: "percent"` makes (AOV − returns) × margin give gross profit exactly.',
      '`judge: { "family": "effect" }` colours a statement line by its effect on the statement result, in the statement unit. The effect of a line is its change times its contribution sign: when shipping costs rise by 0.4 per order, the effect is −0.4. The effect of a driver is its share of the change of the line it explains, times the contribution sign of that line. Boardplot splits the change of the line with the Shapley method: the effect of each driver is its marginal effect, averaged over every order in which the drivers can move. The shares add up exactly to the change of the line. For (A − R) × m this is the midpoint rule: ΔA × average m, −ΔR × average m and Δm × average (A − R). The split is arithmetic; it does not prove a cause.',
      'Set the effect thresholds in the statement unit: `options.thresholds.effect: [0.3, 1]` means 0.3 and 1 currency per order. An effect of 0.3 or more is good, of 1 or more strong good; −0.3 or less is warn, −1 or less bad. An explicit effect pair must resolve for each used comparison kind: use the family pair or `thresholds.period.effect`, `thresholds.prior.effect` and `thresholds.plan.effect`. Boardplot refuses effect lines with different scales or formats, because one pair of thresholds cannot judge two units. Drivers are exempt: their effect is in the unit of the line they explain. Use thresholds for the currency of the data; do not reuse EUR thresholds for CHF or for total money. `judge.base` is optional for `effect` and keeps its `minimumSample` meaning. A partial period, a missing value and an effect of 0 stay neutral. `data.effectLabel`, such as `"Margin effect"`, adds the effect of each driver cell to its hover text; that line stays hidden in the cell (`inlineVisibility.effect` is false unless you set it).',
      'A statement line never leaves the table because of applicability. A missing field prints the missing glyph (—), and a subtotal or result that reads it is missing too, never a smaller number. With `dimension.sums: true`, a member fact that lacks a statement field makes the parent sum missing for that period; a member with no fact in a period adds nothing. Statement lines draw no size bars.',
      'Depth with a statement counts the statement levels too. In by-measure the statement opens first, then the members: depth 1 shows the top-level lines, depth 2 also the parts of each subtotal, and depth 3 also the members under every line. A KPI outside the statement opens its members at the same depth as the statement lines, so one depth means one thing across the table. A line with parts or drivers under it has no member rows in by-measure; read a subtotal per member in by-member. In by-member the members open first, then the statement: with one member level, depth 2 opens the member blocks and depth 3 the parts of each subtotal in every block. A Total-only statement (no members) has two depths: 1 folded, 2 open. A result has no rows under it, so it shows at every depth.',
      'This is the outline of the example below at depth 2, with the operators of `signs: "operators"`:\n\n```\nORDERS\nOrders\nCONTRIBUTION MARGIN · USD PER ORDER · CHANGES IN USD\nIncome                     subtotal\n    Gross profit           part (explained by the three drivers)\n  + Delivery charges       part\n    Price before discounts driver\n  − Returns and refunds    driver\n  × Gross margin           driver (percent, pp change)\n− Costs                    subtotal with sign -1\n    Payment fees           part\n  + Delivery\n  + Handling\n= Margin after order costs result\n− Sales costs              subtotal with sign -1\n    Advertising\n  + Promotions\n= Final margin             result, closing double rule\n```',
    ],
    spec: {
      type: 'dimswitch',
      data: STATEMENT_CUBE,
      options: { title: 'Margin after order costs rises 0.6 to 18.8 per order as sales costs fall 1.9', depth: 2, signs: 'signed', thresholds: { effect: [0.3, 1] }, widths: { range: 120, change: 120 } },
    },
  },
  {
    title: 'View options',
    text: [
      '`variant` (`by-measure` by default, or `by-member`), `depth` (1 by default) and `splits` (false by default) choose the view; see [Mental model](#mental-model). In React they are props that the host controls.',
      '`expansion` adds row-id exceptions on top of the depth defaults: `expanded` opens rows and `collapsed` folds rows. A row id is the JSON text of an array: `["by-measure","total","spend"]` is the Total row of Marketing spend in by-measure, `["by-measure","search","cac"]` is the Paid search row under CAC, and `["by-member","search"]` is the Paid search member row in by-member. A change line has the id of its row plus `:change`. Build the ids with `dimswitchRowId(variant, memberId, measureId)` from `boardplot` (it returns `JSON.stringify([variant, memberId, measureId])`), and leave out `measureId` for a member row in by-member. An id of the other variant has no effect. An expanded row shows only when all its parents are open, and an id of a hidden row has no effect and gives no warning. In by-measure at depth 1, to show the Paid search row of Marketing spend, expand the Total row of Marketing spend as well: `[dimswitchRowId("by-measure", "total", "spend"), dimswitchRowId("by-measure", "search", "spend")]`. The [worked example](#worked-example) opens the Paid search rows of Marketing spend and CAC this way.',
      '`order` sorts the members among their siblings. `"sheet"` (the default) keeps the order of `dimension.members`. `{ "by": "revenue" }` sorts by the Range value of that measure, descending; `"desc": false` sorts ascending. Ties sort by member id, and missing values come last. `show: "withData"` hides a member only when every field of every measure that applies to it is zero or empty in Range; a member with any value there stays, because it still counts in the Total. Its child members hide with it. A member with no measure field that applies always shows.',
      'An optional period with `kind: "plan"` adds one `pl` comparison column: label, Range, vs prior (`pp`), vs plan (`pl`), then displayed periods. Zero or one plan is allowed. At least one displayed period is required. `pl` is a reserved column id. The plan `label` and `subLabel` head `pl`; `widths.change` sets its width. The host must supply comparable actual and plan windows. Boardplot does not prorate plan or use prior as a fallback. Sample floors must pass in actual and plan. A partial Range or plan disables plan judgement. Plan uses the same change modes and effect calculations as prior.',
      '`thresholds.period`, `thresholds.prior` and `thresholds.plan` override change thresholds for displayed changes, `pp` and `pl`. Resolve each family separately: kind override, family setting, then family default. Defaults remain volume `[2,10]`, cost `[5,15]` and rate `[3,10]`. Each pair must be finite and satisfy `0 <= first <= second`. Effect needs an explicit pair for each used kind. These thresholds judge changes, separate from value bands.',
      '`thresholds` replaces the thresholds of a family, such as `{ "cost": [3, 12] }`. `minimumSample` sets the smallest judge base for each sum field, such as `{ "orders": 30, "nc": 20 }`; see [Measures](#measures-values-formats-changes-and-judgement).',
      '`inlineVisibility: { "change": false }` hides the change lines. They are visible when you do not set it. In React, the hover text of each period cell still shows the change, tagged with `changeLabel`, such as `WoW +24%`.',
      '`widths` fixes the track widths in px: `label` is the cap of the whole label column, indent and affix included (a longer label is cut; absent, the label text adds up to 320 px to the column, with the indent and the affix on top, and a column made wider by other content lets labels use the room), `range` the Range column (110), `change` each vs prior or vs plan column (92) and `period` each period column (94). Widen `range` and `change` when their `subLabel` holds dates. Render the table at the width the page shows it: at a narrow width a long unit can cut the KPI label.',
      '`dimswitch` takes the `table` options except `topN`. It always draws the steering table. It sets these defaults, and an option that you set wins: `stickyLabels: 3` (label, Range and vs prior pinned), or `4` when plan is present, `rowExtent: "frame"`, `mountCollapsed: false` (closed rows stay out of the DOM), `fitFormats: true` and `labelIndent: { "base": 25, "step": 17 }`. `options.format` has no effect and warns `format-unused`: set `measures[].format`.',
      'The report-sheet look comes from `theme.overrides.table`. `tones: "fill"` paints judged cells with `grounds` (`good`, `goodStrong`, `warn`, `bad`) and keeps the figures in the text ink. `rows: { "lineHeight": 1.44, "pad": 3 }` prints every rung at one size. `weights` sets the label weights of member rows and measure rows. `mark: "boxed"` draws a framed open and close mark. `headRule: "ink"` and `blockRule: "rule"` set the rules under the heads and around an open block. `head: { "case": "asis" }` keeps period heads as written (`14 Sep`) instead of capitals. `bar` sets the size bar colours, `ofWhich: "ink"` prints split rows in the text ink instead of the muted ink, and `endRule: "none"` drops the right edge rule inside a host card. The worked example uses this look; the fixture `sheet` and [Theme](theme.md) show the other tokens.',
      'A long omitted-period list names the first eight periods, then "and N more" with the exact count left out. It follows the supplied period order and uses the shared note rule, which also names a lone ninth period. The existing `notes.maxListed` option sets another limit: 0 draws only the count, and `"all"` draws every name. The reading keeps the full list in the note text. Its `short` field holds the text drawn in SVG and React.',
    ],
  },
  {
    title: 'Worked example',
    text: [
      'An invented web shop sells through four leaf channels: Brand search and Generic search under Paid search, Paid social, and Email. Email has no spend. The host sums daily rows into windows. Range is 14 Sep to 7 Oct 2026 (24 days), and Prior is the 24 days before it, 21 Aug to 13 Sep. The displayed periods are the ISO weeks W38 to W41. W41 runs from Monday to Wednesday, so it is partial, and its reference window is Monday to Wednesday of W40. The fields are `orders`, `nc` (new customers), `rev` (net revenue) and `spend`; no Email fact has `spend`.',
      'The measures: Orders (count, judged as volume), New customers (dual-role: a root with splits off, a split of Orders with splits on), Existing customers (a split of Orders: orders − nc), New-customer share (nc / orders × 100, a `pp` change, judged as rate), Net revenue (money, unjudged, so it draws size bars), AOV (rev / orders, per unit, judged as volume), and the group Paid media with Marketing spend (money, unjudged) and CAC (spend / nc, judged as cost). `minimumSample` asks for 200 orders and 50 new customers in both windows. `expansion` opens the Paid search rows of Marketing spend and CAC, and the theme gives the report-sheet look of [View options](#view-options).',
      'What it draws, in by-measure at depth 2 with splits off (32 rows): the section ALL CHANNELS with Orders, New customers, New-customer share, Net revenue and AOV, each followed by Paid search, Paid social and Email; then the section PAID MEDIA, CHANNELS WITH SPEND with Marketing spend and CAC, each followed by Paid search and Paid social only. Under those two measures `expansion` opens Paid search, so Brand search and Generic search show there; the other Paid search rows carry a closed (+) mark. Without `expansion` the view has 28 rows. Orders print 4,641 for Range and +7% vs prior, judged good. The CAC of Paid search climbs from 50 to 53, 58 and 62 over the four weeks, and its vs prior change of +9% is judged warn (cost, at least 5%). Under it, Generic search drives the rise (60 to 78) while Brand search stays at 39 or 40. The weekly cells of Email new customers stay neutral, because 22 a week is below the minimum sample of 50. The W41 column is muted and not judged, but its changes compare the same three days.',
      'In by-member at depth 1 (13 rows) the same spec shows the open Total block with its seven measures, the section CHANNEL, and three folded member rows: Paid search with 61.3k (Marketing spend, USD), Paid social with 27.3k, and Email with 86.1k (Net revenue, USD), because spend does not apply to Email.',
    ],
    spec: {
      type: 'dimswitch',
      data: DIMSWITCH_CUBE,
      options: {
        title: 'Orders grew 7% while paid search CAC rose every week',
        variant: 'by-measure',
        depth: 2,
        expansion: { expanded: [DIMSWITCH_ROW('by-measure', 'search', 'spend'), DIMSWITCH_ROW('by-measure', 'search', 'cac')] },
        minimumSample: { orders: 200, nc: 50 },
        widths: { range: 120, change: 120 },
        size: { width: 1050 },
        theme: {
          preset: 'boardroom',
          overrides: { table: { tones: 'fill', rows: { lineHeight: 1.44, pad: 3 }, weights: { member: 700, measure: 600 }, mark: 'boxed', headRule: 'ink', blockRule: 'rule', head: { case: 'asis' } } },
        },
      },
    },
  },
  {
    title: 'React usage',
    text: [
      '`DimSwitchChart` from `boardplot/react/dimswitch` takes `data` and every option as its own prop; it has no `options` prop. The type `DimSwitchData` comes from `boardplot`, and the types `DimSwitchView` and `DimSwitchViewReason` come from the component entry.',
      'The component draws no switches. The host draws the Variant, Depth, Splits and Changes controls and passes their values as the props `variant`, `depth`, `splits` and `inlineVisibility={{ change }}`. `variant`, `depth`, `splits` and `collapsed` each have a `default...` twin, which sets the start value when the host does not control the prop. An uncontrolled `variant`, `depth` or `splits` never changes after the first render, because the component has no control for it. Offer depth values from 1 to the number of member levels plus one; a higher depth throws.',
      '`onViewChange(next, reason)` reports the view `{ variant, depth, splits, collapsed }` after each change. The reason `collapsed` means that the reader opened or folded a row. The reasons `variant`, `depth` and `splits` mean that the prop changed; `next.collapsed` then holds the folds that apply now. Pass `onViewChange={setView}` to keep one view state.',
      'A change of `variant` or `depth` resets the manual folds to the depth defaults, with `expansion` on top. A change of `splits` or of the Changes switch keeps the manual folds. Control `collapsed` only to restore a saved view, and then store `next.collapsed` from every `onViewChange` call. Do not start it with `[]`: an empty list opens every row. Leave it undefined, or pass the saved list.',
      'The `TableChart` host props pass through: `size="container"` with `fallbackSize`, `fit`, `fillHeight`, `stickyLabels`, `rowExtent`, `cellPadX`, `fontMetrics`, `measureWidths`, `hover`, `onRowSelect`, `handleRef` and `onScrollChange`. `toolbar` is false by default. `isRowSelectable(row, { collapsed })` also passes through; `collapsed` is true while the row is folded shut. `mountCollapsed` is false by default here, so the browser paints a leaf row only near the viewport; to capture a whole long table, add the host CSS `.bp-table-grid [data-bp-defer-row]{content-visibility:visible!important}` first. See [React](react.md).',
      'Speed: the component compiles the cube again only when `data`, `variant`, `splits` or another option changes. `depth`, `collapsed` and the Changes switch change only the folds or the CSS, so they are fast. The component compares `data` by content: keep it the same object while it does not change (`useMemo`), because a deep compare of a large cube also takes time. Closed rows are not mounted, so the cost grows with the open rows times the period columns. Rows that open fade and slide in over the theme duration `motion.layout` (160 ms by default), and rows that close go at once; `motion: "reduce"` on `BoardplotTheme`, or the reader setting for reduced motion, turns this off. In one development measurement, opening 350 rows with 60 period columns took about 0.6 s. A Day grain over a long range gives one column for each day: offer Day only for short ranges, and use Week or Month for longer ones.',
      'This host component maps query rows to facts (see [Host data](#host-data-what-to-supply-and-how-to-compute-it)) and draws the four controls. Its Range is W40 and the running W41 (Monday to Wednesday); Prior is the 10 days before.',
    ],
    tsx: [
      "import { useMemo, useState } from 'react';",
      "import { DimSwitchChart, type DimSwitchView } from 'boardplot/react/dimswitch';",
      "import type { DimSwitchData, DimSwitchSums } from 'boardplot';",
      '',
      '// Query result rows: member, period, orders, nc, spend, ref_orders, ref_nc, ref_spend.',
      'type Row = [string, string, ...(number | null)[]];',
      'const ROWS: Row[] = [',
      "  ['total', 'range', 1445, 474, 22600, null, null, null], ['total', 'prior', 1402, 453, 20700, null, null, null],",
      "  ['total', 'w40', 990, 322, 15400, 968, 315, 14400], ['total', 'w41', 455, 152, 7200, 451, 148, 6750],",
      "  ['search', 'range', 1040, 442, 22600, null, null, null], ['search', 'prior', 1000, 422, 20700, null, null, null],",
      "  ['search', 'w40', 710, 300, 15400, 692, 294, 14400], ['search', 'w41', 330, 142, 7200, 321, 137, 6750],",
      "  ['brand', 'range', 600, 206, 8100, null, null, null], ['brand', 'prior', 580, 196, 7900, null, null, null],",
      "  ['brand', 'w40', 410, 140, 5600, 402, 136, 5500], ['brand', 'w41', 190, 66, 2500, 185, 63, 2450],",
      "  ['generic', 'range', 440, 236, 14500, null, null, null], ['generic', 'prior', 420, 226, 12800, null, null, null],",
      "  ['generic', 'w40', 300, 160, 9800, 290, 158, 8900], ['generic', 'w41', 140, 76, 4700, 136, 74, 4300],",
      "  ['email', 'range', 405, 32, null, null, null, null], ['email', 'prior', 402, 31, null, null, null, null],",
      "  ['email', 'w40', 280, 22, null, 276, 21, null], ['email', 'w41', 125, 10, null, 130, 11, null],",
      '];',
      "const FIELDS = ['orders', 'nc', 'spend'];",
      '// Decided on the whole source, not on the selected range: Email never has spend.',
      "const WITHOUT_SPEND = new Set(['email']);",
      '',
      'function sums(member: string, values: (number | null)[]): DimSwitchSums {',
      '  const out: DimSwitchSums = {};',
      '  FIELDS.forEach((field, index) => {',
      "    if (field === 'spend' && WITHOUT_SPEND.has(member)) return; // Absent: spend and CAC do not apply.",
      '    out[field] = values[index] ?? 0; // A window without activity is 0, not missing.',
      '  });',
      '  return out;',
      '}',
      '',
      'function toCube(rows: Row[]): DimSwitchData {',
      '  return {',
      '    dimension: {',
      "      label: 'Channel',",
      "      total: { id: 'total', label: 'Total' },",
      '      members: [',
      "        { id: 'search', label: 'Paid search' },",
      "        { id: 'brand', label: 'Brand search', parentId: 'search' },",
      "        { id: 'generic', label: 'Generic search', parentId: 'search' },",
      "        { id: 'email', label: 'Email' },",
      '      ],',
      "      headline: ['spend', 'orders'],",
      '    },',
      "    changeLabel: 'WoW',",
      '    measures: [',
      "      { id: 'orders', label: 'Orders', value: { field: 'orders' }, scale: 'count', judge: { family: 'volume', base: 'orders' } },",
      "      { id: 'new', label: 'New customers', value: { field: 'nc' }, scale: 'count', splitOf: 'orders', judge: { family: 'volume', base: 'nc' } },",
      "      { id: 'spend', label: 'Marketing spend', value: { field: 'spend' }, scale: 'money', unit: 'USD', divider: true },",
      "      { id: 'cac', label: 'CAC', value: { op: 'div', a: { field: 'spend' }, b: { field: 'nc' } }, scale: 'perUnit', unit: 'USD', judge: { family: 'cost', base: 'nc' } },",
      '    ],',
      '    periods: [',
      "      { id: 'range', label: 'Range', subLabel: '28 Sep–7 Oct', kind: 'range' },",
      "      { id: 'prior', label: 'vs prior', subLabel: '18–27 Sep', kind: 'prior' },",
      "      { id: 'w40', label: '28 Sep', subLabel: 'W40' },",
      "      { id: 'w41', label: '5 Oct', subLabel: 'W41', partial: true },",
      '    ],',
      '    facts: rows.map(([member, period, ...values]) => ({',
      '      memberId: member,',
      '      periodId: period,',
      '      sums: sums(member, values.slice(0, 3)),',
      "      ...(period === 'range' || period === 'prior' ? {} : { ref: sums(member, values.slice(3)) }),",
      '    })),',
      '  };',
      '}',
      '',
      'export function ChannelTable() {',
      '  const data = useMemo(() => toCube(ROWS), []);',
      "  // view.collapsed is not passed back: the component keeps the manual folds.",
      "  const [view, setView] = useState<DimSwitchView>({ variant: 'by-measure', depth: 1, splits: false, collapsed: [] });",
      '  const [changes, setChanges] = useState(true);',
      '  const pick = (next: Partial<DimSwitchView>) => setView({ ...view, ...next });',
      '  return (',
      '    <section>',
      '      <div role="toolbar" aria-label="Table view">',
      "        <button type=\"button\" aria-pressed={view.variant === 'by-measure'} onClick={() => pick({ variant: 'by-measure' })}>By KPI</button>",
      "        <button type=\"button\" aria-pressed={view.variant === 'by-member'} onClick={() => pick({ variant: 'by-member' })}>By channel</button>",
      '        {[1, 2, 3].map((depth) => (',
      '          <button key={depth} type="button" aria-pressed={view.depth === depth} onClick={() => pick({ depth })}>Depth {depth}</button>',
      '        ))}',
      '        <button type="button" aria-pressed={view.splits} onClick={() => pick({ splits: !view.splits })}>Splits</button>',
      '        <button type="button" aria-pressed={changes} onClick={() => setChanges(!changes)}>Changes</button>',
      '      </div>',
      '      <DimSwitchChart',
      '        data={data}',
      '        variant={view.variant}',
      '        depth={view.depth}',
      '        splits={view.splits}',
      '        onViewChange={setView}',
      '        inlineVisibility={{ change: changes }}',
      '        minimumSample={{ nc: 50 }}',
      '        title={false}',
      '        size="container"',
      '        fallbackSize={{ width: 960, height: 480 }}',
      '      />',
      '    </section>',
      '  );',
      '}',
    ].join('\n'),
  },
  {
    title: 'Common mistakes',
    text: [
      'Each item names the mistake, the symptom and the fix.\n\n- **Averaging daily ratios.** Symptom: CAC, AOV or a rate differs from a check on the totals, and the members do not match the Total. Fix: supply the additive parts (spend and new customers) and let `value` divide them.\n- **A ratio in `sums`.** Symptom: under `dimension.sums: true` a parent shows the sum of the rates of its children, and without it a Total rate does not match the weighted rate of its members. Fix: put the numerator and the denominator in `sums`, and write the ratio as `{ "op": "div", ... }`.\n- **Missing ref sums.** Symptom: a period has no change line and no coloured cell, or some members print n/a under it; only the vs prior column works. Fix: add `ref` to each fact of a displayed period.\n- **A full week as the reference of a partial week.** Symptom: on a Wednesday the running week shows a change near −55% (three days against seven); without `partial: true` it is also judged bad. Fix: compare the partial period with the same days of the period before, and set `partial: true`.\n- **Zero-filled spend.** Symptom: Email shows Marketing spend 0 and CAC 0.0 rows. Fix: leave the `spend` key out, or set it to `null`, in every fact of a member that never has spend.\n- **Depth 4.** Symptom: the error `dimswitch depth must be between 1 and 3 (member levels + 1); got 4`. Fix: the maximum depth is the number of member levels plus one; offer depth controls up to that number.\n- **No range or prior block.** Symptom: `invalid-data` with `Exactly one range period is required.` or `Exactly one prior period is required.` Fix: add one period with `kind: "range"` and one with `kind: "prior"`, with facts for the Total and every member.\n- **A format for a money row.** Symptom: `format: "$1.2"` with `scale: "money"` prints no `$` in the cells and no decimals below 1,000. Fix: put the currency in `unit`. `money` sets its own precision. `perUnit` keeps authored precision for fractional values; `count`, `percent` and measures without a scale keep the format.\n- **A format in `options`.** Symptom: the warning `format-unused`. Fix: set `measures[].format`.\n- **A percent without factor.** Symptom: a share prints 0.4% instead of 38.8%, and the warning `percent-scale-suspect` names the row. Fix: add `factor: 100` to the `div`.\n- **Unknown ids in facts.** Symptom: `invalid-data` with `Unknown member \'<id>\'; use the total id or a dimension.members id.` or `Unknown period \'<id>\'; use a periods id.` at `/data/facts/<index>`. Fix: use only the Total id, member ids from `dimension.members` and ids from `periods`.\n- **A narrow render.** Symptom: a KPI label is cut while its unit stays ("… USD"), or a wrapped label overlaps the change tag. Boardplot gives no warning for this yet. Cause: Range, vs prior and every period column keep their widths, and the label column takes the rest of the frame, up to `widths.label` (320 px). A render without `size` is about 780 px wide. Fix: give the table the width the page shows it at, at least the label width plus Range, vs prior and the period columns (about 1,050 px for 4 to 8 weeks), or shorten `unit`.\n- **Dates in the Range or vs prior sub-label.** Symptom: the warning `table-column-clipped` for column `range` or `pp` (the vs prior column), with a path such as `/data/columns/2/width` that does not exist in a dimswitch spec. Fix: widen `options.widths.range` or `options.widths.change`.\n- **Splits on in by-measure.** Symptom: the Total row of a split (New customers under Orders) comes after the member rows of its measure when that measure is open, at the member indent. This is a known layout limit of 0.24.0. Read splits in by-member, where each split sits directly under its measure.\n- **Averaging per-order lines of a statement over weeks.** Symptom: Range does not match the weeks, and the parts do not add up to the subtotal. Fix: supply the sums of each window and divide by the orders of the same window.\n- **Setting `sign: -1` on every cost part.** Symptom: in `signed` mode the parts print positive under a negative subtotal. Fix: set `sign: -1` on the subtotal only; a part inherits the sign of its subtotal.\n- **Authored costs that are already negative.** Symptom: a cost line adds to the result, and its effect has the wrong colour. Fix: supply costs as positive sums and use `sign: -1`.\n- **A per-unit line without a fixed format.** Symptom: a small per-order change fits inside the default 1% rounding limit. Fix: set `format: \"1.2\"` for fractional per-unit values, or omit `scale` to keep the format on every value.\n- **A result without a value.** Symptom: the schema refuses the measure. Fix: name the lines of the result in its `value` with `{ \"measure\": id }`.\n- **Effect thresholds from another unit.** Symptom: every cell is coloured, or none. Fix: set `thresholds.effect` in the currency and the denominator of the statement.',
    ],
  },
];

export const RECIPES = {
  column: [{ title: 'Dense value labels', text: ["The default `labelDensity: 'smart'` keeps every value eligible. In a chart with more than 12 categories, or with most labels wider than the band, the first, last, highest and lowest values (ties: the first) take their seats first, and the note names any of them that finds none. A smaller chart keeps every value on the one-step rule and names any that finds no seat. Other values use only their natural seat beside the mark, and are dropped without a note entry when it is taken. Stacked columns apply this rule to totals. Authored, highlighted and pinned values keep their rank. Use `labelDensity: 'full'` to treat all values alike and name every value without a seat. Labels need a free seat within one step of the natural seat. A value that fits can use an inside-end seat. Reading records keep every value."] }],
  bar: [{ title: 'Dense value labels', text: ["The default `labelDensity: 'smart'` keeps every value eligible. In a chart with more than 12 categories, or with most labels wider than the band, the first, last, highest and lowest values (ties: the first) take their seats first, and the note names any of them that finds none. A smaller chart keeps every value on the one-step rule and names any that finds no seat. Other values use only their natural seat beside the mark, and are dropped without a note entry when it is taken. Stacked bars apply this rule to totals. Use `labelDensity: 'full'` to treat all values alike and name every value without a seat. Reading records keep every value."] }],
  combo: [{ title: 'Overlay or dual axis', text: ["A combo draws `combo.overlay` when every series reads the primary axis, and `combo.dual-axis` when a line or area series sets `axis: 'secondary'` with an acknowledged `secondaryAxis` (a column series always draws on the primary axis). Revenue columns with a rolling-average line on one scale are `combo.overlay` (fixture `option-reference-line`). Revenue columns with a units line on its own scale are `combo.dual-axis` (fixture `revenue-units-secondary`)."] }, { title: 'Value labels and reference labels', text: ["Line endpoints and reference labels take seats before column values. Column values stay inside the plot band. They use their natural seat, one shifted seat, then an inside-end seat if one fill can hold them. The default `labelDensity: 'smart'` ranks the first, last, highest and lowest column totals first in a chart with more than 12 categories or with wide totals; the other totals use only their natural seat and are left out of the note when it is taken. Use `labelDensity: 'full'` to treat all totals alike. Reading records keep every value."] }],
  grid: [{
    title: 'Chart IDs and common combinations',
    text: [
      "A grid draws one of four chart IDs, set by its data and options. `grid.tiers`: two or more panels stacked on one shared category axis, `sharedAxis: 'category'`; variance panels under a base chart get it by default. `grid.facets`: small multiples, two or more columns of panels of one chart type that fills its slot, written out in `panels` or repeated from one template through `data.repeat`. `grid.metric-stack`: shared `measures` over shared `categories`, with `stack: {}`. `grid.panels`: every other grid, such as a mix of chart types, a single panel or an authored layout.",
      'The grid key merges entries of different panels only when they have the same label and draw the same colour. Series ids do not matter: two panels that name a series alike and colour it alike share one key entry, and the same label in two colours gives two entries.',
      'Common combinations are recipes, not chart types. Stacked revenue over a ΔPY% variance tier is `grid.tiers` (fixture `stacked-plus-dpy-tiered`). Small multiples by region are `grid.facets` (fixture `facet-regions`, or `repeat-regions` from one template). Volume over completed outcomes and a weighted conversion rate is `grid.metric-stack` (fixture `metric-stack-volume`). A KPI tile beside a waffle is `grid.panels` (fixture `kpi-and-waffle`).',
    ],
  }, {
    title: 'Metric stack',
    text: [
      'Set `stack: {}` to draw two to five panels in top-down order. Shared source counts produce both the marks and the left readouts. The optional period row, partial states, maturing scope and comparison windows belong to the grid. Each panel starts at zero on an independent scale.',
      'A sum uses one or more source measures; a multi-measure column is stacked. A rate divides the summed numerator by its denominator and multiplies by 100. `readout: "change"` gives whole-percent change of averages per category, or the difference of weighted rates after rounding each to one decimal. `readout: { base: "source-id" }` gives a weighted mature step rate and a remaining-per-100 chain. The table gives the formulas.',
      '| Readout | Headline | Span |\n|---|---|---|\n| `change`, sum measure | `(compare mean per category / base mean per category - 1) × 100`, rounded to whole percent | Base mean → compare mean, divided by the panel `divisor` and rounded to the panel `decimals` (whole counts by default), as the column labels print |\n| `change`, rate measure | Compare rate minus base rate, after each weighted rate is rounded to one decimal; rounded to one decimal pp | Base rate → compare rate, each rounded once from the unrounded weighted rate to the panel `decimals` (one by default) |\n| `{ "base": "measure-id" }`, rate measure | `100 × sum(numerator) / sum(denominator)` over mature categories, rounded to one decimal percent | `100 × sum(denominator) / sum(base)` → `100 × sum(numerator) / sum(base)` over the same categories |',
      'All sums use the source counts that draw the marks. Rates are weighted by volume, never the mean of the displayed category rates. The remaining-per-100 span uses one decimal, and a starting 100 prints as 100. A zero denominator or a missing input gives `n/a`, not zero.',
      'The stack is refused when a comparison window holds a partial or maturing category, when a partial category is in the maturing band, when the periods do not cover the categories once in order, or when a state scope skips a panel. A step chain is refused when its panels do not share one base measure and one state scope, or when a numerator exceeds its denominator.',
      'Set `data.windows.grain` to day, week, month, quarter or year to name the average unit. Without it, all category ids must match YYYY-MM for month, W01 or YYYY-W01 for week, Q1 or YYYY-Q1 for quarter, or YYYY for year. Week and quarter letters are case-insensitive. Other ids use “average per category”. Window labels do not set the grain. The change header appears only with change readouts.',
      'Use one readout method in each stack: every panel uses `change`, or every panel uses `{ base: "source-id" }`. A base readout stack must form one step chain from the same base measure and use the same state scopes. Do not mix the two methods.',
      'Default plot heights are 200 px for a single-measure column, 150 px for a stacked column, and 130 px for a line. These are minimum defaults: the engine increases them when names, units or readouts need more room. An authored fixed canvas with spare height expands the plots proportionally. `stack.heights` sets explicit plot heights; `rows` sets proportional weights based on the space the labels need.',
      'Use `stack.heights` for plot heights or `rows` for proportional heights. The engine reserves label space and shares one readout gutter and one panel gap. Side margins stay at most 24 px; an authored `margin` still wins. Where the gutter leaves too little room for the values, each readout moves above its panel and the plot takes the full width. Where even the full width is too little, values and category names thin to every second category, counted back from the latest, and the latest value always shows; a hidden name keeps its tick. A stacked panel keys its measures inside its readout; when its segment values do not all fit, none show and the key says that the labels show totals. Provisional columns are hatched in their own paint inside a dashed outline. It refuses dimensions that cause collisions. The maturing band covers all gaps between its scoped panels and ends at their last baseline. `reading.metricStack.readouts[]` exposes the inputs, `method` and `grain`. Count changes use `average-change`; rate changes use `rounded-rate-change`; step rates use `weighted-rate`. Every readout uses the explicit or inferred grain described above, with category as the fallback. Fixtures `metric-stack-volume` and `metric-stack-steps` show both full exhibits.',
    ],
    spec: {
      type: 'grid',
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar' }, { id: 'apr', label: 'Apr', partial: true }],
        measures: [{ id: 'started', label: 'Started', values: [800, 1000, 1100, 250] }, { id: 'finished', label: 'Finished', values: [160, 170, 121, null] }],
        panels: [
          { id: 'volume', type: 'column', title: 'Started', unit: 'cases per month', measure: { sum: ['started'] }, readout: 'change' },
          { id: 'rate', type: 'line', title: 'Completion', unit: '% of started cases', measure: { numerator: ['finished'], denominator: 'started' }, readout: 'change', emphasis: true },
        ],
        states: { maturing: { from: 'mar', to: 'mar', panels: ['rate'] }, partial: { panels: ['rate'] } },
        windows: { base: { from: 'jan', to: 'jan', label: 'January' }, compare: { from: 'feb', to: 'feb', label: 'February' } },
      },
      options: { stack: {}, size: { width: 900 }, title: 'Starts rise while completion falls', source: 'Invented example' },
    },
  }],
  cohort: [{
    title: 'Exclude a running period',
    text: [
      'On exhibit tables, `excludeCurrentPeriod: true` removes the newest cohort and the last observation of each earlier cohort. A disclosure names the removed cohort and explains both removals. Every render target keeps this disclosure with `footnotes: false`.',
      'The disclosure also appears in `reading.notes`. It does not add structured records for removed cells. `visiblePeriods` is a separate display filter.',
    ],
  }, {
    title: 'Cumulative conversion from counts',
    text: [
      'Set `strings.cohortMeasure` to the measure name and `strings.cohortFormula` to its formula sentence. The strings change the notes, key caption and accessible description. They do not change the calculation.',
      'Automatic exhibit formats keep the default rounding. A nonzero rate that would print as zero gets only the extra decimals needed to show a nonzero digit. Other rates keep their precision. Authored formats stay unchanged. A pure exhibit uses scientific notation for a zeroed rate only when its decimal text cannot fit.',
      'Bare rate cells get their unit once, in a header line that already exists: the stepped key caption ("Retention in %"), or the corner cell above the cohort labels in pure tables and stepped tables without a key. The default is `%`. A visible classic key keeps an authored unit there. Only structured fields count as showing the unit: `unitShown: true`, a value format that prints it, a custom measure or subtitle measure that names it, or `unit` with a subtitle. A % in the title or in another subtitle field does not count. If fitting cuts the subtitle, the header still names the unit. The table size, calculations and number formatting do not change.',
      'Keep `basis: "cohort"`. Put the eligible cohort count in `active[0]` and the cumulative converted count in each later period. Boardplot divides each later count by `active[0]`. Set `visiblePeriods` to the later periods so the base column does not appear as a conversion result. Short rows leave later periods unobserved. The fixtures `cumulative-conversion-pure` and `cumulative-conversion-stepped` show both exhibit styles.',
    ],
    spec: {
      type: 'cohort',
      data: { periodLabel: 'Week', cohorts: [{ id: 'a', label: 'Batch A', active: [1000, 5, 12] }, { id: 'b', label: 'Batch B', active: [800, 4] }] },
      options: { title: 'Cumulative conversion rises by the second week', variant: 'stepped', formatScope: 'classic', basis: 'cohort', unit: '%',
        visiblePeriods: [1, 2], steps: [0.5, 1, 2, 3], methodNote: true, size: { width: 1100 },
        strings: { cohortMeasure: 'Cumulative conversion', cohortFormula: 'Cumulative conversion = converted so far / cohort base.' } },
    },
  }],
  dimswitch: DIMSWITCH,
  table: [
    {
      title: 'A wide table at the width it is shown at',
      text: [
        'Pick the target and render the table at the width the page shows it at; let the rows set the height: `target: "report"` and `size: { width: 1050 }` for a 1,050 px report column. A table drawn at 1,233 px and scaled into that column by the host shrinks every font to 85 percent, more than the 10 percent a chart may shrink. Column `width`s spread the tracks across the frame; without them the table keeps its natural width and the rest of the frame stays margin.',
        'The target sets the text size. At 1,050 px a `report` table is in the M class: 15 px body and row labels, 14 px column heads. A dashboard table takes `target: "dashboard"`. `theme.overrides` still sets a role size in every width class, `type.label.size` for the body and the row labels and `type.axis.size` for the column heads; a size below the target\'s floor warns. Put the width the host shows the SVG at in `embed.width`: if the host still scales the table down, `type-below-effective-min` names the narrowest width at which the text stays readable.',
        'When the columns do not fit at that width, the size refusal names one minimum width, measured in the type the table uses at that width, and rendering at it works. If that is wider than the page, split the table or drop columns instead of scaling it down. The fixture `wide-at-destination-width` draws this table.',
      ],
      spec: {
        type: 'table',
        data: {
          columns: [
            { id: 'region', kind: 'rowLabel', label: 'Sales region', width: 210 },
            ...QUARTERS.map((label, index) => ({ id: `q${index + 1}`, kind: 'value', label, format: '1,234', width: 98 })),
          ],
          rows: [
            { id: 'north', label: 'North', cells: { q1: 1200, q2: 1305, q3: 1310, q4: 1415, q5: 1420, q6: 1425, q7: 1530, q8: 1535 } },
            { id: 'central', label: 'Central', cells: { q1: 1650, q2: 1655, q3: 1660, q4: 1665, q5: 1770, q6: 1775, q7: 1780, q8: 1785 } },
            { id: 'south', label: 'South', cells: { q1: 1880, q2: 1985, q3: 1990, q4: 1995, q5: 2040, q6: 2125, q7: 2130, q8: 2135 } },
            { id: 'west-coast', label: 'West coast', cells: { q1: 2190, q2: 2195, q3: 2280, q4: 2285, q5: 2290, q6: 2395, q7: 2400, q8: 2405 } },
            { id: 'east-coast', label: 'East coast', cells: { q1: 2440, q2: 2525, q3: 2530, q4: 2535, q5: 2620, q6: 2625, q7: 2630, q8: 2715 } },
            { id: 'islands', label: 'Islands', cells: { q1: 2750, q2: 2755, q3: 2760, q4: 2845, q5: 2870, q6: 2875, q7: 2960, q8: 2965 } },
          ],
        },
        options: {
          title: 'Every region sold more in 2026 than a year before',
          subtitle: { measure: 'Units sold', period: 'Q1 2025 to Q4 2026' },
          source: 'Synthetic data for an invented retailer',
          target: 'report',
          size: { width: 1050 },
          embed: { width: 1050 },
        },
      },
    },
    {
      title: 'Statements: signs, subtotals, results and drivers',
      text: [
        'A table prints an accounting statement, such as a P&L or a contribution-margin statement, from figures that the host supplies. Use it when the host has the figures, for example a P&L from the ledger. When Boardplot must compute the lines from additive sums per period, use a `dimswitch` statement instead: see [dimswitch](dimswitch.md#statements-subtotals-results-and-drivers).',
        'Four row fields make the statement:\n\n- `kind: "subtotal"`: a row that its children add up to, such as Cost of sales. It prints its label and figures at the theme weight `table.weights.subtotal` on the ground `table.grounds.subtotal`, and it folds like any parent.\n- `kind: "result"`: a row computed from rows above it with `calc`, such as Gross profit = `{ "op": "sub", "a": { "ref": { "row": "revenue" } }, "b": { "ref": { "row": "cogs" } } }`. It prints bold with a rule above it, and it stays where you put it: a result is never moved like a total. A result may read another result: EBIT = `{ "op": "sub", "a": { "ref": { "row": "gp" } }, "b": { "ref": { "row": "opex" } } }`; Boardplot evaluates them in order and refuses a cycle. `final: true` puts the closing rule under it (theme `table.finalRule`, a double rule by default).\n- `kind: "driver"`: a row that explains a line and is never added, such as units sold. It prints in italic in the driver ink. A driver that sits under a line shows the good, warn or bad tone of its figures; see `options.driverTones` below.\n- `sign: -1`: the row subtracts from its parent. Supply costs as positive figures and set `sign: -1` on the cost row. The contribution sign of a row is the product of the signs of the row and its additive parents, so the children of Cost of sales subtract too.',
        '`result` and `driver` rows are never added to a parent: they imply relation `displayOnly`, and Boardplot refuses another relation on them, because a result added to its parent counts the parent twice. `sign` needs relation `additive`. A `calc` reads the supplied values, before any sign: Gross profit = revenue − cost of sales, with cost of sales positive.',
        '`options.signs` decides how a sign prints. `"signed"` (the default) prints the figures of a row with contribution sign −1 negated, and its absolute changes too, so the column adds up from top to bottom; a relative or pp change and a ratio of two cells keep their sign, and a driver or result prints its own value. An arrow and a column sort follow the printed sign, while tone, heat and bars judge the figure you supplied. `"operators"` prints the figures as supplied and puts an operator before the label: − for `sign: -1`, = for a result, and `row.operator` where you set it (+, −, ×, ÷ or =). `"plain"` prints neither. A table without `sign: -1` rows prints the same in all three modes.',
        '`options.judgements: "exceptions"` keeps only the strong good and the bad colours; good and warn cells print neutral. Use it when a full heat map is too loud.',
        '`options.driverTones` decides whether a driver row shows the tones its figures earn. `"grouped"` (the default) shows them for a driver that has a `parentId` whose parent is not a section heading, as the lines of a statement do; a flat driver and a driver under a section heading keep the driver ink. `"always"` shows them for every driver, and `"never"` keeps the driver ink everywhere, as before 0.28. A neutral figure and the label keep the driver ink, and the italic face stays. A `dimswitch` statement takes the option too: its drivers sit under their lines, so they show their tones by default.',
        'Every colour, weight and rule of a table is a theme key, so the client decides the look. `table.inks` sets the inks of the heads, sub-labels, labels, child labels, figures, qualifiers, operators, drivers and fold toggles; for grey absolute numbers set `table.inks.figure`. `table.weights` sets the label weights of members, measures, subtotals and results, their figure weights in `figures`, the Range and vs prior block in `block`, and the change lines in `change`. `table.ruleWidths.head`, `table.resultRule`, `table.finalRule`, `table.driver.italic`, `table.qualifier`, `table.section.case`, `table.toggle`, `table.operator.width` and `table.grounds.subtotal` and `.total` set the rest. Every key has a default that keeps the drawing of 0.24.',
        '`tableLooks.sheet` from `boardplot` is a ready look: the report sheet with filled judgement cells, a 2 px head rule, grey subtotal grounds, bold results with a double closing rule and italic drivers. Use it as `theme: { "preset": "boardroom", "overrides": tableLooks.sheet }` and change any key on top of it. It is an option; no table takes it by default. Column heads print in capitals by default, and the text after the last comma stays as written (`Power,mW` prints `POWER,mW`); `table.head.case: "asis"` keeps the whole head as written ($k).',
      ],
      spec: {
        type: 'table',
        data: {
          columns: [
            { id: 'line', kind: 'rowLabel', label: '$k' },
            { id: 'fy25', kind: 'value', label: 'FY2025', format: '1,234' },
            { id: 'fy26', kind: 'value', label: 'FY2026', format: '1,234' },
            { id: 'chg', kind: 'computed', label: 'Change', calc: { op: 'delta', a: 'fy26', b: 'fy25' }, format: '+1,234' },
          ],
          rows: [
            { id: 'revenue', label: 'Revenue', kind: 'subtotal', children: [
              { id: 'product', label: 'Product sales', cells: { fy25: 8200, fy26: 9100 } },
              { id: 'services', label: 'Services', cells: { fy25: 1300, fy26: 1500 } },
              { id: 'units', label: 'Units sold (k)', kind: 'driver', cells: { fy25: 41, fy26: 45 } },
            ] },
            { id: 'cogs', label: 'Cost of sales', kind: 'subtotal', sign: -1, children: [
              { id: 'materials', label: 'Materials', cells: { fy25: 3900, fy26: 4300 } },
              { id: 'freight', label: 'Freight', cells: { fy25: 600, fy26: 700 } },
            ] },
            { id: 'gp', label: 'Gross profit', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'revenue' } }, b: { ref: { row: 'cogs' } } } },
            { id: 'opex', label: 'Operating expenses', kind: 'subtotal', sign: -1, children: [
              { id: 'staff', label: 'Staff', cells: { fy25: 2400, fy26: 2550 } },
              { id: 'marketing', label: 'Marketing', cells: { fy25: 900, fy26: 1150 } },
            ] },
            { id: 'ebit', label: 'EBIT', kind: 'result', final: true, calc: { op: 'sub', a: { ref: { row: 'gp' } }, b: { ref: { row: 'opex' } } } },
          ],
        },
        options: { title: 'EBIT rises 200 to 1,900 as revenue grows faster than costs', signs: 'signed' },
      },
    },
    {
      title: 'Group grounds, folds, frames and fitted formats',
      text: [
        'On every target, a missing input prints n/a (German k. A.) in values and calculations. A row keeps its missing glyph when it has no previous column in its group. A later 0/0 calculation prints n/a. A calculation skipped for an incompatible computed column keeps its placeholder. Explicit missing glyphs, nulls: blank, cohort density and table.noPrevious keep their existing missing-cell rules.',
        '`groupGround` decides which group rows carry the group ground (the emphasis and band grounds of the top two rungs, under a preset that draws them). `"expanded"` (the default, a 0.28 change) grounds only the header row of an open group, so a folded group row, and a leaf on its rung, look like normal rows; the Total keeps its own ground. `"always"` keeps the 0.27 look: every group row and every leaf on its rung, folded or open. `"none"` draws no group ground. The theme key `table.groupGround` sets the default for a look such as `sheet`; the table option wins. SVG and grid agree.',
        '`foldOn` (React) says what folds a parent row. `"row"`: a click on the row folds it, and selects it too where the host made it selectable. `"toggle"`: only the fold mark folds, and a row click only selects. The default is `"toggle"` for a selectable row (an `onRowSelect` host that does not narrow `isRowSelectable`) and `"row"` for any other row. Enter and Space on a cell do what the click does.',
        'A depth control writes `options.expansion.depth`: a number, `"all"`, or `"totals"`, the totals step that folds every parent and shows the totals and the section headings alone. A table without a total row keeps its level-0 rows, folded, under open section headings, so the step never leaves an empty body. In React a mounted table follows a new `expansion`: the reader\'s folds give way to it, while scroll and column toggles stay and the rows fold and open with their animation (none under reduced motion). When the row that holds the focus folds away, the focus moves to its parent. `onExpansionChange` reports each reader fold as an `expansion` (the authored lists rewritten); a control shows no depth pressed while the lists differ from the ones it wrote, and stores the report in the spec so that a later press of the same depth is a change. A `dimswitch` reports the fold through `onViewChange` (reason `"collapsed"`); a host that controls `collapsed` and sets it back to undefined gets the folds of the depth back.',
        'Under `rowExtent: "frame"` the rows reach the frame edge, and `frameFill` (default `"values"`) grows the value and computed tracks, in proportion to their widths and in whole px, until the columns end at that edge too: the row ground, the rules, the band columns and the cell tones all end together, and an authored `width` is a minimum. `frameFill: "none"` keeps the 0.27 look, where the columns keep their widths and an empty stretch carries the row ground and the rules to the edge. A table wider than its frame is not squeezed, and a right margin leaves its own empty stretch.',
        'A change line prints its authored format as authored: `+1.2k` prints `+1.4k`, `−0.4k` and `0.0k` for 1350, −360 and 10, and a signed or inline row never gets extra decimals. A level row keeps "nonzero stays nonzero", so a small money or count figure does not print as 0.',
        '`fitFormats` shortens a format until the widest figure fits an authored width. It gives every row of one format family (the same unit, prefix, suffix and magnitude) the same precision, so one column does not mix `−16k` over `12.4k`. It reports what it changed: the layout adds the info warning `table-formats-fitted`, whose `detail.changes` lists each row, column or cell with the example before (`from`, absent where it was derived) and after (`to`), and React calls `onFormatsFit(changes)` with the same list. `fitFormat: false` on a row or a column keeps its format as authored. Outside a fit, an authored format prints in its own magnitude: `$1.2k` prints 2,496,000 as 2,496.0 thousand, never as `$2.5M`.',
        'A table with no data row (no row at all, or only section headings and totals) keeps its head and draws one quiet row under it that says "No data to show." Folds and `rootsHidden` do not make a table empty. React calls `onEmpty` once, and `strings.emptyMessage` words the row; the static SVG draws the default wording. `canDraw(request)` answers `{ ok: false, code: "empty-data" }` for the same table, so a host can hide the card before it renders. `dimswitch` takes `onEmpty` too; it is empty only when it has no measure.',
        'Cell padding does not animate in the grid. A change of `cellPadX` and of the tracks in one render shows no moment where a head wraps on the old padding. A table that mounts does not animate its row heights; only a fold (the `max-height` of the children), the inline-lines switch and a column toggle animate, and `prefers-reduced-motion` turns those off.',
      ],
    },
    {
      title: 'Value bands and a pinned head',
      text: [
        'A numeric cell object takes `bands`: a list of ascending upper bounds `to` in the cell\'s own units, before display formatting, each with an optional `tone` (`good`, `warn`, `bad` or `neutral`) and a `label`. The cell takes the first band whose `to` is at or above its value; a value under the first bound takes the first band and a value over the last bound takes the last. Negative bounds and zero are fine. An explicit `tone` on the cell beats the bands, and the bands beat the automatic sign judgement of a change. A missing, n/a, n.m., suppressed or open cell is not judged, and a text cell ignores the bands. `muted`, a column `materiality` and `options.judgements` still apply. The label shows on hover and in the accessible table. `bands` colour a level; use `polarity` for the sign of a change.',
        '`stickyLabels: true` or a number keeps its meaning: the head and that many leading columns pin inside the table\'s own scroll box, which the host sizes (React `fillHeight`, or a height on the scroller). The object form names the parts: `{ "head": "table" | "page" | false, "columns": 1, "top": 0, "sections": false }`. `head: "page"` pins the head to the page scroll at `top` px, so it clears a host toolbar. The body then has no vertical scroll box, the head follows its sideways scroll, and no ancestor between the table and the scrolling page may set `overflow`, because it would capture the sticky head. Page mode is refused with `fillHeight`; the refusal names the fix. `sections: true` keeps the label of the section in view under the head until the next section starts, or until the table ends. `top` above 0 needs `head: "page"`. A `dimswitch` takes the object too and keeps its own pinned column count (3, or 4 with a plan column) unless you set `columns`. Static SVG, PNG and PDF show the whole table and ignore sticky. Print turns sticky off.',
      ],
    },
  ],
  line: [
    {
      title: 'Trend lines',
      text: [
        'Set `trend: true` or `trend: { label: "Linear trend" }`. Each shown data series gets one ordinary least-squares fit. Reference-role series get none. The line uses the series colour and the theme reference dash. It covers the first to last non-null fitted point and is clipped to the value axis. The legend uses the label solver and prints the series name, signed slope and r². The label names the legend entries; it adds no text over the plot.',
        'Dates must be valid and strictly increasing. Regular month, quarter and year dates (all month starts or all month ends) fit on the calendar period index, so no month length is assumed, and the key says "per month", "per quarter" or "per year". A skipped period keeps its step: January to March is two months. These charts keep their spacing when the trend turns on. Dates exactly 7 days apart say "per week". Other dates use elapsed UTC days from the first shown category and say "per day"; turning the trend on gives their points exact date spacing. Other categories use their original positions and say "per period"; that means one category step. Nulls keep their x gap and do not enter the fit. The slope uses plotted value units, or index points under rebase100. Percent levels use percentage points (pp). r² describes fit strength; it does not establish a cause.',
        'At least three non-null values are needed in each fitted series. A shorter series gets no trend and warns `trend-undefined`. A flat series has slope zero and undefined r². Line and area variants support trends; stacked areas and bump refuse `trend-unsupported`. A window or zoom changes the shown range and therefore the fit. Min-max sampling of a long line only thins the drawn points: the fit still reads every source value in the shown range, so the slope does not depend on the chart width. The fit includes supplied forecast values but does not extrapolate beyond the fitted range. The layout receipt `derived.trends` carries the slope, intercept, r², sample size and centred moments for each fit. CLI and MCP `reading.derived` list the slope, intercept and r².',
      ],
    },
    {
      title: 'Cycle bands',
      text: [
        'Named reference levels behind one long line: the regimes a growth rate moves between, such as a strong cycle, a typical cycle and a down cycle. Each band in `options.referenceBands` is one level (`value`) or a range (`low` and `high`) in the value-axis units. It draws as a thin neutral band across the plot, and its name stands in a column right of the plot, the bold `label` and then the plain `description`. Where the bands sit closer than the names are tall, the names spread apart and a thin elbow leader ties each one to its band. The leaders run between the plot and the column, so they never cross the line or each other.',
        'The callouts carry the story. `headline: "${value}"` prints the anchored value in bold over the plain `text`, so the number comes from the data, and `arrow: true` points a thin arrow from the text at the point. The latest value takes the period as its text.',
        'Keep to three or four bands; more than six is refused. Give each band its own span: overlapping bands warn `reference-band-overlap`. Name what the level means, not only its number, which the value axis already prints: a band named "45" alone warns `reference-band-unexplained`. A plan corridor or a target belongs in a `band` or `valueLine` annotation, not here. The fixture `cycle-bands` draws 583 monthly points the same way.',
      ],
      spec: {
        type: 'line',
        data: {
          categories: ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
          series: [{
            id: 'growth',
            label: 'Sensor-module sales growth',
            values: [-1, 2, 61, 14, -11, 7, 26, 3, -8, 19, 45, 52],
          }],
        },
        options: {
          title: 'Sensor-module growth in 2026 was the fastest since 2017',
          subtitle: { measure: 'Year-over-year sensor-module sales growth' },
          unit: '%',
          valueLabels: 'none',
          valueAxis: { gridlines: true },
          source: 'Synthetic data for an invented component industry',
          referenceBands: [
            { id: 'strong', value: 45, label: '45+', description: 'strong cycle' },
            { id: 'typical', low: 20, high: 25, label: '20 to 25', description: 'typical cycle' },
            { id: 'modest', low: -10, high: -5, label: '−5 to −10', description: 'modest down cycle' },
            { id: 'deep', value: -20, label: '−20', description: 'deep down cycle' },
          ],
        },
        annotations: [
          { kind: 'callout', at: '2017', headline: '${value}', text: 'Peak in handheld-loom demand', arrow: true },
          { kind: 'callout', at: '2026', headline: '${value}', text: '2026', preferSide: 'right' },
        ],
      },
    },
  ],
};
