import { chartString } from '../../strings/pvm';
import { disclosureNote, engineNote, keepShownNotes } from '../../notes';
/**
 * PVM adapter. A price/volume/mix bridge IS a waterfall: a start
 * total, signed additive effects, an end total. This module therefore adds NO
 * geometry — it derives the decomposition, hands `layoutWaterfall` a fully
 * normalized bridge, and returns that geometry with the PVM derived record.
 *
 * Two audits run on every render, and they are independent:
 *   1. `assertReconciles` in decompose.ts, on the effects this module computed;
 *   2. `assertClosingLevel` below, on the level the HOST ENGINE accumulated
 *      from the bars it actually drew — i.e. on what the reader sees, not on
 *      what this module intended.
 *
 * Audit 2 is not delegated to waterfall's own `derived-mismatch` warning (by
 * supplying `currentRevenue` as the closing total's check value):
 * `derived-mismatch` compares with a FIXED ABSOLUTE epsilon of 1e-9, while a
 * decomposition assembled from divisions carries relative float error, so
 * billion-scale revenue books would trip it on arithmetic correct to 4e-15
 * relative or better: a magnitude check wearing a correctness check's clothes.
 * It would also print two identical numbers, because the host rounds one side
 * for display. The closing total is therefore left for the engine to compute
 * (so the drawn end column IS the sum of the drawn bars, by construction) and
 * the cross-check is made here, on the same RELATIVE basis the decomposition is audited on.
 *
 * The PVM contract is validated in full BEFORE delegating: an agent that
 * authored `items[].prior.qty` must never receive an error phrased in the host
 * chart's vocabulary.
 */

import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type { WaterfallData } from '../../types/data';
import type { WaterfallOptions } from '../../types/options';
import type { Geometry, LintWarning } from '../../types/scene';
import { layoutWaterfall, type WaterfallMarks } from '../waterfall/layout';
import {
  PVM_RESIDUAL_TOLERANCE,
  decomposePvm,
  pvmCoverageNote,
  pvmUnitBasisNote,
} from './decompose';
import type { PvmData, PvmDerived, PvmOptions } from './types';
import { authoredNotes, withAuthoredFootnotes, type InternalFootnoteOptions } from '../../frame';
import { resolveTheme } from '../../theme';

const PRIOR_ID = 'prior';
const CURRENT_ID = 'current';

