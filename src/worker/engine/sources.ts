/**
 * Keeping cited sources honest. Every page an AI answer cited is opened by code: a page that is
 * gone or no longer covers the question drops out of the counts. Runs check their own pages
 * before scoring; the cron re-checks the rest, oldest first, so the leaderboard stays current.
 */

import type { Env } from '../types';
import { checkPage } from './fetchers';
import { pagesToCheck, savePageCheck } from './store';

/** Pages older than this are checked again. */
export const RECHECK_DAYS = 7;
/**
 * Finding due pages scans every cited page, so the sweep runs once an hour (the cron fires every
 * 5 minutes for the run safety net) and opens this many pages: about 600 a day.
 */
const SWEEP_PER_TICK = 25;
const PARALLEL = 5;

export const staleBefore = () => new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();

export async function checkPages(env: Env, items: { url: string; queries: string[] }[]) {
  const results = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    const batch = await Promise.all(items.slice(i, i + PARALLEL).map((item) => checkPage(item.url, item.queries)));
    for (const check of batch) await savePageCheck(env, check);
    results.push(...batch);
  }
  return results;
}

/** Cron: re-check the cited pages that were never checked or are due again. */
export async function sweepSources(env: Env, at = new Date()): Promise<number> {
  if (at.getUTCMinutes() >= 5) return 0;
  const due = await pagesToCheck(env, { staleBefore: staleBefore(), limit: SWEEP_PER_TICK });
  await checkPages(env, due);
  return due.length;
}
