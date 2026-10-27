/** Authored reader copy for React placeholders; kept outside layout strings. */
const READER_EN = {
  refusalMessage: 'This chart needs more room.',
  refusalHint: 'Widen the panel or turn your device.',
  emptyMessage: 'No data to show.',
  emptyHint: 'Try another date range or filter.',
  failureMessage: 'This chart cannot be shown.',
  failureHint: 'Tell the report owner.',
  diagnosticDetails: 'Details',
};
const READER_DE: typeof READER_EN = {
  refusalMessage: 'Dieses Diagramm braucht mehr Platz.',
  refusalHint: 'Verbreitern Sie den Bereich oder drehen Sie Ihr Gerät.',
  emptyMessage: 'Keine Daten vorhanden.',
  emptyHint: 'Wählen Sie einen anderen Zeitraum oder Filter.',
  failureMessage: 'Dieses Diagramm kann nicht angezeigt werden.',
  failureHint: 'Informieren Sie den Berichtsersteller.',
  diagnosticDetails: 'Details',
};
export type ReaderStrings = Partial<typeof READER_EN>;
export function readerStrings(language?: string): typeof READER_EN {
  return /^de(?:[-_]|$)/i.test(language ?? '') ? READER_DE : READER_EN;
}
