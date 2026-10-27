/**
 * `boardplot telemetry [status|on|off]`: the user's switch for usage counts
 * (docs/TELEMETRY.md). status prints the state, why, the file that holds the
 * choice, the exact last payload queued and what the collector answered.
 */
import { InputError, ok, type VerbResult } from './result';
import { requestErasure } from '../telemetry/send';
import { deliveryFile, readJson, telemetryState, turnOff, turnOn, type TelemetryReason } from '../telemetry/state';

export const TELEMETRY_SUBVERBS = ['status', 'on', 'off'] as const;

const WHY: Record<TelemetryReason, string> = {
  on: 'You turned it on. Turn it off with boardplot telemetry off.',
  'not-chosen': 'Off until you turn it on with boardplot telemetry on.',
  'turned-off': 'You turned it off.',
  'do-not-track': 'DO_NOT_TRACK is set; nothing is sent.',
  'env-off': 'BOARDPLOT_TELEMETRY=0 is set; nothing is sent.',
  ci: 'A CI environment variable is set; nothing is sent in CI.',
  'no-endpoint': 'This build has no collector; nothing is sent, whatever you choose.',
};

function status(): VerbResult {
  const state = telemetryState();
  // What the collector answered the last sender: status 204 means it stored the events.
  const delivery = readJson<{ day: string; events: number; status: number }>(deliveryFile(state.file));
  return ok({
    telemetry: state.enabled ? 'on' : 'off',
    reason: state.reason,
    why: WHY[state.reason],
    choice: state.stored.choice ?? 'none',
    file: state.file,
    endpoint: state.endpoint || null,
    ...(state.stored.install ? { install: state.stored.install } : {}),
    lastEvent: state.stored.lastEvent ?? null,
    lastDelivery: Object.keys(delivery).length ? delivery : null,
    docs: 'docs/TELEMETRY.md',
  });
}

export function telemetry(sub: string | undefined): VerbResult {
  switch (sub ?? 'status') {
    case 'status':
      return status();
    case 'on':
      turnOn();
      return status();
    case 'off':
      requestErasure(telemetryState());
      turnOff();
      return status();
    default:
      throw new InputError('invalid-argument', `boardplot telemetry takes status, on or off, not '${sub}'`, {
        suggest: 'Run boardplot telemetry status.',
      });
  }
}
