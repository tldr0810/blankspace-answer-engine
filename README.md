# Blankspace Answer Share

How often do AI shopping answers send buyers to a publisher's site? This app asks real AI agents
(Claude and Gemini running on Manyfold, optionally a ChatGPT agent) the questions UK shoppers ask,
counts who they cite, checks how each cited site makes money and which AI agents its robots.txt
lets in, finds the right person to talk to, and drafts a first email built only from counted facts.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tldr0810/blankspace-answer-engine)

## What you can do

- **Check a site.** Type a publisher's domain and a vertical. Every engine answers 5 buying
  questions; the app shows how often the site is cited, who is cited next to it, and a report
  page the publisher would want to open.
- **Check a question.** Type one buying question and see which sites the engines lean on.
- **Board.** Five verticals (automotive, consumer tech, running, B2B software, travel) measured in the
  first run, ranked by AI answer share per engine.
- **Leads.** Each lead has a score, a contact checked against a public page, and a draft email.
  You edit, approve or skip. Nothing is sent from the app.

## How a run works

Agents judge, code counts.

1. **Ask** (agents): each scout searches the web per question and lists what it would cite.
2. **Score** (code): a citation is kept only if that engine's own search returned it.
3. **Enrich** (code): the Worker reads ads.txt, a cited page and robots.txt for each site.
4. **Profile** (agent): owner, business model and the best first contact.
5. **Verify** (code): a contact name is kept only if it appears on the cited page.
6. **Draft** (code): the email uses counted facts only and ends with an opt-out line.

Each run is driven by a Durable Object alarm, so it keeps going after the browser closes.
Agents are called over A2A; tokens are sealed with AES-GCM in D1 and never reach the browser.

## Set up

1. Click **Deploy to Cloudflare** above (or connect the repo with Workers Builds). D1 and the
   Durable Object are created for you.
2. Set an owner password: `npx wrangler secret put ADMIN_PASSWORD`.
3. Open **Settings**, click **Connect Manyfold**, and approve the agents.
4. Assign roles: Claude scout, Gemini scout, optional ChatGPT scout, and a profiler.

Visitors can run site and question checks up to `DAILY_RUN_LIMIT` a day (12 by default). Full
vertical runs need the owner password. Each live run spends agent turns on your Manyfold account.

## Develop

```bash
npm install
npm run dev      # local Worker + Vite
npm run check    # typecheck + build + wrangler deploy --dry-run
npm test         # unit tests
npm run smoke -- https://your-app.workers.dev
```

## License

[MIT](LICENSE)
