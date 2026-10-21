/**
 * D1 access: the schema and the settings key/value store.
 *
 * The schema lives here as a string and is applied on the first request rather than
 * through migrations, because the "Deploy to Cloudflare" button provisions the database
 * but never runs a migration command — and because `npm run dev` should work with no
 * setup at all. Every statement is idempotent, so applying it repeatedly is free.
 *
 * This module deliberately imports nothing from crypto.ts: crypto.ts reads its key
 * material from `settings` through here, and one direction keeps that simple.
 */

import type { Env } from './types';

export const now = (): string => new Date().toISOString();

/* ───────── schema ───────── */

/**
 * Database schema. Add your own tables here — they are created on the next request.
 * Keep semicolons out of statement bodies: the splitter below treats every semicolon
 * as a statement boundary.
 */
const SCHEMA = `
-- Generic key/value store. The starter keeps its generated encryption key here;
-- the rest of the namespace is yours.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One in-flight Manyfold authorization handshake. device_code_* is the only thing that
-- can redeem agent tokens, so it is stored encrypted and never leaves the server; the
-- browser only ever sees the row id.
CREATE TABLE IF NOT EXISTS connect_sessions (
  id             TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL,
  user_code      TEXT NOT NULL,
  auth_url       TEXT NOT NULL,
  device_code_ct TEXT NOT NULL,
  device_code_iv TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);

-- Agents the user authorized. token_* is AES-GCM encrypted and never returned by the API.
CREATE TABLE IF NOT EXISTS agents (
  agent_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  rpc_url      TEXT NOT NULL,
  card_url     TEXT,
  token_ct     TEXT NOT NULL,
  token_iv     TEXT NOT NULL,
  expires_at   TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  warning      TEXT,
  connected_at TEXT NOT NULL
);

-- One conversation per agent. context_id / active_task_id give the agent multi-turn
-- memory across requests; both are cleared when the conversation is reset.
CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL UNIQUE,
  context_id     TEXT,
  active_task_id TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'complete',
  error           TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);

-- ═════════ Answer Share engine ═════════

-- Which connected Manyfold agent plays which role. Swappable from Settings.
CREATE TABLE IF NOT EXISTS agent_roles (
  role       TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One run: a whole vertical, one site, or one question. seed = 1 for the bundled first run.
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  vertical    TEXT,
  domain      TEXT,
  questions   TEXT NOT NULL,
  engines     TEXT NOT NULL,
  status      TEXT NOT NULL,
  step        TEXT NOT NULL,
  step_detail TEXT,
  seed        INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  error       TEXT
);

-- The runner's working memory for one run, so a crash or deploy resumes where it stopped.
CREATE TABLE IF NOT EXISTS run_state (
  run_id     TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every call to a Manyfold agent. id doubles as the A2A messageId, so a retried
-- submit can never bill a second turn.
CREATE TABLE IF NOT EXISTS agent_calls (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  role        TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  label       TEXT NOT NULL,
  task_id     TEXT,
  context_id  TEXT,
  state       TEXT NOT NULL,
  output_text TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  finished_at TEXT
);

-- One AI answer: which pages an engine cited for one question.
CREATE TABLE IF NOT EXISTS answers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL,
  engine   TEXT NOT NULL,
  query    TEXT NOT NULL,
  cited    TEXT NOT NULL,
  seen     TEXT NOT NULL
);

-- The latest code checks per site (ads.txt, affiliate links, CDN, robots.txt).
CREATE TABLE IF NOT EXISTS sites (
  domain     TEXT PRIMARY KEY,
  facts      TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

-- A site worth a conversation, with its contact and first email draft.
CREATE TABLE IF NOT EXISTS leads (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL,
  vertical           TEXT NOT NULL,
  domain             TEXT NOT NULL,
  score              INTEGER NOT NULL,
  answers            INTEGER NOT NULL,
  total              INTEGER NOT NULL,
  citations          INTEGER NOT NULL,
  pages              TEXT NOT NULL,
  queries            TEXT NOT NULL,
  owner              TEXT,
  company_type       TEXT,
  monetisation       TEXT,
  ai_deal            TEXT,
  contact_role       TEXT,
  contact_name       TEXT,
  contact_source_url TEXT,
  why                TEXT,
  verdict            TEXT NOT NULL DEFAULT 'pending',
  verify_note        TEXT,
  email              TEXT,
  status             TEXT NOT NULL DEFAULT 'draft',
  updated_at         TEXT NOT NULL
);

-- What happened, in words, for the run's live feed.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answers_run ON answers (run_id);
CREATE INDEX IF NOT EXISTS idx_leads_run ON leads (run_id);
CREATE INDEX IF NOT EXISTS idx_events_run ON events (run_id, id);
CREATE INDEX IF NOT EXISTS idx_calls_run ON agent_calls (run_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs (started_at);
`;

/**
 * Split SQL into statements: drop `--` comments first, then split on ';'.
 * Comments go first because they are allowed to contain punctuation that would
 * otherwise split a statement in half. Statement bodies are not.
 */
export function schemaStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

let initialized: Promise<void> | null = null;

/** Idempotent; runs at most once per isolate, and retries on the next request if it fails. */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!initialized) {
    initialized = db
      .batch(schemaStatements(SCHEMA).map((statement) => db.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        initialized = null;
        throw error;
      });
  }
  return initialized;
}

/* ───────── settings ───────── */

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, now())
    .run();
}

/** Writes only if the key is unset. Used for the generated encryption key, where
 *  concurrent first requests must converge on a single winner. */
export async function setSettingIfAbsent(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(key, value, now())
    .run();
}
