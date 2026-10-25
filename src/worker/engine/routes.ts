/**
 * /api/engine. Reads are the public demo. Anyone may start a site check or a question
 * (within the daily limit); a whole-vertical run, role changes and edits to drafts need the
 * admin password when the deployment has one.
 *
 *   GET   /state                         boards, recent runs, roles, limits
 *   POST  /runs                          { kind, vertical, domain?, question? } → start a run
 *   GET   /runs/:id                      run, live feed, board, leads, agent calls
 *   GET   /runs/:id/report/:domain       a site's AI Answer Share report
 *   GET   /leads                         every run's leads, one per site
 *   PATCH /leads/:id                     { email?, status? } edit or approve a draft
 *   POST  /leads/:id/call                { call, note? } a person's call on a lead, remembered for later runs
 *   GET   /learning                      what the flow has learned from its checks and from people
 *   PUT   /roles                         { role, agentId|null } assign an agent to a role
 *   POST  /autopilot                     start the next vertical in rotation if one is due (Manyfold automation)
 *   PUT   /autopilot                     { enabled } pause or resume it
 */

import { joinEmail, splitEmail } from '../../shared/email';
import { Hono } from 'hono';
import {
  PERSON_CALLS,
  ROLES,
  VERTICALS,
  type EngineState,
  type Learning,
  type PersonCall,
  type Lead,
  type Role,
  type RunDetail,
  type RunKind,
  type SiteReport,
  type Vertical,
  type VerticalBoard,
} from '../../shared/engine';
import { HttpError, type Env } from '../types';
import { autopilotTick, loadAutopilot, saveAutopilot } from './autopilot';
import { DECISIONS_NEEDED, normalizeDomain, signalStats, verifierRecord } from './logic';
import { newRun } from './runner';
import { ensureSeed } from './seed';
import {
  activeRuns,
  addEvent,
  boardFor,
  flowCounts,
  getLead,
  getRun,
  insertRun,
  saveReview,
  saveSiteRule,
  latestVerticalRuns,
  listCalls,
  listEvents,
  listRuns,
  patchLead,
  readyEngines,
  rememberOrigin,
  roleMap,
  bestLeads,
  runLeads,
  runsSince,
  setRole,
  siteFacts,
  siteRules,
  sourceTotals,
} from './store';
import { tickerFor } from './ticker';

const MAX_ACTIVE = 3;

/** What a visitor without the password sees of a lead. */
const publicLead = (l: Lead): Lead => ({
  ...l,
  contactName: l.verdict === 'verified' ? l.contactName : null,
  // The address the owner typed stays owner-only.
  email: l.email ? joinEmail({ ...splitEmail(l.email), to: '' }) : null,
  // The verifier's contact quote can name a person code did not confirm.
  review:
    l.review && l.verdict !== 'verified'
      ? { ...l.review, checks: l.review.checks.map((c) => (c.key === 'contact' ? { ...c, note: 'Shown to the owner.', quote: null, url: null } : c)) }
      : l.review,
});

type AdminCheck = (c: { env: Env; req: { header: (name: string) => string | undefined } }) => boolean;

