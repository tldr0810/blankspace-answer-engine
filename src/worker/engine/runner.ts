/**
 * The run state machine. Each tick does a small, bounded piece of work and says how long to
 * wait before the next one, so no request ever holds a long agent turn open and a crash or
 * deploy resumes from the stored step.
 *
 *   ask      agents   every engine answers the buying questions (engines in parallel, 5 questions a turn)
 *   score    code     count citations per site, pick who to check
 *   enrich   code     ads.txt, a cited page, robots.txt, a few sites per tick
 *   profile  agent    owner, business model, best contact (one turn for all leads)
 *   verify   code     open each contact's source page, keep the name only if it is there
 *   review   agent    a second agent reviews each lead against a checklist; code checks its quotes
 *   draft    code     first email from counted facts
 */

import { z } from 'zod';
import {
  ENGINE_LABEL,
  QUESTIONS,
  scoutRole,
  STEP_LABEL,
  type Engine,
  type Lead,
  type Role,
  type Run,
  type RunKind,
  type RunOrigin,
  type Step,
  type Vertical,
} from '../../shared/engine';
import { credentialFor } from '../connect';
import { now } from '../db';
import { A2AError, safeErrorText } from '../a2a';
import type { Env } from '../types';
import { checkSite, fetchText, findAddress, verifyContact } from './fetchers';
import { acceptAnswers, draftEmail, searchExcuse, foreignSite, isPublisher, listedNonPublisher, quoteOnPage, score as scoreSite, settleReview, type RawCheck } from './logic';
import { profilePrompt, profileSchema, scoutPrompt, scoutSchema, verifierPrompt, verifierSchema } from './prompts';
import {
  addEvent,
  appOrigin,
  boardFor,
  getLead,
  getRun,
  leadsWithoutAddress,
  insertAnswers,
  insertLead,
  loadState,
  pagesToCheck,
  patchLead,
  roleMap,
  runLeads,
  saveFacts,
  saveAddress,
  saveReview,
  saveSiteRule,
  siteRules,
  personCalls,
  saveState,
  siteFacts,
  updateRun,
} from './store';
import { checkPages, staleBefore } from './sources';
import { extractJson, getTask, problemText, submitTask } from './tasks';

const LEADS_PER_VERTICAL = 5;
const SITE_QUESTIONS = 5;
/** Questions per scout turn. A 15-question turn ran 7-11 minutes and often ended as failed. */
const QUESTIONS_PER_TURN = 5;
const ENRICH_PER_TICK = 3;
const VERIFY_PER_TICK = 3;
/** Each address search opens up to 6 of the site's pages. */
const ADDRESSES_PER_TICK = 2;
const PAGES_PER_TICK = 10;
/** Wall-clock limit for one agent turn, counted from its submit. */
const TURN_DEADLINE_MS = 25 * 60_000;
/** Fallback for calls stored before submittedAt existed. */
const MAX_POLLS = 80;
/** Consecutive failed submits or polls of one call before that turn is given up on. */
const MAX_CALL_ERRORS = 6;
/** Consecutive failed ticks before the run stops instead of retrying. */
const MAX_TICK_ERRORS = 10;
/** Backstop: a run still going after this is stopped, whatever step it is on. */
const RUN_DEADLINE_MS = 3 * 3_600_000;
const TERMINAL = ['completed', 'failed', 'canceled', 'rejected', 'input-required', 'auth-required'];

interface CallState {
  role: Role;
  agentId: string;
  callId: string;
  taskId: string | null;
  polls: number;
  emptyPolls: number;
  resubmits: number;
  status: 'pending' | 'done' | 'failed';
  submittedAt?: number;
  /** Consecutive failed submits or polls; reset by any good answer from the agent. */
  errors?: number;
}

interface Bag {
  /** Keyed by role, or by role plus batch (`scout_claude.b1`) for scout turns. */
  calls: Partial<Record<string, CallState>>;
  /** Cited pages this run opened, by outcome. */
  pages?: { ok: number; dropped: number; blocked: number };
  candidates: string[];
  enriched: number;
  verified: number;
  /** Addresses the profiler suggested, by lead id, until the verification layer checks them. */
  emails?: Record<string, { email: string | null; url: string | null }>;
  tickErrors?: number;
}

const emptyBag = (): Bag => ({ calls: {}, candidates: [], enriched: 0, verified: 0 });

class FatalError extends Error {}

/* ───────── starting a run ───────── */