export function layoutPvm(
  data: PvmData,
  options: PvmOptions = {},
): Geometry<WaterfallMarks, PvmDerived> {
  const interaction = options.interaction ?? 'in-price';
  if (interaction !== 'in-price' && interaction !== 'separate') {
    throw new NormalizeError(
      'pvm-interaction-invalid',
      'options.interaction',
      `interaction '${String(interaction)}' is not recognised`,
      "accepted values: 'in-price', 'separate'",
    );
  }
  const volumeMix = options.volumeMix ?? 'split';
  if (volumeMix !== 'split' && volumeMix !== 'combined') {
    throw new NormalizeError(
      'pvm-volume-mix-invalid',
      'options.volumeMix',
      `volumeMix '${String(volumeMix)}' is not recognised`,
      "accepted values: 'split', 'combined'",
    );
  }
  const { derived, notes } = decomposePvm(data, interaction, volumeMix, options);
  for (const effect of derived.effects) {
    if (effect.id === 'new') effect.label = options.strings?.newItems ?? effect.label;
    if (effect.id === 'lost') effect.label = options.strings?.lostItems ?? effect.label;
  }
  // Where Volume and Mix nearly cancel (their sum under a tenth of the
  // larger), the split between them is the whole story and rests on the
  // counting unit, so the method notes print whatever methodNote says.
  const volume = derived.effects.find((effect) => effect.id === 'volume')?.value;
  const mix = derived.effects.find((effect) => effect.id === 'mix')?.value;
  const cancels = volume !== undefined && mix !== undefined && Math.sign(volume) === -Math.sign(mix) && volume !== 0 &&
    Math.abs(volume + mix) < 0.1 * Math.max(Math.abs(volume), Math.abs(mix));
  const methodNote = options.methodNote === true || cancels;
  const warnings: LintWarning[] = notes.map((note) => ({
    code: note.code,
    severity: note.severity,
    message: note.message,
    ...(note.suggest ? { suggest: note.suggest } : {}),
  }));

  // Options the host does not know about are consumed here; everything the
  // host owns (title, unit, size, theme, highlight, ...) passes through.
  const {
    interaction: _interaction,
    volumeMix: _volumeMix,
    methodNote: _methodNote,
    netChange,
    ...pass
  } = options;

  const note =
    volumeMix === 'combined'
      ? interaction === 'separate'
        ? chartString(options, 'pvmMethodNoteCombinedSeparate')
        : chartString(options, 'pvmMethodNoteCombined')
      : interaction === 'separate'
        ? chartString(options, 'pvmMethodNoteSeparate')
        : chartString(options, 'pvmMethodNoteInPrice');
  // The convention and the unit basis are method notes, printed on
  // request. Coverage is required for interpretation while items enter or
  // leave the book: price, volume and mix then speak for part of the revenue
  // only, and bars drawn correctly would be read as the whole.
  derived.methodNote = methodNote ? note : null;
  derived.unitBasisNote = methodNote && volumeMix === 'split' ? pvmUnitBasisNote(derived.quantityUnit ?? undefined, options) : null;
  const partialCoverage = derived.new.length > 0 || derived.lost.length > 0;
  derived.coverageNote = methodNote || partialCoverage
    ? pvmCoverageNote(derived.common.length, derived.commonPriorShare, derived.commonCurrentShare, options)
    : null;

  const bridge: WaterfallData = {
    items: [
      { id: PRIOR_ID, label: data.priorLabel ?? chartString(options, 'prior'), type: 'total', value: derived.priorRevenue, date: data.priorDate },
      ...derived.effects.map((effect) => ({ id: effect.id as Id, label: effect.label, value: effect.value })),
      // No check value: the engine accumulates the closing level from the bars
      // it draws, so the end column IS the sum of the effects by construction.
      // The cross-check happens below, on a relative basis — see the header.
      { id: CURRENT_ID, label: data.currentLabel ?? chartString(options, 'current'), type: 'total', date: data.currentDate },
    ],
  };

  const prices = chartString(options, volumeMix === 'combined' ? 'pvmConventionShortCombined' : 'pvmConventionShort');
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const basisShort = derived.unitBasisNote
    ? chartString(options, 'pvmBasisNote', { v1: derived.quantityUnit ? chartString(options, 'quantityUnit', { v1: derived.quantityUnit }) : chartString(options, 'noCountingUnit') })
    : null;
  const coverageShort = chartString(options, 'pvmCoverageShort', { v1: derived.common.length === 1 ? chartString(options, 'oneItem') : chartString(options, 'itemsCount', { v1: derived.common.length }) });
  // The footer prints ONE short line,
  // "Covers the 4 items in both periods; volume and mix at prior prices.",
  // in place of three long method notes. The coverage half is a disclosure:
  // the reader needs it while items enter or leave the book. The
  // convention half is what methodNote asks for. Where volume and mix cancel
  // the unit basis decides the split, so its short form prints too.
  // The long texts stay in `derived`; they join the notes list only when the
  // author sets `notes` (a host that builds a notes panel or backup slide),
  // because static output prints every listed note in full.
  const convention = interaction === 'separate' ? `${prices}; ${chartString(options, 'pvmPriceAtPriorShort')}` : prices;
  const shortLine = [
    ...(partialCoverage ? [coverageShort.replace(/\.$/, '')] : []),
    ...(methodNote ? [convention] : []),
  ];
  const listed = options.notes !== undefined;
  const footnotes = [
    ...authoredNotes(options),
    ...(shortLine.length > 0 ? [disclosureNote(`${capital(shortLine.join('; '))}.`)] : []),
    ...(cancels && basisShort ? [disclosureNote(basisShort)] : []),
    ...(listed && methodNote ? [engineNote(note, 'method')] : []),
    ...(listed && derived.unitBasisNote ? [engineNote(derived.unitBasisNote, 'method')] : []),
    ...(listed && derived.coverageNote ? [engineNote(derived.coverageNote, 'method')] : []),
  ];

  // A step highlight on a bridge coloured by sign would read as a third kind
  // of step, neither gain nor loss.
  const signBridge = (resolveTheme(options.theme).marks?.bridge ?? (options.palette === undefined ? 'sign' : undefined)) === 'sign';
  if (signBridge && options.highlight !== undefined) {
    warnings.push({
      code: 'pvm-highlight-on-sign',
      severity: 'error',
      message: 'pvm colours every effect by its sign, so a highlight colour would read as a third kind of step, neither gain nor loss',
      suggest: 'Drop highlight and name the step in the title, or name a palette so the steps stop taking their sign\'s colour.',
      field: ['options', 'highlight'],
      fix: [{ op: 'remove', path: '/options/highlight' }],
    });
  }

  // Only the author's own notes keep a number; the rest are derived.
  // Effects take their sign's colour unless the theme or a named palette says otherwise.
  const hostOptions: WaterfallOptions = withAuthoredFootnotes({
    ...(keepShownNotes(options, pass) as WaterfallOptions),
    ...(options.palette === undefined ? { bridgeDefault: 'sign' } : {}),
    ...(netChange !== false ? { closingChange: { delta: derived.delta, base: derived.priorRevenue } } : {}),
    ...(options.valueAxis?.break === undefined && baseSwampsSteps(derived)
      ? { valueAxis: { ...options.valueAxis, break: 'auto' as const } }
      : {}),
  }, footnotes, (options as InternalFootnoteOptions).authoredFootnotes ?? options.footnotes);

  const geometry = layoutWaterfall(bridge, hostOptions);

  assertClosingLevel(geometry, derived);

  return {
    ...geometry,
    // The net change label prints the claim `pvm:delta`.
    labels: geometry.labels.map((label) => (label.id.startsWith('net:') ? { ...label, claimId: 'pvm:delta' } : label)),
    type: 'pvm',
    derived,
    warnings: [...warnings, ...geometry.warnings],
  };
}

