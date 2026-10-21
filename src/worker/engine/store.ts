/**
 * D1 reads and writes for the engine. Row → API shape conversion lives here so the runner
 * and the routes never touch column names.
 */

import {
  ENGINES,
  ROLES,
  scoutRole,
  type BoardRow,
  type Engine,
  type Lead,
  type Role,
  type Run,
  type RunEvent,
  type SiteFacts,
  type Vertical,
} from '../../shared/engine';
import { getSetting, now, setSetting } from '../db';
import type { Env } from '../types';
import { isPublisher, listedNonPublisher, tally, type Answer } from './logic';

const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

/* ───────── roles ───────── */

export async function roleMap(env: Env): Promise<Partial<Record<Role, string>>> {
  const { results } = await env.DB.prepare(
    'SELECT r.role, r.agent_id FROM agent_roles r JOIN agents a ON a.agent_id = r.agent_id',
  ).all<{ role: Role; agent_id: string }>();
  const out: Partial<Record<Role, string>> = {};
  for (const row of results ?? []) if ((ROLES as readonly string[]).includes(row.role)) out[row.role] = row.agent_id;
  return out;
}

export async function setRole(env: Env, role: Role, agentId: string | null): Promise<void> {
  if (!agentId) {
    await env.DB.prepare('DELETE FROM agent_roles WHERE role = ?').bind(role).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO agent_roles (role, agent_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (role) DO UPDATE SET agent_id = excluded.agent_id, updated_at = excluded.updated_at`,
  )
    .bind(role, agentId, now())
    .run();
}

export async function readyEngines(env: Env): Promise<Engine[]> {
  const roles = await roleMap(env);
  return ENGINES.filter((e) => roles[scoutRole(e)]);
}

/* ───────── runs ───────── */

interface RunRow {
  id: string;
  kind: Run['kind'];
  vertical: Vertical | null;
  domain: string | null;
  questions: string;
  engines: string;
  status: Run['status'];
  step: Run['step'];
  step_detail: string | null;
  seed: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

const toRun = (row: RunRow): Run => ({
  id: row.id,
  kind: row.kind,
  vertical: row.vertical,
  domain: row.domain,
  questions: json(row.questions, []),
  engines: json(row.engines, []),
  status: row.status,
  step: row.step,
  stepDetail: row.step_detail,
  seed: row.seed === 1,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  error: row.error,
});

export async function getRun(env: Env, id: string): Promise<Run | null> {
  const row = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(id).first<RunRow>();
  return row ? toRun(row) : null;
}

export async function listRuns(env: Env, limit = 30): Promise<Run[]> {
  const { results } = await env.DB.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').bind(limit).all<RunRow>();
  return (results ?? []).map(toRun);
}

export async function activeRuns(env: Env): Promise<Run[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM runs WHERE status = 'running' ORDER BY started_at`).all<RunRow>();
  return (results ?? []).map(toRun);
}

export async function runsSince(env: Env, iso: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE seed = 0 AND started_at >= ?').bind(iso).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertRun(env: Env, run: Run): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs (id, kind, vertical, domain, questions, engines, status, step, step_detail, seed, started_at, finished_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      run.id, run.kind, run.vertical, run.domain, JSON.stringify(run.questions), JSON.stringify(run.engines),
      run.status, run.step, run.stepDetail, run.seed ? 1 : 0, run.startedAt, run.finishedAt, run.error,
    )
    .run();
}

export async function updateRun(env: Env, id: string, patch: Partial<Pick<Run, 'status' | 'step' | 'stepDetail' | 'finishedAt' | 'error'>>): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.status !== undefined) cols.status = patch.status;
  if (patch.step !== undefined) cols.step = patch.step;
  if (patch.stepDetail !== undefined) cols.step_detail = patch.stepDetail;
  if (patch.finishedAt !== undefined) cols.finished_at = patch.finishedAt;
  if (patch.error !== undefined) cols.error = patch.error;
  const keys = Object.keys(cols);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => cols[k]), id)
    .run();
}