export function newRun(kind: RunKind, options: { vertical: Vertical; domain?: string | null; question?: string | null; engines: Engine[]; origin: RunOrigin }): Run {
  const questions =
    kind === 'question'
      ? [options.question!.trim()]
      : kind === 'site'
        ? QUESTIONS[options.vertical].slice(0, SITE_QUESTIONS)
        : QUESTIONS[options.vertical];
  return {
    id: `run_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`,
    kind,
    vertical: options.vertical,
    domain: options.domain ?? null,
    questions,
    engines: options.engines,
    status: 'running',
    step: 'ask',
    stepDetail: null,
    seed: false,
    origin: options.origin,
    startedAt: now(),
    finishedAt: null,
    error: null,
  };
}

/* ───────── agent calls ───────── */

const callIdFor = (run: Run, key: string, resubmits: number) => `${run.id}.${key}${resubmits ? `.s${resubmits}` : ''}`;

async function submit(env: Env, run: Run, call: CallState, prompt: string, label: string): Promise<void> {
  const cred = await credentialFor(env, call.agentId);
  // Derived from stored state: an automatic retry of the same submit reuses the id, so the agent
  // sees the same message and bills once. A deliberate resubmit gets a new suffix.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_calls (id, run_id, role, agent_id, label, state, created_at) VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
  )
    .bind(call.callId, run.id, call.role, call.agentId, label, now())
    .run();
  const snap = await submitTask(cred, { messageId: call.callId, text: prompt });
  if (!snap.taskId) throw new A2AError(`${cred.label} accepted the task but returned no task id.`, false);
  await env.DB.prepare('UPDATE agent_calls SET task_id = ?, context_id = ?, state = ? WHERE id = ?')
    .bind(snap.taskId, snap.contextId, snap.state || 'submitted', call.callId)
    .run();
  call.taskId = snap.taskId;
  call.submittedAt = Date.now();
}

/** Polls one call once. Returns the reply text when it finished, null while it is still working. */
async function poll(env: Env, call: CallState): Promise<{ text: string } | { failed: string } | null> {
  const cred = await credentialFor(env, call.agentId);
  const snap = await getTask(cred, call.taskId!);
  call.polls += 1;
  const late = call.submittedAt ? Date.now() - call.submittedAt > TURN_DEADLINE_MS : call.polls >= MAX_POLLS;
  // A task can say completed a moment before its artifact lands: give it a grace period.
  if (snap.state === 'completed' && !snap.text && call.emptyPolls < 6 && !late) {
    call.emptyPolls += 1;
    return null;
  }
  if (!TERMINAL.includes(snap.state)) {
    if (late) return { failed: `did not finish within ${TURN_DEADLINE_MS / 60_000} minutes` };
    return null;
  }
  await env.DB.prepare('UPDATE agent_calls SET state = ?, output_text = ?, finished_at = ? WHERE id = ?')
    .bind(snap.state, snap.text.slice(0, 60_000), now(), call.callId)
    .run();
  if (snap.state !== 'completed') return { failed: `ended as ${snap.state}` };
  if (!snap.text) return { failed: 'came back empty' };
  return { text: snap.text };
}

async function callError(env: Env, call: CallState, error: string): Promise<void> {
  await env.DB.prepare('UPDATE agent_calls SET state = ?, error = ? WHERE id = ?').bind('invalid_output', error, call.callId).run();
}

type Drive = { text: string } | 'pending' | 'settled';

/**
 * Moves one agent call forward by one request, never waiting on the agent: submit when it has no
 * task yet, otherwise one tasks/get. A call that keeps erroring, stalls past its deadline or ends
 * badly is sent once more and then given up on, so one silent agent can never hold the run.
 * Returns the reply text once, 'pending' while there is more to do, 'settled' when finished.
 */
