/**
 * Autopilot: keeps the leaderboard fresh without anyone pressing Re-run. A Manyfold automation
 * calls POST /api/engine/autopilot on its own schedule; each call starts the next vertical in
 * rotation, unless one is still running or the last one started under AUTOPILOT_MIN_GAP_HOURS
 * ago. The gap is enforced here, so a stray or repeated call costs nothing.
 */

import { AUTOPILOT_MIN_GAP_HOURS, VERTICALS, type Autopilot, type Run } from '../../shared/engine';
import { getSetting, setSetting } from '../db';
import type { Env } from '../types';
import { newRun } from './runner';
import { activeRuns, addEvent, insertRun, readyEngines } from './store';
import { tickerFor } from './ticker';

const KEY = 'autopilot';
const DEFAULT: Autopilot = { enabled: true, next: 0, lastAt: null, lastRunId: null, lastPingAt: null, lastPingResult: null };

export async function loadAutopilot(env: Env): Promise<Autopilot> {
  try {
    return { ...DEFAULT, ...JSON.parse((await getSetting(env, KEY)) ?? '{}') };
  } catch {
    return DEFAULT;
  }
}

export const saveAutopilot = (env: Env, value: Autopilot) => setSetting(env, KEY, JSON.stringify(value));

export type AutopilotOutcome =
  | { started: true; run: Run }
  | { started: false; reason: 'paused' | 'no_engines' | 'running' | 'too_soon'; detail: string };

export async function autopilotTick(env: Env): Promise<AutopilotOutcome> {
  const outcome = await tryStart(env);
  // Record every call, so Settings can tell "the automation stopped calling" from "it called and skipped".
  const state = await loadAutopilot(env);
  await saveAutopilot(env, { ...state, lastPingAt: new Date().toISOString(), lastPingResult: outcome.started ? 'started' : outcome.reason });
  return outcome;
}

async function tryStart(env: Env): Promise<AutopilotOutcome> {
  const state = await loadAutopilot(env);
  if (!state.enabled) return { started: false, reason: 'paused', detail: 'Autopilot is paused in Settings.' };
  const engines = await readyEngines(env);
  if (!engines.length) return { started: false, reason: 'no_engines', detail: 'No scout agents are assigned.' };
  const busy = (await activeRuns(env)).find((r) => r.kind === 'vertical');
  if (busy) return { started: false, reason: 'running', detail: `${busy.vertical} is still running (${busy.id}).` };
  if (state.lastAt && Date.now() - Date.parse(state.lastAt) < AUTOPILOT_MIN_GAP_HOURS * 3_600_000) {
    return { started: false, reason: 'too_soon', detail: `The last automatic run started at ${state.lastAt}; the minimum gap is ${AUTOPILOT_MIN_GAP_HOURS} hours.` };
  }

  const vertical = VERTICALS[state.next % VERTICALS.length];
  const run = newRun('vertical', { vertical, engines });
  await insertRun(env, run);
  await addEvent(env, run.id, `Automatic refresh, started by the Manyfold automation: all ${run.questions.length} ${vertical.replace('_', ' ')} questions.`);
  await tickerFor(env, run.id).start(run.id, 0);
  await saveAutopilot(env, { ...state, next: (state.next + 1) % VERTICALS.length, lastAt: run.startedAt, lastRunId: run.id });
  return { started: true, run };
}