export async function addEvent(env: Env, runId: string, text: string): Promise<void> {
  await env.DB.prepare('INSERT INTO events (run_id, text, created_at) VALUES (?, ?, ?)').bind(runId, text, now()).run();
}

export async function listEvents(env: Env, runId: string): Promise<RunEvent[]> {
  const { results } = await env.DB.prepare('SELECT id, run_id, text, created_at FROM events WHERE run_id = ? ORDER BY id').bind(runId).all<{
    id: number;
    run_id: string;
    text: string;
    created_at: string;
  }>();
  return (results ?? []).map((r) => ({ id: r.id, runId: r.run_id, text: r.text, createdAt: r.created_at }));
}

export async function listCalls(env: Env, runId: string) {
  const { results } = await env.DB.prepare('SELECT role, label, state, error FROM agent_calls WHERE run_id = ? ORDER BY created_at').bind(runId).all<{
    role: string;
    label: string;
    state: string;
    error: string | null;
  }>();
  return results ?? [];
}

/* ───────── state bag ───────── */

export async function loadState<T>(env: Env, runId: string, fallback: T): Promise<T> {
  const row = await env.DB.prepare('SELECT data FROM run_state WHERE run_id = ?').bind(runId).first<{ data: string }>();
  return json(row?.data, fallback);
}

