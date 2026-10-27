/**
 * Whether this process may send usage events, and the folder that holds the
 * user's choice. Telemetry is off until the user turns it on; every off switch
 * wins over a stored yes. A build whose compiled endpoint is empty sends
 * nothing, whatever the choice or the environment.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { UsageEvent } from './schema';

/**
 * The collector this build reports to. Empty: no code path sends a usage
 * event or a report, and no notice appears. It is set once the collector runs
 * (docs/TELEMETRY.md).
 */
export const TELEMETRY_ENDPOINT = '';

/** The version of the text the user agreed to (docs/TELEMETRY.md); a new text asks again. */
export const CONSENT_VERSION = 1;

export interface StoredChoice {
  choice?: 'on' | 'off';
  consentVersion?: number;
  /** A random UUID, replaced each calendar month, so no record links one install across months. */
  install?: string;
  installMonth?: string;
  decidedAt?: string;
  /** The CLI showed its stderr notice to a terminal. */
  noticeShown?: boolean;
  /** The MCP server passed its notice to an agent; that does not prove the user saw it. */
  agentNoticeShown?: boolean;
  /** The last event queued for sending. */
  lastEvent?: UsageEvent;
}

export type TelemetryReason = 'on' | 'not-chosen' | 'turned-off' | 'do-not-track' | 'env-off' | 'ci' | 'no-endpoint';

export interface TelemetryState {
  enabled: boolean;
  reason: TelemetryReason;
  endpoint: string;
  file: string;
  stored: StoredChoice;
}

type Env = Record<string, string | undefined>;

/** `<config dir>/boardplot/telemetry.json`: XDG_CONFIG_HOME, else %APPDATA% on Windows, else ~/.config. */
export function telemetryFile(env: Env = process.env): string {
  let base = env.XDG_CONFIG_HOME || (process.platform === 'win32' && env.APPDATA) || '';
  // homedir() throws where the user has no home (a container without HOME or a passwd entry).
  try { base ||= join(homedir(), '.config'); } catch { return ''; }
  return join(base, 'boardplot', 'telemetry.json');
}

/** Events wait here until one sender posts them. */
export const queueFile = (file: string) => join(dirname(file), 'telemetry-queue.jsonl');
/** What the last sender got back from the collector. */
export const deliveryFile = (file: string) => join(dirname(file), 'telemetry-delivery.json');

/** Set and not "0" or "false": the way DO_NOT_TRACK and CI flags are read across tools. */
function flag(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

const CI_VARS = ['CI', 'CONTINUOUS_INTEGRATION', 'BUILD_NUMBER', 'RUN_ID', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'TF_BUILD', 'JENKINS_URL', 'CODEBUILD_BUILD_ID', 'TEAMCITY_VERSION', 'BITBUCKET_BUILD_NUMBER'];

export function inCi(env: Env = process.env): boolean {
  return CI_VARS.some((name) => flag(env[name]));
}

export function readJson<T extends object>(file: string): Partial<T> {
  if (file === '') return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Partial<T> : {};
  } catch {
    return {};
  }
}

/** Write through a temporary file, so parallel CLI runs never leave half a file. */
export function writeChoice(file: string, stored: StoredChoice): void {
  if (file === '') throw new Error('Boardplot found no config folder: set XDG_CONFIG_HOME or HOME.');
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`);
  renameSync(temporary, file);
}

/**
 * The compiled endpoint, or the self-host override when the build has one.
 * An empty compiled endpoint stays empty: the override cannot switch on a
 * build that ships without a collector.
 */
export function endpointFor(env: Env = process.env, compiled = TELEMETRY_ENDPOINT): string {
  return compiled === '' ? '' : env.BOARDPLOT_TELEMETRY_ENDPOINT || compiled;
}

export function telemetryState(env: Env = process.env, compiled = TELEMETRY_ENDPOINT): TelemetryState {
  const file = telemetryFile(env);
  const stored = readJson<StoredChoice>(file) as StoredChoice;
  const endpoint = endpointFor(env, compiled);
  const reason: TelemetryReason = flag(env.DO_NOT_TRACK) ? 'do-not-track'
    : env.BOARDPLOT_TELEMETRY === '0' || env.BOARDPLOT_TELEMETRY?.toLowerCase() === 'false' ? 'env-off'
    : inCi(env) ? 'ci'
    : endpoint === '' ? 'no-endpoint'
    : file === '' ? 'not-chosen'
    : stored.choice === 'off' ? 'turned-off'
    : stored.choice === 'on' && stored.consentVersion === CONSENT_VERSION ? 'on'
    : 'not-chosen';
  return { enabled: reason === 'on', reason, endpoint, file, stored };
}

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);

/** The install ID of this month: a new random one on the first event of a month. */
export function currentInstall(state: TelemetryState): string {
  const month = thisMonth();
  if (state.stored.install && state.stored.installMonth === month) return state.stored.install;
  state.stored = { ...state.stored, install: randomUUID(), installMonth: month };
  try { writeChoice(state.file, state.stored); } catch { /* an unwritable folder gets a new ID per call */ }
  return state.stored.install!;
}

/** `boardplot telemetry on`: store the yes and the version of the text it answered. */
export function turnOn(env: Env = process.env): StoredChoice {
  const file = telemetryFile(env);
  const { noticeShown, agentNoticeShown } = readJson<StoredChoice>(file);
  const stored: StoredChoice = { choice: 'on', consentVersion: CONSENT_VERSION, decidedAt: today(), ...(noticeShown ? { noticeShown } : {}), ...(agentNoticeShown ? { agentNoticeShown } : {}) };
  writeChoice(file, stored);
  return stored;
}

/** `boardplot telemetry off`: store the no; delete the install ID, the queue and the last payload. */
export function turnOff(env: Env = process.env): StoredChoice {
  const file = telemetryFile(env);
  const stored: StoredChoice = { choice: 'off', decidedAt: today() };
  writeChoice(file, stored);
  rmSync(queueFile(file), { force: true });
  return stored;
}