/**
 * True when a whole axis would spend the plot on the two totals: the smaller
 * total is over 10 times the largest step, or the running levels span under
 * a fifth of the larger total. An absent `valueAxis.break` then resolves to
 * 'auto', which the host still draws only where a break is safe.
 */
function baseSwampsSteps(derived: PvmDerived): boolean {
  const totalLo = Math.min(derived.priorRevenue, derived.currentRevenue);
  const totalHi = Math.max(derived.priorRevenue, derived.currentRevenue);
  let level = derived.priorRevenue;
  let runLo = level;
  let runHi = level;
  let maxStep = 0;
  for (const effect of derived.effects) {
    level += effect.value;
    runLo = Math.min(runLo, level);
    runHi = Math.max(runHi, level);
    maxStep = Math.max(maxStep, Math.abs(effect.value));
  }
  if (!(totalLo > 0) || !(maxStep > 0)) return false;
  return totalLo > 10 * maxStep || runHi - runLo < 0.2 * totalHi;
}

/**
 * Audit 2. The host engine accumulated the closing level from the bars it
 * actually drew; this compares that level with the current-period revenue this
 * module summed from the raw items. Same RELATIVE basis as `assertReconciles`,
 * so a correct decomposition cannot be refused for being large.
 */
export function assertClosingLevel(
  geometry: Geometry<WaterfallMarks, object>,
  derived: PvmDerived,
): void {
  const totals = (geometry.derived as { totals?: Record<string, number> } | undefined)?.totals;
  const drawn = totals?.[CURRENT_ID];
  if (typeof drawn !== 'number') {
    throw new NormalizeError(
      'pvm-residual',
      'items',
      'the host bridge produced no closing level for the drawn effects, so the decomposition could not be re-audited against the picture',
      'this is an engine defect, not an input problem — report the dataset',
    );
  }
  const gap = drawn - derived.currentRevenue;
  const scale = Math.max(1, Math.abs(drawn), Math.abs(derived.currentRevenue));
  if (!Number.isFinite(gap) || Math.abs(gap) > PVM_RESIDUAL_TOLERANCE * scale) {
    throw new NormalizeError(
      'pvm-residual',
      'items',
      `the drawn bridge does not land on the current-period revenue: prior ${derived.priorRevenue} plus the drawn effects ` +
        `reaches ${drawn}, but the items sum to ${derived.currentRevenue} (gap ${gap}, tolerance ${PVM_RESIDUAL_TOLERANCE * scale})`,
      'this is an engine defect, not an input problem — report the dataset',
    );
  }
}
