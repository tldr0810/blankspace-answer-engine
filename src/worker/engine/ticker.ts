/**
 * RunTicker: one Durable Object per run, whose alarm drives the runner. Each alarm is a fresh
 * invocation with its own subrequest budget, does one tick and sets the next alarm. Alarms
 * survive deploys; the cron trigger re-arms any run whose alarm was lost.
 */

import { DurableObject } from 'cloudflare:workers';
import { ensureSchema } from '../db';
import type { Env } from '../types';
import { tick } from './runner';

export class RunTicker extends DurableObject<Env> {
  async start(runId: string, delayMs = 0): Promise<void> {
    await this.ctx.storage.put('runId', runId);
    const at = Date.now() + delayMs;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const runId = await this.ctx.storage.get<string>('runId');
    if (!runId) return;
    await ensureSchema(this.env.DB);
    const wait = await tick(this.env, runId);
    if (wait !== null) await this.ctx.storage.setAlarm(Date.now() + Math.max(wait, 200));
  }
}

export const tickerFor = (env: Env, runId: string) => env.RUN_TICKER.get(env.RUN_TICKER.idFromName(runId));
