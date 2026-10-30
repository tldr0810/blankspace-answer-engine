/**
 * Keeping cited sources honest. Every page an AI answer cited is opened by code: a page that is
 * gone or no longer covers the question drops out of the counts. Runs check their own pages
 * before scoring; the cron re-checks the rest, oldest first, so the leaderboard stays current.
 */

import type { Env } from '../types';
import { checkPage } from './fetchers';
import { pagesToCheck, savePageCheck, stalePages } from './store';

/** Pages older than this are checked again. */
export const RECHECK_DAYS = 7;
/** Pages the sweep opens each hour (the cron fires every 5 minutes for the run safety net): about 600 a day. */
const SWEEP_PER_TICK = 25;
const PARALLEL = 5;

export const staleBefore = () => new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();

export async function checkPages(env: Env, items: { url: string; queries: string[] }[]) {
  const results = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    const batch = await Promise.all(items.slice(i, i + PARALLEL).map((item) => checkPage(item.url, item.queries)));
    for (const [j, check] of batch.entries()) await savePageCheck(env, { ...check, queries: items[i + j].queries });
    results.push(...batch);
  }
  return results;
}

/**
 * Cron: re-check the cited pages that are due. Every hour it takes the oldest checked pages
 * through the checked_at index. Once a day it also looks for cited pages no run ever checked
 * (a run that stopped before scoring), which needs a pass over every answer.
 */
export async function sweepSources(env: Env, at = new Date()): Promise<number> {
  if (at.getUTCMinutes() >= 5) return 0;
  const due = at.getUTCHours() === 3
    ? await pagesToCheck(env, { staleBefore: staleBefore(), limit: SWEEP_PER_TICK })
    : await stalePages(env, { staleBefore: staleBefore(), limit: SWEEP_PER_TICK });
  await checkPages(env, due);
  return due.length;
}