export async function saveState(env: Env, runId: string, data: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO run_state (run_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (run_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(runId, JSON.stringify(data), now())
    .run();
}

/* ───────── answers and boards ───────── */

export async function insertAnswers(env: Env, runId: string, answers: Answer[]): Promise<void> {
  if (!answers.length) return;
  const statements = answers.map((a) =>
    env.DB.prepare('INSERT INTO answers (run_id, engine, query, cited, seen) VALUES (?, ?, ?, ?, ?)').bind(
      runId, a.engine, a.query, JSON.stringify(a.cited), JSON.stringify(a.seen),
    ),
  );
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
}

export async function runAnswers(env: Env, runId: string): Promise<Answer[]> {
  const { results } = await env.DB.prepare('SELECT engine, query, cited, seen FROM answers WHERE run_id = ? ORDER BY id').bind(runId).all<{
    engine: Engine;
    query: string;
    cited: string;
    seen: string;
  }>();
  return (results ?? []).map((r) => ({ engine: r.engine, query: r.query, cited: json(r.cited, []), seen: json(r.seen, []) }));
}

export async function siteFacts(env: Env, domains: string[]): Promise<Map<string, SiteFacts>> {
  const out = new Map<string, SiteFacts>();
  for (let i = 0; i < domains.length; i += 50) {
    const chunk = domains.slice(i, i + 50);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(`SELECT domain, facts FROM sites WHERE domain IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ domain: string; facts: string }>();
    for (const row of results ?? []) out.set(row.domain, json(row.facts, null as unknown as SiteFacts));
  }
  return out;
}

export async function saveFacts(env: Env, facts: SiteFacts): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sites (domain, facts, checked_at) VALUES (?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET facts = excluded.facts, checked_at = excluded.checked_at`,
  )
    .bind(facts.domain, JSON.stringify(facts), facts.checkedAt)
    .run();
}

/** A run's board: tallied answers, with the publisher flag from whatever code has checked. */
export async function boardFor(env: Env, runId: string): Promise<{ rows: (BoardRow & { pages: string[]; queries: string[] })[]; total: number; questions: number }> {
  const answers = await runAnswers(env, runId);
  const rows = tally(answers);
  const facts = await siteFacts(env, rows.slice(0, 40).map((r) => r.domain));
  for (const row of rows) {
    const f = facts.get(row.domain);
    row.publisher = f ? isPublisher(row.domain, f) : listedNonPublisher(row.domain) ? false : null;
  }
  return { rows, total: answers.length, questions: new Set(answers.map((a) => a.query)).size };
}

/** The latest finished vertical run per vertical: the leaderboard's source. */
export async function latestVerticalRuns(env: Env): Promise<Run[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM runs r WHERE kind = 'vertical' AND status = 'done' AND started_at = (
       SELECT MAX(started_at) FROM runs x WHERE x.kind = 'vertical' AND x.status = 'done' AND x.vertical = r.vertical)`,
  ).all<RunRow>();
  return (results ?? []).map(toRun);
}

/* ───────── leads ───────── */

interface LeadRow {
  id: string;
  run_id: string;
  vertical: Vertical;
  domain: string;
  score: number;
  answers: number;
  total: number;
  citations: number;
  pages: string;
  queries: string;
  owner: string | null;
  company_type: string | null;
  monetisation: string | null;
  ai_deal: string | null;
  contact_role: string | null;
  contact_name: string | null;
  contact_source_url: string | null;
  why: string | null;
  verdict: Lead['verdict'];
  verify_note: string | null;
  email: string | null;
  status: Lead['status'];
}

export async function runLeads(env: Env, runId: string): Promise<Lead[]> {
  const { results } = await env.DB.prepare('SELECT * FROM leads WHERE run_id = ? ORDER BY score DESC, answers DESC').bind(runId).all<LeadRow>();
  const rows = results ?? [];
  const facts = await siteFacts(env, rows.map((r) => r.domain));
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    vertical: r.vertical,
    domain: r.domain,
    score: r.score,
    answers: r.answers,
    total: r.total,
    citations: r.citations,
    pages: json(r.pages, []),
    queries: json(r.queries, []),
    facts: facts.get(r.domain) ?? null,
    owner: r.owner,
    companyType: r.company_type,
    monetisation: r.monetisation,
    aiDeal: r.ai_deal,
    contactRole: r.contact_role,
    contactName: r.contact_name,
    contactSourceUrl: r.contact_source_url,
    why: r.why,
    verdict: r.verdict,
    verifyNote: r.verify_note,
    email: r.email,
    status: r.status,
  }));
}

export async function insertLead(env: Env, lead: Omit<Lead, 'facts'>): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO leads (id, run_id, vertical, domain, score, answers, total, citations, pages, queries, owner, company_type,
       monetisation, ai_deal, contact_role, contact_name, contact_source_url, why, verdict, verify_note, email, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      lead.id, lead.runId, lead.vertical, lead.domain, lead.score, lead.answers, lead.total, lead.citations,
      JSON.stringify(lead.pages), JSON.stringify(lead.queries), lead.owner, lead.companyType, lead.monetisation, lead.aiDeal,
      lead.contactRole, lead.contactName, lead.contactSourceUrl, lead.why, lead.verdict, lead.verifyNote, lead.email, lead.status, now(),
    )
    .run();
}

export async function patchLead(
  env: Env,
  id: string,
  patch: Partial<Pick<Lead, 'owner' | 'companyType' | 'monetisation' | 'aiDeal' | 'contactRole' | 'contactName' | 'contactSourceUrl' | 'why' | 'verdict' | 'verifyNote' | 'email' | 'status'>>,
): Promise<void> {
  const map: Record<string, string> = {
    owner: 'owner', companyType: 'company_type', monetisation: 'monetisation', aiDeal: 'ai_deal', contactRole: 'contact_role',
    contactName: 'contact_name', contactSourceUrl: 'contact_source_url', why: 'why', verdict: 'verdict', verifyNote: 'verify_note',
    email: 'email', status: 'status',
  };
  const keys = Object.keys(patch).filter((k) => map[k] && (patch as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE leads SET ${keys.map((k) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => (patch as Record<string, unknown>)[k]), now(), id)
    .run();
}

/* ───────── the app's public origin, for report links in emails ───────── */

export async function rememberOrigin(env: Env, origin: string): Promise<void> {
  if ((await getSetting(env, 'origin')) !== origin) await setSetting(env, 'origin', origin);
}

export const appOrigin = async (env: Env): Promise<string> => (await getSetting(env, 'origin')) ?? '';
