/**
 * `boardplot feedback` and the `boardplot_feedback` tool: a structured
 * problem report the user reads before Boardplot sends it anywhere. Both
 * return the report and a prefilled GitHub issue link that the user opens and
 * submits. Only the CLI with `--send` posts it, after the user typed or
 * approved that command; the MCP tool only drafts, because an agent's call
 * does not prove the user approved the text.
 */
import { canonicalChartType } from '../core/registry';
import { InputError, ok, type VerbResult } from '../cli/result';
import { nodeMajor, osFamily, releaseVersion } from './event';
import { CODE_PATTERN, FEEDBACK_CATEGORIES, feedbackReportSchema, OPTION_KEY_PATTERN, SUMMARY_MAX, type FeedbackReport } from './schema';
import { sendFeedback } from './send';

export const ISSUES_URL = 'https://github.com/boardplot/boardplot/issues/new';

export interface FeedbackArgs {
  category?: unknown;
  summary?: unknown;
  type?: unknown;
  codes?: unknown;
  optionKeys?: unknown;
  send?: unknown;
  surface: FeedbackReport['surface'];
}

function names(value: unknown, pattern: RegExp, field: string): string[] {
  if (value === undefined) return [];
  const list = typeof value === 'string' ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : value;
  if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string' && pattern.test(entry))) {
    throw new InputError('invalid-argument', `${field} takes names as Boardplot spells them (${pattern}), not text`, {
      path: `/${field}`, suggest: `Pass only ${field === 'codes' ? 'warning and error codes such as label-dropped' : 'option key names such as valueAxis'}.`,
    });
  }
  return [...new Set(list as string[])].sort();
}

export function feedbackReport(args: FeedbackArgs): FeedbackReport {
  if (typeof args.category !== 'string' || !(FEEDBACK_CATEGORIES as readonly string[]).includes(args.category)) {
    throw new InputError('invalid-argument', `category must be one of ${FEEDBACK_CATEGORIES.join(', ')}`, { path: '/category', suggest: 'Pass --category bug, friction or docs.' });
  }
  if (typeof args.summary !== 'string' || !args.summary.trim()) {
    throw new InputError('invalid-argument', 'summary is required: one line on what went wrong', { path: '/summary', suggest: 'Describe the Boardplot problem without client names, numbers, labels or paths.' });
  }
  let type: string | undefined;
  if (args.type !== undefined) {
    type = typeof args.type === 'string' ? canonicalChartType(args.type) : undefined;
    if (!type) throw new InputError('invalid-argument', 'type must be a chart type from boardplot list', { path: '/type' });
  }
  const report = {
    v: 1 as const,
    version: releaseVersion(),
    surface: args.surface,
    os: osFamily(),
    node: nodeMajor(),
    category: args.category as FeedbackReport['category'],
    ...(type ? { type } : {}),
    optionKeys: names(args.optionKeys, OPTION_KEY_PATTERN, 'optionKeys'),
    codes: names(args.codes, CODE_PATTERN, 'codes'),
    summary: args.summary.trim(),
  };
  const parsed = feedbackReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new InputError('invalid-argument', `summary must be one line of plain text of at most ${SUMMARY_MAX} characters`, { path: '/summary' });
  }
  return parsed.data;
}

/** A GitHub "new issue" link with the report as title and body; the user submits it on GitHub. */
export function issueUrl(report: FeedbackReport): string {
  const title = `${report.category}: ${[...report.summary].slice(0, 80).join('')}`;
  const body = [
    report.summary,
    '',
    `- Version: ${report.version} (${report.surface})`,
    `- OS: ${report.os}, Node ${report.node}`,
    ...(report.type ? [`- Chart type: ${report.type}`] : []),
    ...(report.optionKeys.length ? [`- Options: ${report.optionKeys.join(', ')}`] : []),
    ...(report.codes.length ? [`- Codes: ${report.codes.join(', ')}`] : []),
    '',
    'Sent with boardplot feedback. Add a spec with invented data if it helps reproduce the problem.',
  ].join('\n');
  return `${ISSUES_URL}?${new URLSearchParams({ title, body }).toString()}`;
}

export function feedback(args: FeedbackArgs): VerbResult {
  const report = feedbackReport(args);
  const link = issueUrl(report);
  if (args.surface === 'mcp') {
    return ok({
      sent: false, report, issueUrl: link,
      next: 'Show the user the report and issueUrl. The user opens the link, checks the text and submits the issue on GitHub; GitHub issues are public.',
    });
  }
  if (args.send !== true) {
    return ok({
      sent: false, report, issueUrl: link,
      next: 'Show the user the report. Run the command again with --send only after the user says yes to this exact text, or give the user issueUrl to submit on GitHub.',
    });
  }
  const sent = sendFeedback(report);
  return ok(sent.sent ? { sent: true, report, ...(sent.id ? { id: sent.id } : {}) } : {
    sent: false, reason: sent.reason, report, issueUrl: link,
    next: sent.reason === 'no-collector'
      ? 'This build has no feedback collector. Give the user issueUrl to submit the report on GitHub.'
      : 'Sending failed. Give the user issueUrl to submit the report on GitHub.',
  });
}