async function driveCall(
  env: Env,
  run: Run,
  bag: Bag,
  opts: { role: Role; key?: string; agentId: string; prompt: string; label: string; name: string; giveUp: string },
): Promise<Drive> {
  const key = opts.key ?? opts.role;
  let call = bag.calls[key];
  if (!call) {
    call = { role: opts.role, agentId: opts.agentId, callId: callIdFor(run, key, 0), taskId: null, polls: 0, emptyPolls: 0, resubmits: 0, status: 'pending' };
    bag.calls[key] = call;
  }
  if (call.status !== 'pending') return 'settled';

  let outcome: { text: string } | { failed: string } | null;
  try {
    if (!call.taskId) {
      await submit(env, run, call, opts.prompt, opts.label);
      call.errors = 0;
      return 'pending';
    }
    outcome = await poll(env, call);
    call.errors = 0;
  } catch (error) {
    // Anything that is not the agent (D1, a bug) goes up to the tick's own retry.
    if (!(error instanceof A2AError)) throw error;
    call.errors = (call.errors ?? 0) + 1;
    if (error.retryable && call.errors < MAX_CALL_ERRORS) {
      await updateRun(env, run.id, { stepDetail: `Waiting on ${opts.name} (${error.message.slice(0, 80)})` });
      return 'pending';
    }
    outcome = { failed: `could not be reached (${error.message.slice(0, 120)})` };
  }
  if (!outcome) return 'pending';
  if ('text' in outcome) return outcome;

  await env.DB.prepare(`UPDATE agent_calls SET state = CASE WHEN state IN ('submitted', 'working') THEN 'abandoned' ELSE state END, error = ? WHERE id = ?`)
    .bind(outcome.failed, call.callId)
    .run();
  if (call.resubmits < 1) {
    const resubmits = call.resubmits + 1;
    bag.calls[key] = { ...call, callId: callIdFor(run, key, resubmits), taskId: null, polls: 0, emptyPolls: 0, errors: 0, resubmits, submittedAt: undefined };
    await addEvent(env, run.id, `${opts.name}'s turn ${outcome.failed}. Sending it once more.`);
    return 'pending';
  }
  call.status = 'failed';
  await addEvent(env, run.id, `${opts.name}'s turn ${outcome.failed} again. ${opts.giveUp}`);
  return 'settled';
}

/* ───────── steps ───────── */

type StepResult = { next?: Step; wait?: number };

/** The scout turns for one engine: the questions in batches, or one legacy turn for runs started before batching. */
export function scoutBatches(run: Run, bag: Bag, role: Role): { key: string; questions: string[] }[] {
  if (bag.calls[role]) return [{ key: role, questions: run.questions }];
  const batches = [];
  for (let i = 0; i < run.questions.length; i += QUESTIONS_PER_TURN) {
    batches.push({ key: `${role}.b${batches.length}`, questions: run.questions.slice(i, i + QUESTIONS_PER_TURN) });
  }
  return batches;
}

async function stepAsk(env: Env, run: Run, bag: Bag): Promise<StepResult> {
  const roles = await roleMap(env);
  let finished = 0;
  // Every engine moves forward on its own in the same tick: a slow or broken one never blocks the rest.
  // Within one engine the batches go one after another, so an agent only ever has one turn open.
  const states = await Promise.all(
    run.engines.map(async (engine): Promise<'pending' | 'settled'> => {
      const role = scoutRole(engine);
      const batches = scoutBatches(run, bag, role);
      const next = batches.findIndex((b) => !bag.calls[b.key] || bag.calls[b.key]!.status === 'pending');
      if (next === -1) {
        finished += 1;
        return 'settled';
      }
      const { key, questions } = batches[next];
      const existing = bag.calls[key];
      const agentId = existing?.agentId ?? roles[role];
      if (!agentId) {
        await addEvent(env, run.id, `No agent is assigned as the ${engine} scout, so that engine is skipped.`);
        for (const b of batches) bag.calls[b.key] ??= { role, agentId: '', callId: '', taskId: null, polls: 0, emptyPolls: 0, resubmits: 0, status: 'failed' };
        finished += 1;
        return 'settled';
      }
      const part = batches.length > 1 ? ` (batch ${next + 1} of ${batches.length})` : '';
      const drive = await driveCall(env, run, bag, {
        role,
        key,
        agentId,
        prompt: scoutPrompt(questions),
        label: `${questions.length} questions`,
        name: `The ${engine} scout${part}`,
        giveUp: next + 1 < batches.length ? 'Going on with the next batch.' : 'Going on without it.',
      });
      if (!existing && bag.calls[key]?.taskId) {
        await addEvent(env, run.id, `Sent ${questions.length} buying ${questions.length === 1 ? 'question' : 'questions'} to the ${engine} scout${part}.`);
      }
      if (drive === 'pending') return 'pending';
      if (drive !== 'settled') {
        const call = bag.calls[key]!;
        try {
          const parsed = scoutSchema.parse(extractJson(drive.text));
          const { answers, dropped } = acceptAnswers(engine, questions, parsed.answers);
          await insertAnswers(env, run.id, answers);
          call.status = 'done';
          const cited = answers.reduce((n, a) => n + a.cited.length, 0);
          await addEvent(
            env,
            run.id,
            cited === 0
              ? `The ${ENGINE_LABEL[engine]} scout's search found nothing it could cite${part}: ${searchExcuse(drive.text)}` +
                  ' If no batch from this engine cites anything, its answers are left out of the counts.'
              : `The ${engine} scout answered ${answers.length} of ${questions.length} questions${part} with ${cited} citations.` +
                  (dropped ? ` The automated check dropped ${dropped} cited ${dropped === 1 ? 'URL' : 'URLs'} that its own search never returned.` : ''),
          );
        } catch (error) {
          call.status = 'failed';
          await callError(env, call, problemText(error));
          await addEvent(env, run.id, `The ${engine} scout's reply${part} could not be read (${problemText(error).slice(0, 140)}).`);
        }
      }
      // More batches left for this engine: the next one is submitted on the next tick.
      if (next + 1 < batches.length) return 'pending';
      finished += 1;
      return 'settled';
    }),
  );
  await updateRun(env, run.id, { stepDetail: `${finished} of ${run.engines.length} engines finished` });
  if (states.includes('pending')) return { wait: 15_000 };
  if (!Object.entries(bag.calls).some(([key, c]) => key.startsWith('scout_') && c?.status === 'done')) throw new FatalError('No engine returned usable answers.');
  return { next: 'score' };
}

