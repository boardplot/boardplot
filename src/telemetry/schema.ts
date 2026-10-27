/**
 * The only two payloads Boardplot sends (docs/TELEMETRY.md). Both schemas are
 * strict: a field outside them fails the parse and nothing is sent, so a
 * caller cannot slip chart data, a label or a path into a payload. The
 * collector checks the same fields and patterns again.
 */
import * as z from 'zod';

/** Registered chart type names, or "other". */
export const TYPE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
/** Option key names as the schemas spell them: letters and digits, no paths or spaces. */
export const OPTION_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
/** Warning and error codes as the engine spells them. */
export const CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export const COMMANDS = ['list', 'describe', 'fixtures', 'render', 'measure', 'fonts', 'feedback'] as const;
export const OS_FAMILIES = ['darwin', 'linux', 'win32', 'other'] as const;
/** The agent or editor that ran Boardplot, as a fixed category; never its own name or version. */
export const HOSTS = ['claude-code', 'claude-app', 'codex', 'cursor', 'vscode', 'gemini', 'other', 'none'] as const;
export const FORMATS = ['svg', 'png', 'none'] as const;
export const FEEDBACK_CATEGORIES = ['bug', 'friction', 'docs'] as const;
export const SUMMARY_MAX = 280;

const surface = z.enum(['cli', 'mcp']);
const version = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/);
const os = z.enum(OS_FAMILIES);
const node = z.number().int().min(0).max(99);
const optionKeys = z.array(z.string().regex(OPTION_KEY_PATTERN)).max(64);
const codes = z.array(z.string().regex(CODE_PATTERN)).max(32);

export const usageEventSchema = z.strictObject({
  v: z.literal(1),
  /** A random UUID, replaced each calendar month; `telemetry off` deletes it. */
  install: z.uuid({ version: 'v4' }),
  version,
  surface,
  command: z.enum(COMMANDS),
  types: z.array(z.string().regex(TYPE_PATTERN)).max(20),
  optionKeys,
  codes,
  ok: z.boolean(),
  /** The render output format; none for every other command. */
  format: z.enum(FORMATS),
  host: z.enum(HOSTS),
  os,
  node,
});

export const feedbackReportSchema = z.strictObject({
  v: z.literal(1),
  version,
  surface,
  os,
  node,
  category: z.enum(FEEDBACK_CATEGORIES),
  type: z.string().regex(TYPE_PATTERN).optional(),
  optionKeys,
  codes,
  summary: z.string().trim().min(1).refine((text) => [...text].length <= SUMMARY_MAX && !/[\u0000-\u001f\u007f]/.test(text), {
    message: `summary is one line of plain text of at most ${SUMMARY_MAX} characters`,
  }),
});

export type UsageEvent = z.infer<typeof usageEventSchema>;
export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