export function engineRoutes(adminOk: AdminCheck) {
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (c, next) => {
    const origin = new URL(c.req.url).origin;
    // waitUntil keeps the seed writing if this request is cancelled, since later requests share it.
    const seeding = ensureSeed(c.env, origin);
    c.executionCtx.waitUntil(seeding.catch(() => {}));
    await seeding;
    if (c.req.method === 'POST') await rememberOrigin(c.env, origin);
    await next();
  });

  const requireAdmin = (c: Parameters<AdminCheck>[0]) => {
    if (!adminOk(c)) throw new HttpError(401, 'admin_password_invalid', 'This action needs the admin password.');
  };

  const dailyLimit = (env: Env) => Math.max(0, Number(env.DAILY_RUN_LIMIT ?? '12') || 12);
  const dayStart = () => new Date(Date.now() - 24 * 3600_000).toISOString();

  app.get('/state', async (c) => {
    const [roles, engines, runs, latest, active, today, autopilot, sources] = await Promise.all([
      roleMap(c.env),
      readyEngines(c.env),
      listRuns(c.env, 40),
      latestVerticalRuns(c.env),
      activeRuns(c.env),
      runsSince(c.env, dayStart()),
      loadAutopilot(c.env),
      sourceTotals(c.env),
    ]);
    const boards: VerticalBoard[] = [];
    for (const vertical of VERTICALS) {
      const run = latest.find((r) => r.vertical === vertical);
      if (!run) continue;
      const { rows, total, questions } = await boardFor(c.env, run.id);
      boards.push({
        vertical,
        runId: run.id,
        runAt: run.startedAt,
        seed: run.seed,
        total,
        engines: run.engines,
        questions,
        rows: rows.slice(0, 15).map(({ pages: _p, queries: _q, ...row }) => row),
      });
    }
    const state: EngineState = {
      roles: adminOk(c) ? roles : {},
      engines,
      canProfile: Boolean(roles.profiler),
      runs,
      boards,
      limits: { runsToday: today, dailyLimit: dailyLimit(c.env), active: active.length },
      autopilot: { ...autopilot, nextVertical: VERTICALS[autopilot.next % VERTICALS.length] },
      sources,
    };
    return c.json(state);
  });

  app.post('/runs', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = String(body?.kind ?? '') as RunKind;
    const vertical = String(body?.vertical ?? '') as Vertical;
    if (!['vertical', 'site', 'question'].includes(kind)) throw new HttpError(400, 'bad_request', 'kind must be vertical, site or question.');
    if (!(VERTICALS as readonly string[]).includes(vertical)) throw new HttpError(400, 'bad_request', 'Pick one of the verticals.');
    if (kind === 'vertical') requireAdmin(c);

    let domain: string | null = null;
    let question: string | null = null;
    if (kind === 'site') {
      domain = normalizeDomain(String(body?.domain ?? ''));
      if (!domain) throw new HttpError(400, 'bad_domain', 'Enter a site like whatcar.com.');
    }
    if (kind === 'question') {
      question = String(body?.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (question.length < 8) throw new HttpError(400, 'bad_question', 'Write the buying question a shopper would ask.');
    }

    const engines = await readyEngines(c.env);
    if (!engines.length) throw new HttpError(409, 'no_engines', 'No scout agents are connected yet. The owner connects them in Settings.');
    const [active, today] = await Promise.all([activeRuns(c.env), runsSince(c.env, dayStart())]);
    if (active.length >= MAX_ACTIVE) throw new HttpError(429, 'busy', `${active.length} runs are already going. Try again when one finishes.`);
    if (!adminOk(c) && today >= dailyLimit(c.env)) {
      throw new HttpError(429, 'daily_limit', `Today's ${dailyLimit(c.env)} live runs are used. The saved results are still here to explore.`);
    }

    const run = newRun(kind, { vertical, domain, question, engines });
    await insertRun(c.env, run);
    await addEvent(
      c.env,
      run.id,
      kind === 'site' ? `Checking ${domain} on ${run.questions.length} ${vertical.replace('_', ' ')} questions.` : kind === 'question' ? `Asking: “${question}”` : `Running all ${run.questions.length} ${vertical.replace('_', ' ')} questions.`,
    );
    await tickerFor(c.env, run.id).start(run.id, 0);
    return c.json({ run }, 201);
  });

  app.get('/runs/:id', async (c) => {
    const run = await getRun(c.env, c.req.param('id'));
    if (!run) throw new HttpError(404, 'not_found', 'No such run.');
    const [events, board, leads, calls] = await Promise.all([
      listEvents(c.env, run.id),
      boardFor(c.env, run.id),
      runLeads(c.env, run.id),
      listCalls(c.env, run.id),
    ]);
    const detail: RunDetail = {
      run,
      events,
      board: board.rows.slice(0, 20).map(({ pages: _p, queries: _q, ...row }) => row),
      total: board.total,
      leads: adminOk(c) ? leads : leads.map(publicLead),
      calls,
    };
    return c.json(detail);
  });

  app.get('/leads', async (c) => {
    const leads = await bestLeads(c.env);
    return c.json({ leads: adminOk(c) ? leads : leads.map(publicLead) });
  });

  app.get('/runs/:id/report/:domain', async (c) => {
    const run = await getRun(c.env, c.req.param('id'));
    const domain = normalizeDomain(c.req.param('domain'));
    if (!run || !domain || !run.vertical) throw new HttpError(404, 'not_found', 'No such report.');
    const { rows, total, verdicts } = await boardFor(c.env, run.id);
    const index = rows.findIndex((r) => r.domain === domain);
    const row = index >= 0 ? rows[index] : null;
    const [facts, leads] = await Promise.all([siteFacts(c.env, [domain]), runLeads(c.env, run.id)]);
    const lead = leads.find((l) => l.domain === domain) ?? null;
    const report: SiteReport = {
      domain,
      vertical: run.vertical,
      runId: run.id,
      runAt: run.startedAt,
      total,
      engines: run.engines,
      rank: row ? rows.filter((r) => r.publisher !== false).findIndex((r) => r.domain === domain) + 1 || null : null,
      row: row ? { domain: row.domain, answers: row.answers, citations: row.citations, byEngine: row.byEngine, publisher: row.publisher, verified: row.verified } : null,
      board: rows.filter((r) => r.publisher !== false).slice(0, 10).map(({ pages: _p, queries: _q, ...r }) => r),
      pages: row?.pages ?? [],
      pageVerdicts: Object.fromEntries((row?.pages ?? []).filter((u) => verdicts.has(u)).map((u) => [u, verdicts.get(u)!])),
      queries: row?.queries ?? [],
      facts: facts.get(domain) ?? null,
      lead: lead ? { ...publicLead(lead), email: null } : null,
    };
    return c.json(report);
  });

  app.patch('/leads/:id', async (c) => {
    requireAdmin(c);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const status = body?.status;
    if (status !== undefined && !['draft', 'approved', 'skipped'].includes(String(status))) {
      throw new HttpError(400, 'bad_request', 'status must be draft, approved or skipped.');
    }
    await patchLead(c.env, c.req.param('id'), {
      email: typeof body?.email === 'string' ? body.email.slice(0, 4000) : undefined,
      status: status as 'draft' | 'approved' | 'skipped' | undefined,
    });
    return c.json({ ok: true });
  });

  app.post('/leads/:id/call', async (c) => {
    requireAdmin(c);
    const body = (await c.req.json().catch(() => null)) as { call?: unknown; note?: unknown } | null;
    const call = String(body?.call ?? '') as PersonCall;
    if (!(PERSON_CALLS as readonly string[]).includes(call)) throw new HttpError(400, 'bad_request', `call must be one of ${PERSON_CALLS.join(', ')}.`);
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    const lead = await getLead(c.env, c.req.param('id'));
    if (!lead) throw new HttpError(404, 'not_found', 'No such lead.');
    const at = new Date().toISOString();
    const review = { ...(lead.review ?? { decision: 'unsure' as const, checks: [], change: null, reviewedAt: at }), person: { call, note, at } };
    await saveReview(c.env, lead.id, review);
    // The call outlives this lead: the next runs skip a ruled-out site, or keep one the verifier doubted.
    if (call !== 'wrong_contact') {
      await saveSiteRule(c.env, { domain: lead.domain, rule: call === 'fit' ? 'publisher' : 'not_publisher', by: 'person', reason: note ?? (call === 'fit' ? 'A person called it a good fit.' : 'A person called it not a publisher.'), at });
    } else if (lead.verdict === 'verified') {
      await patchLead(c.env, lead.id, { verdict: 'not_found', verifyNote: `A person marked ${lead.contactName ?? 'this contact'} as the wrong contact${note ? `: ${note}` : '.'}` });
    }
    const updated = await getLead(c.env, lead.id);
    return c.json({ lead: updated });
  });

  app.get('/learning', async (c) => {
    const [rules, counts, leads] = await Promise.all([siteRules(c.env), flowCounts(c.env), bestLeads(c.env)]);
    const { decided, signals } = signalStats(leads);
    const learning: Learning = {
      rules: [...rules.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      profiler: { suggested: counts.suggested, confirmed: counts.confirmed },
      verifier: verifierRecord(counts.reviews),
      decided,
      needed: DECISIONS_NEEDED,
      signals,
    };
    return c.json(learning);
  });

  app.put('/roles', async (c) => {
    requireAdmin(c);
    const body = (await c.req.json().catch(() => null)) as { role?: unknown; agentId?: unknown } | null;
    const role = String(body?.role ?? '') as Role;
    if (!(ROLES as readonly string[]).includes(role)) throw new HttpError(400, 'bad_request', 'Unknown role.');
    await setRole(c.env, role, typeof body?.agentId === 'string' && body.agentId ? body.agentId : null);
    return c.json({ roles: await roleMap(c.env) });
  });

  // Called by the Manyfold automation. Open to anyone: the gap and the rotation are decided
  // here, so calling it more often than the schedule starts nothing extra.
  app.post('/autopilot', async (c) => {
    const outcome = await autopilotTick(c.env);
    return c.json(outcome.started ? { started: true, runId: outcome.run.id, vertical: outcome.run.vertical } : outcome);
  });

  app.put('/autopilot', async (c) => {
    requireAdmin(c);
    const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') throw new HttpError(400, 'bad_request', 'enabled must be true or false.');
    const state = await loadAutopilot(c.env);
    await saveAutopilot(c.env, { ...state, enabled: body.enabled });
    return c.json({ ok: true });
  });

  return app;
}

/** Cron safety net: re-arm every running run in case its alarm was lost. */
export async function rearmRuns(env: Env): Promise<void> {
  for (const run of await activeRuns(env)) await tickerFor(env, run.id).start(run.id, 0);
}
