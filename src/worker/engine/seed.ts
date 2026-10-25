/**
 * The first run, bundled: 75 buying questions asked to a Claude and a Gemini agent on
 * Manyfold on 21 October 2026, with the site checks, profiles and fact-check verdicts from
 * that run. It gives the leaderboard something real on a fresh deploy; every live run after
 * it replaces the vertical's board.
 */

import { QUESTIONS, VERTICALS, type Engine, type Lead, type SiteFacts, type Vertical } from '../../shared/engine';
import type { Env } from '../types';
import { draftEmail, tally, type Answer } from './logic';
import seed from './seed.json';
import { insertAnswers, insertLead, insertRun, saveFacts } from './store';

interface SeedLead {
  domain: string;
  score: number;
  owner: string | null;
  companyType: string | null;
  monetisation: string | null;
  aiDeal: string | null;
  contactRole: string | null;
  contactName: string | null;
  contactSourceUrl: string | null;
  why: string | null;
  verdict: Lead['verdict'];
  verifyNote: string | null;
}

interface SeedFile {
  runAt: string;
  verticals: Record<Vertical, { answers: Answer[]; sites: Omit<SiteFacts, 'checkedAt'>[]; leads: SeedLead[] }>;
}

let seeding: Promise<void> | null = null;

export function ensureSeed(env: Env, origin: string): Promise<void> {
  if (!seeding) {
    seeding = (async () => {
      const { results: seeded } = await env.DB.prepare('SELECT id FROM runs WHERE seed = 1').all<{ id: string }>();
      const done = new Set(seeded.map((r) => r.id));
      const data = seed as unknown as SeedFile;
      const engines: Engine[] = ['claude', 'gemini'];
      for (const vertical of VERTICALS) {
        const runId = `seed_${vertical}`;
        if (done.has(runId)) continue;
        const block = data.verticals[vertical];
        // The run row goes in last, so a vertical cut off mid-seed is cleared and seeded again.
        await env.DB.batch(
          ['answers', 'leads', 'events'].map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE run_id = ?`).bind(runId)),
        );
        const run = {
          id: runId,
          kind: 'vertical',
          vertical,
          domain: null,
          questions: QUESTIONS[vertical],
          engines,
          status: 'done',
          step: 'done',
          stepDetail: null,
          seed: true,
          startedAt: data.runAt,
          finishedAt: data.runAt,
          error: null,
        } as const;
        await insertAnswers(env, runId, block.answers);
        for (const site of block.sites) await saveFacts(env, { ...site, checkedAt: data.runAt });
        const rows = tally(block.answers);
        const total = block.answers.length;
        const byDomain = new Map(rows.map((r) => [r.domain, r]));
        const facts = new Map(block.sites.map((s) => [s.domain, s]));
        for (const lead of block.leads) {
          const row = byDomain.get(lead.domain);
          const verified = lead.verdict === 'verified';
          await insertLead(env, {
            id: `${runId}.${lead.domain}`,
            runId,
            vertical,
            domain: lead.domain,
            score: lead.score,
            answers: row?.answers ?? 0,
            total,
            citations: row?.citations ?? 0,
            pages: row?.pages ?? [],
            queries: row?.queries ?? [],
            owner: lead.owner,
            companyType: lead.companyType,
            monetisation: lead.monetisation,
            aiDeal: lead.aiDeal,
            contactRole: lead.contactRole,
            // A name the fact-check could not find on its page is not kept, only the role.
            contactName: verified ? lead.contactName : null,
            contactSourceUrl: lead.contactSourceUrl,
            why: lead.why,
            verdict: lead.verdict,
            verifyNote: lead.verifyNote,
            email: draftEmail({
              domain: lead.domain,
              vertical,
              answers: row?.answers ?? 0,
              total,
              questions: QUESTIONS[vertical].length,
              engines,
              rivals: rows.filter((r) => r.domain !== lead.domain && !/reddit|youtube|amazon/.test(r.domain)).slice(0, 3),
              pages: row?.pages ?? [],
              robots: facts.get(lead.domain)?.robots ?? {},
              contactRole: lead.contactRole,
              contactName: verified ? lead.contactName : null,
              reportUrl: `${origin}/#report/${runId}/${lead.domain}`,
            }),
            status: 'draft',
          });
        }
        await env.DB.prepare('INSERT INTO events (run_id, text, created_at) VALUES (?, ?, ?)')
          .bind(runId, `First run, made with a Claude and a Gemini agent running in the cloud: ${total} answers, ${rows.length} sites cited, ${block.leads.length} publishers kept after the fact-check.`, data.runAt)
          .run();
        await insertRun(env, run);
      }
    })().catch((error) => {
      seeding = null;
      throw error;
    });
  }
  return seeding;
}
