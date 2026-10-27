import type { ReactNode } from 'react';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Theme } from '../core/types/theme';
import { messageText } from '../core/diagnostics/describe';

function json(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Raw values stay selectable and preserve their line breaks. */
function Raw({ value }: { value: unknown }) {
  return <code style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{json(value)}</code>;
}

function Finding({ findings }: { findings: readonly DocumentFinding[] }) {
  const first = findings[0]!;
  const rows: [string, ReactNode][] = [];
  for (const finding of findings) {
    rows.push([finding.path || '(root)', <>{messageText(finding).replace(/\s+/g, ' ')}
      {finding.received !== undefined && <div>Received: <Raw value={finding.received} /></div>}</>]);
  }
  const expected = [...new Map(findings.filter(finding => finding.expected !== undefined).map(finding => [JSON.stringify(finding.expected), finding.expected])).values()];
  if (expected.length) rows.push(['Expected', <details><summary style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
    {first.expected?.types?.join(' | ') ?? first.expected?.condition ?? first.code}
  </summary><Raw value={expected.length === 1 ? expected[0] : expected} /></details>]);
  if (first.suggest) rows.push(['Suggest', first.suggest]);
  const patches = findings.flatMap(finding => finding.fix ?? []);
  if (patches.length) rows.push(['Fix', <Raw value={patches} />]);
  if (first.docs) rows.push(['Docs', <Raw value={first.docs} />]);
  return <li data-bp-finding="" style={{ marginBlock: 8 }}>
    <strong><Raw value={first.code} />{findings.length > 1 ? ` × ${findings.length}` : ''}</strong>
    <dl style={{ display: 'grid', gridTemplateColumns: '5.5rem minmax(0,1fr)', gap: '4px 8px', margin: 0 }}>
      {rows.map(([label, value], index) => <div key={index} style={{ display: 'contents' }}>
        <dt style={{ overflowWrap: 'anywhere' }}>{label.startsWith('/') || label.includes('.') ? <Raw value={label} /> : label}</dt>
        <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</dd>
      </div>)}
    </dl>
  </li>;
}

/** Only full mode mounts this component or loads it from a standalone chart. */
export default function DiagnosticDetails({ errors, theme, label, spec = false, message }: { errors: readonly DocumentFinding[]; theme: Theme; label: string; spec?: boolean; message?: string }) {
  const groups = new Map<string, DocumentFinding[]>();
  for (const error of errors) {
    const key = JSON.stringify([error.code, error.suggest]);
    const group = groups.get(key) ?? [];
    group.push(error);
    groups.set(key, group);
  }
  return <details data-bp-diagnostic-details="" style={{ fontFamily: theme.type.family, fontSize: 12, lineHeight: 1.45, color: theme.color.ink,
    borderInlineStart: `${theme.pattern.outlineStrokeWidth * 2}px solid ${theme.color.bad}`, paddingInlineStart: theme.space.labelPad }}>
    <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>{label} ({errors.length})</summary>
    {message && <p><Raw value={message} /></p>}
    {spec && <div style={{ fontSize: 14, fontWeight: 600 }}>Invalid chart specification</div>}
    <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
      {[...groups].map(([key, findings]) => <Finding key={key} findings={findings} />)}
    </ul>
  </details>;
}