async function stepScore(env: Env, run: Run, bag: Bag): Promise<StepResult> {
  // Open every cited page first, a few per tick: dead or off-topic pages must not count.
  const due = await pagesToCheck(env, { runId: run.id, staleBefore: staleBefore(), limit: PAGES_PER_TICK });
  if (due.length) {
    const results = await checkPages(env, due);
    bag.pages = (bag.pages ?? { ok: 0, dropped: 0, blocked: 0 });
    for (const r of results) {
      if (r.verdict === 'ok') bag.pages.ok += 1;
      else if (r.verdict === 'blocked') bag.pages.blocked += 1;
      else bag.pages.dropped += 1;
    }
    const done = bag.pages.ok + bag.pages.blocked + bag.pages.dropped;
    await updateRun(env, run.id, { stepDetail: `${done} cited pages opened` });
    return { wait: 300 };
  }
  if (bag.pages) {
    const { ok, dropped, blocked } = bag.pages;
    await addEvent(
      env,
      run.id,
      `Opened ${ok + dropped + blocked} cited pages: ${ok} live and on topic` +
        (dropped ? `, ${dropped} dead or off topic (left out of the counts)` : '') +
        (blocked ? `, ${blocked} on sites that block checks (kept, marked unchecked)` : '') +
        '.',
    );
  }
  const { rows, total, silent } = await boardFor(env, run.id);
  if (run.kind === 'site') {
    bag.candidates = [run.domain!];
  } else {
    const limit = run.kind === 'question' ? 8 : LEADS_PER_VERTICAL * 2;
    // Sites a person or the verifier ruled out on an earlier run are not checked again.
    const rules = await siteRules(env);
    const ruledOut = rows.filter((r) => rules.get(r.domain)?.rule === 'not_publisher').length;
    bag.candidates = rows
      .filter((r) => !listedNonPublisher(r.domain) && !foreignSite(r.domain) && rules.get(r.domain)?.rule !== 'not_publisher')
      .slice(0, limit)
      .map((r) => r.domain);
    if (ruledOut) await addEvent(env, run.id, `Skipped ${ruledOut} ${ruledOut === 1 ? 'site' : 'sites'} an earlier review ruled out as not a publisher.`);
  }
  bag.enriched = 0;
  if (silent.length) {
    const names = silent.map((e) => ENGINE_LABEL[e]).join(' and ');
    await addEvent(env, run.id, `${names} cited nothing in any batch, so ${silent.length === 1 ? 'its' : 'their'} answers are left out of the counts.`);
  }
  await addEvent(env, run.id, `Counted ${total} answers citing ${rows.length} different sites. Checking ${bag.candidates.length} of them.`);
  return { next: 'enrich' };
}

