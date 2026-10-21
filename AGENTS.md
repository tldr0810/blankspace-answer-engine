# Working on this repository

Rules for anyone, human or AI agent, iterating on this app. These are the load-bearing walls.

## How deployment works

- **Workers Builds is the deploy path.** Every push to `main` runs `npm run build` and then
  `npx wrangler deploy` on Cloudflare's side. CI (`.github/workflows/ci.yml`) only checks; it
  never deploys and holds no credentials.
- The build step is load-bearing: `wrangler deploy` deploys the output that
  `vite build` writes to `dist/` (via the Cloudflare Vite plugin's deploy-config redirect).
  Never deploy without building first, and never remove the `build` script.
- After every push, verify the deployment: `GET /api/health` must return HTTP 200 JSON, or
  run `npm run smoke -- <url>`.

## Invariants

1. **Keep `wrangler.jsonc` deployable.** `main`, `assets`, and the `DB` binding are read by
   the app. Never edit `database_id` — the Deploy button wrote the real one and changing it
   orphans the user's data.
2. **Keep `GET /api/health` returning 200 JSON.** It is the deploy-verification contract for
   smoke tests and for Workers Builds sanity checks.
3. **Evolve the database only through `SCHEMA` in `src/worker/db.ts`**, with
   `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Keep semicolons out of
   statement bodies (the splitter treats every `;` as a boundary). There is no migration
   step, and nothing may assume one.
4. **Never commit secrets.** New secrets get a commented entry in `.dev.vars.example` and an
   instruction to run `npx wrangler secret put NAME`. `.dev.vars` is git-ignored; keep it so.
5. **Respect the runtime split.** `src/worker/` runs in workerd only (no Node-built-ins),
   `src/app/` runs in the browser only, `src/shared/` must run in both.
6. **Preserve the credential-security invariants:**
   - the Manyfold device code and agent bearer tokens never appear in an API response, a log
     line, or the browser — they are AES-GCM sealed in D1 (`seal`/`unseal` in
     `src/worker/crypto.ts`);
   - connectivity checks use the non-billing `tasks/get` probe
     (`probeAgentAuth`), never `message/send` — a real turn bills the user;
   - agent-supplied URLs go through `validateA2AUrl` before use (SSRF guard);
   - error strings pass through `safeErrorText` before leaving the worker;
   - A2A `messageId`s are derived from the run id and role, not random, so retries cannot
     double-bill (`src/worker/engine/runner.ts`).
7. **Keep new routes behind the admin gate.** Any route added under `/api/` is protected by
   the `ADMIN_PASSWORD` middleware automatically. `/api/engine/*` is the one exception: it is
   public so visitors can run checks, and each route there gates itself (`adminOk`, daily
   limit, active-run cap). New engine routes that change settings or leads must check admin.
8. **Agents judge, code counts.** No URL, number or contact name produced by an agent reaches a
   board, report or email without a code check (`src/worker/engine/logic.ts`,
   `src/worker/engine/fetchers.ts`).

## Checks

Before pushing:

```bash
npm run check   # typecheck + build + wrangler deploy --dry-run
npm test        # vitest unit tests
```

After a deploy:

```bash
npm run smoke -- https://your-app.workers.dev
```

## What is safe to change

Everything else: styles, pages, prompts, scoring weights, extra tables and routes. Keep the
connect flow (`src/worker/connect.ts`, `src/worker/a2a.ts`, `src/worker/crypto.ts`).