async function stepEnrich(env: Env, run: Run, bag: Bag): Promise<StepResult> {
  const { rows, total } = await boardFor(env, run.id);
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  const batch = bag.candidates.slice(bag.enriched, bag.enriched + ENRICH_PER_TICK);
  const results = await Promise.all(batch.map((d) => checkSite(d, byDomain.get(d)?.pages[0] ?? null)));
  for (const facts of results) await saveFacts(env, facts);
  bag.enriched += batch.length;
  await updateRun(env, run.id, { stepDetail: `${bag.enriched} of ${bag.candidates.length} sites checked` });
  if (bag.enriched < bag.candidates.length) return { wait: 500 };

  if (run.kind === 'question') return { next: 'done' };

  const [facts, rules] = await Promise.all([siteFacts(env, bag.candidates), siteRules(env)]);
  const scored = bag.candidates
    .map((d) => {
      const row = byDomain.get(d);
      const f = facts.get(d) ?? null;
      return { domain: d, row, facts: f, score: scoreSite(row?.answers ?? 0, total, f), publisher: isPublisher(d, f, rules.get(d)?.rule) };
    })
    .filter((c) => run.kind === 'site' || c.publisher)
    .sort((a, b) => b.score - a.score)
    .slice(0, run.kind === 'site' ? 1 : LEADS_PER_VERTICAL);
  const dropped = bag.candidates.length - (run.kind === 'site' ? bag.candidates.length : scored.length);
  for (const c of scored) {
    await insertLead(env, {
      id: `${run.id}.${c.domain}`,
      runId: run.id,
      vertical: run.vertical!,
      domain: c.domain,
      score: c.score,
      answers: c.row?.answers ?? 0,
      total,
      citations: c.row?.citations ?? 0,
      pages: c.row?.pages ?? [],
      queries: c.row?.queries ?? [],
      owner: null, companyType: null, monetisation: null, aiDeal: null, contactRole: null, contactName: null, contactSourceUrl: null, why: null,
      verdict: 'pending', verifyNote: null, email: null, status: 'draft',
    });
  }
  await addEvent(
    env,
    run.id,
    run.kind === 'site'
      ? `${run.domain} scored ${scored[0]?.score ?? 0}: cited in ${scored[0]?.row?.answers ?? 0} of ${total} answers.`
      : `Kept ${scored.length} ad- or affiliate-funded publishers${dropped > 0 ? `, set aside ${dropped} that show no sign of selling ads or affiliate links` : ''}.`,
  );
  return { next: 'profile' };
}

async function stepProfile(env: Env, run: Run, bag: Bag): Promise<StepResult> {
  const leads = await runLeads(env, run.id);
  if (!leads.length) return { next: 'draft' };
  const roles = await roleMap(env);
  const existing = bag.calls.profiler;
  if (!existing && !roles.profiler) {
    await addEvent(env, run.id, 'No profiler agent is assigned, so the drafts go to a role, not a person.');
    return { next: 'verify' };
  }
  const outcome = await driveCall(env, run, bag, {
    role: 'profiler',
    agentId: existing?.agentId ?? roles.profiler!,
    prompt: profilePrompt(leads.map((l) => l.domain)),
    label: 'profiles',
    name: 'The profiler',
    giveUp: 'The drafts will go to a role.',
  });
  if (!existing && bag.calls.profiler?.taskId) {
    await addEvent(env, run.id, `Asked the profiler who owns ${leads.length === 1 ? leads[0].domain : `${leads.length} sites`} and who to talk to.`);
  }
  if (outcome === 'settled') return { next: 'verify' };
  if (outcome === 'pending') {
    if (existing) await updateRun(env, run.id, { stepDetail: 'The profiler is researching' });
    return { wait: 20_000 };
  }
  const call = bag.calls.profiler!;
  try {
    const parsed = profileSchema.parse(extractJson(outcome.text));
    let named = 0;
    for (const lead of leads) {
      const p = parsed.sites.find((s) => s.domain.toLowerCase().replace(/^www\./, '') === lead.domain);
      if (!p) continue;
      const name = p.contact_name && p.contact_source_url ? p.contact_name : null;
      if (name) named += 1;
      if (p.contact_email) (bag.emails ??= {})[lead.id] = { email: p.contact_email, url: p.email_source_url };
      await patchLead(env, lead.id, {
        owner: p.owner,
        companyType: p.company_type,
        monetisation: p.monetisation,
        aiDeal: p.ai_deal,
        contactRole: p.contact_role,
        contactName: name,
        contactSourceUrl: name ? p.contact_source_url : null,
        why: p.why,
        verdict: name ? 'pending' : 'no_person',
      });
    }
    call.status = 'done';
    await addEvent(env, run.id, `The profiler suggested ${named} named ${named === 1 ? 'contact' : 'contacts'}. Automated checks verify each one next.`);
  } catch (error) {
    call.status = 'failed';
    await callError(env, call, problemText(error));
    await addEvent(env, run.id, `The profiler's reply could not be read (${problemText(error).slice(0, 140)}).`);
  }
  return { next: 'verify' };
}

async function stepVerify(env: Env, run: Run, bag: Bag): Promise<StepResult> {
  const leads = (await runLeads(env, run.id)).filter((l) => l.contactName && l.contactSourceUrl && l.verdict === 'pending');
  const batch = leads.slice(0, VERIFY_PER_TICK);
  for (const lead of batch) {
    let url = '';
    try {
      const parsed = new URL(lead.contactSourceUrl!);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = parsed.toString();
    } catch {
      /* not a URL */
    }
    const result = url ? await verifyContact(lead.contactName!, url) : { verdict: 'not_found' as const, note: 'The source is not a valid URL.' };
    await patchLead(env, lead.id, { verdict: result.verdict, verifyNote: result.note });
    bag.verified += 1;
    await addEvent(
      env,
      run.id,
      result.verdict === 'verified'
        ? `Confirmed ${lead.contactName} on the source page for ${lead.domain}.`
        : `Could not confirm ${lead.contactName} for ${lead.domain}: ${result.note}`,
    );
  }
  if (leads.length > batch.length) return { wait: 500 };
  // Leads without a name get a clear verdict too.
  for (const lead of await runLeads(env, run.id)) {
    if (lead.verdict === 'pending') await patchLead(env, lead.id, { verdict: 'no_person', verifyNote: 'No public page named a person in this role.' });
  }
  // Then where to write: an address only counts once it is read on a public page.
  const unaddressed = (await runLeads(env, run.id)).filter((l) => !l.address);
  for (const lead of unaddressed.slice(0, ADDRESSES_PER_TICK)) {
    const address = await lookForAddress(lead, bag.emails?.[lead.id]);
    await saveAddress(env, lead.id, address);
    await addEvent(
      env,
      run.id,
      address.email
        ? `Found ${address.email} for ${lead.domain} on ${new URL(address.sourceUrl!).pathname || '/'}.`
        : `No published address for ${lead.domain}: ${address.note}`,
    );
  }
  if (unaddressed.length > ADDRESSES_PER_TICK) return { wait: 500 };
  return { next: 'review' };
}

/** Pages a lead's address may be on: the verified contact's own page comes first. */
export function lookForAddress(lead: Lead, suggested?: { email: string | null; url: string | null }) {
  const named = lead.verdict === 'verified' && lead.contactName ? lead.contactName : null;
  const extra = named && lead.contactSourceUrl ? [lead.contactSourceUrl] : [];
  return findAddress(lead.domain, named, suggested ?? { email: null, url: null }, extra);
}

/**
 * Cron: leads from runs before addresses were looked for (or whose search was cut off) get one,
 * a couple per tick, and a draft still waiting on a person gets the address in its To line.
 */
export async function sweepAddresses(env: Env, limit = 2): Promise<number> {
  const ids = await leadsWithoutAddress(env, limit);
  for (const id of ids) {
    const lead = await getLead(env, id);
    if (!lead) continue;
    const address = await lookForAddress(lead);
    await saveAddress(env, id, address);
    if (lead.email && lead.status === 'draft') {
      const email = withAddress(lead.email, address);
      if (email !== lead.email) await patchLead(env, id, { email });
    }
  }
  return ids.length;
}

/** Puts a found address in the draft's To line, unless a person already filled one in. */
export function withAddress(email: string, address: Lead['address']): string {
  if (!address?.email || /^To:/im.test(email.split('\n\n')[0])) return email;
  return `To: ${address.email}\n${email}`;
}

const CONTACT_CHECK: Record<Lead['verdict'], string> = {
  verified: 'code found this name on the source page',
  not_found: 'code did NOT find this name on the source page, so only the role is used',
  fetch_blocked: 'the source page blocked code, so the name is unchecked',
  no_person: 'no person was named',
  pending: 'not checked yet',
};

const httpUrl = (value: string | null | undefined): string | null => {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The verifier, modelled on a maintainer reviewing a collector's records: another agent than the
 * one that made the leads, a fixed checklist, a quote for every answer, unsure over a guess. Code
 * opens every quoted page, and the agent can only hold a lead back or bring a contact code can
 * confirm; it can never pass what code could not.
 */
async function stepReview(env: Env, run: Run, bag: Bag): Promise<StepResult> {
  const leads = await runLeads(env, run.id);
  if (!leads.length) return { next: 'draft' };
  const roles = await roleMap(env);
  const existing = bag.calls.verifier;
  if (!existing) {
    if (!roles.verifier) {
      await addEvent(env, run.id, 'No verifier agent is assigned, so no second review this run.');
      return { next: 'draft' };
    }
    const profiler = bag.calls.profiler?.agentId ?? roles.profiler;
    if (roles.verifier === profiler) {
      await addEvent(env, run.id, 'The verifier is the same agent as the profiler, and nobody reviews their own work, so no second review this run. Assign another agent in Settings.');
      return { next: 'draft' };
    }
  }
  const pastCalls = existing ? [] : await personCalls(env, 8);
  const outcome = await driveCall(env, run, bag, {
    role: 'verifier',
    agentId: existing?.agentId ?? roles.verifier!,
    prompt: verifierPrompt(
      leads.map((l) => ({
        domain: l.domain,
        owner: l.owner,
        companyType: l.companyType,
        monetisation: l.monetisation,
        contactRole: l.contactRole,
        contactName: l.contactName,
        contactSourceUrl: l.contactSourceUrl,
        contactCheck: CONTACT_CHECK[l.verdict],
        facts: l.facts
          ? `ads.txt ${l.facts.adsTxtLines ? `${l.facts.adsTxtLines} lines` : 'none found'}, affiliate links ${l.facts.affiliate ? 'found' : 'not found'}, CDN ${l.facts.cdn}`
          : 'not checked',
        page: l.pages[0] ?? null,
        questions: l.queries.slice(0, 3),
      })),
      pastCalls,
    ),
    label: 'reviews',
    name: 'The verifier',
    giveUp: 'The leads go out without a second review.',
  });
  if (!existing && bag.calls.verifier?.taskId) {
    await addEvent(env, run.id, `Asked the verifier, a different agent from the profiler, to review ${leads.length === 1 ? leads[0].domain : `${leads.length} leads`}.`);
  }
  if (outcome === 'settled') return { next: 'draft' };
  if (outcome === 'pending') {
    if (existing) await updateRun(env, run.id, { stepDetail: 'The verifier is reviewing' });
    return { wait: 20_000 };
  }
  const call = bag.calls.verifier!;
  try {
    const parsed = verifierSchema.parse(extractJson(outcome.text));
    // Open each quoted page once and look for every quote on it.
    const pages = new Map<string, Promise<string | null>>();
    const open = (url: string) => {
      if (!pages.has(url)) pages.set(url, fetchText(url));
      return pages.get(url)!;
    };
    const counts = { pass: 0, reject: 0, unsure: 0 };
    for (const lead of leads) {
      const site = parsed.sites.find((s) => s.domain.toLowerCase().replace(/^www\./, '') === lead.domain);
      if (!site) continue;
      const raw: RawCheck[] = site.checks
        .filter((c): c is typeof c & { key: RawCheck['key'] } => ['publisher', 'contact', 'page'].includes(c.key))
        .map((c) => ({ key: c.key, answer: c.answer, note: c.note.trim(), url: httpUrl(c.url), quote: c.quote }));
      const found = new Map<string, 'on_page' | 'not_on_page' | 'unreadable'>();
      await Promise.all(
        raw.map(async (c) => {
          if (!c.url || !c.quote || c.answer === 'unsure') return;
          const html = await open(c.url);
          found.set(`${c.url}\n${c.quote}`, html === null ? 'unreadable' : quoteOnPage(c.quote, html) ? 'on_page' : 'not_on_page');
        }),
      );
      const settled = settleReview(raw, found, now());
      let change: string | null = null;

      // A contact the verifier brings counts only once code finds the name on its page.
      const better = site.better_contact;
      const betterUrl = httpUrl(better?.source_url);
      if (better && betterUrl && lead.verdict !== 'verified') {
        const result = await verifyContact(better.name, betterUrl);
        if (result.verdict === 'verified') {
          await patchLead(env, lead.id, {
            contactName: better.name,
            contactRole: better.role ?? lead.contactRole,
            contactSourceUrl: betterUrl,
            verdict: 'verified',
            verifyNote: `Found by the verifier. ${result.note}`,
          });
          change = `Found ${better.name}${better.role ? `, ${better.role}` : ''}; verified on the source page.`;
        }
      }
      // A checked name the verifier shows is out of date, with a quote code found, falls back to the role.
      const contact = settled.checks.find((c) => c.key === 'contact');
      if (!change && lead.verdict === 'verified' && contact?.answer === 'no' && contact.quoteCheck === 'on_page') {
        await patchLead(env, lead.id, { verdict: 'not_found', verifyNote: `The verifier found ${lead.contactName} may no longer hold this role: ${contact.note}` });
        change = `Held back ${lead.contactName}: may no longer hold the role. The email goes to the role.`;
      }
      // A publisher check answered no, with a quote found on the page, is remembered for later runs.
      const publisher = settled.checks.find((c) => c.key === 'publisher');
      if (publisher?.answer === 'no' && publisher.quoteCheck === 'on_page') {
        await saveSiteRule(env, { domain: lead.domain, rule: 'not_publisher', by: 'verifier', reason: publisher.note || 'The verifier found it is not a publisher.', at: now() });
      }
      await saveReview(env, lead.id, { ...settled, change });
      counts[settled.decision] += 1;
      await addEvent(
        env,
        run.id,
        `The verifier reviewed ${lead.domain}: ${settled.decision === 'pass' ? 'passed every check' : settled.decision === 'reject' ? 'not a fit' : 'a person should decide'}.${change ? ` ${change}` : ''}`,
      );
    }
    call.status = 'done';
    await addEvent(env, run.id, `Review done: ${counts.pass} passed, ${counts.reject} held back, ${counts.unsure} for a person to decide.`);
  } catch (error) {
    call.status = 'failed';
    await callError(env, call, problemText(error));
    await addEvent(env, run.id, `The verifier's reply could not be read (${problemText(error).slice(0, 140)}).`);
  }
  return { next: 'draft' };
}

async function stepDraft(env: Env, run: Run): Promise<StepResult> {
  const { rows, total, questions } = await boardFor(env, run.id);
  const origin = await appOrigin(env);
  const leads = await runLeads(env, run.id);
  for (const lead of leads) {
    const verified = lead.verdict === 'verified';
    const email = draftEmail({
      domain: lead.domain,
      vertical: run.vertical!,
      answers: lead.answers,
      total,
      questions,
      engines: run.engines.filter((e) => rows.some((r) => r.byEngine[e])),
      rivals: rows.filter((r) => r.domain !== lead.domain && r.publisher !== false).slice(0, 3),
      pages: lead.pages,
      robots: lead.facts?.robots ?? {},
      contactRole: lead.contactRole,
      contactName: verified ? lead.contactName : null,
      reportUrl: `${origin}/#report/${run.id}/${lead.domain}/email`,
    });
    await patchLead(env, lead.id, { email: withAddress(email, lead.address) });
  }
  await addEvent(env, run.id, `Drafted ${leads.length} first ${leads.length === 1 ? 'email' : 'emails'}. Nothing is sent until a person approves.`);
  return { next: 'done' };
}

/* ───────── the tick ───────── */

/** One bounded step. Returns ms until the next tick, or null when the run is finished. */
export async function tick(env: Env, runId: string): Promise<number | null> {
  const run = await getRun(env, runId);
  if (!run || run.status !== 'running') return null;
  const bag = await loadState<Bag>(env, runId, emptyBag());
  if (Date.now() - Date.parse(run.startedAt) > RUN_DEADLINE_MS) {
    const message = `Stopped after ${RUN_DEADLINE_MS / 3_600_000} hours on the ${run.step} step.`;
    await updateRun(env, runId, { status: 'failed', error: message, finishedAt: now() });
    await addEvent(env, runId, `The run stopped: ${message}`);
    return null;
  }
  let result: StepResult;
  try {
    switch (run.step) {
      case 'ask': result = await stepAsk(env, run, bag); break;
      case 'score': result = await stepScore(env, run, bag); break;
      case 'enrich': result = await stepEnrich(env, run, bag); break;
      case 'profile': result = await stepProfile(env, run, bag); break;
      case 'verify': result = await stepVerify(env, run, bag); break;
      case 'review': result = await stepReview(env, run, bag); break;
      case 'draft': result = await stepDraft(env, run); break;
      default: result = { next: 'done' };
    }
  } catch (error) {
    const message = safeErrorText(error instanceof Error ? error.message : error);
    const fatal = error instanceof FatalError || error instanceof z.ZodError || !/timeout|timed out|temporar|unavailable|50\d|network|fetch/i.test(message);
    bag.tickErrors = (bag.tickErrors ?? 0) + 1;
    await saveState(env, runId, bag);
    if (!fatal && bag.tickErrors < MAX_TICK_ERRORS) {
      await updateRun(env, runId, { stepDetail: `Retrying after a temporary error: ${message.slice(0, 120)}` });
      return 30_000;
    }
    await updateRun(env, runId, { status: 'failed', error: message, finishedAt: now() });
    await addEvent(env, runId, `The run stopped: ${message}`);
    return null;
  }
  bag.tickErrors = 0;
  await saveState(env, runId, bag);
  if (result.next === 'done') {
    await updateRun(env, runId, { status: 'done', step: 'done', stepDetail: null, finishedAt: now() });
    await addEvent(env, runId, 'Done.');
    return null;
  }
  if (result.next) {
    await updateRun(env, runId, { step: result.next, stepDetail: STEP_LABEL[result.next as keyof typeof STEP_LABEL] ?? null });
    return 200;
  }
  return result.wait ?? 1000;
}
