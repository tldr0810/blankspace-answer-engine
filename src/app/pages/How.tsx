/** How the engine works: who does what, and the guardrails. */

const STEPS: { who: string; tag: string; title: string; body: string }[] = [
  { who: 'AI agents', tag: 't-ai', title: 'Ask', body: 'Each engine (a Claude, a Gemini and optionally a ChatGPT agent, all running in the cloud) searches the web for every buying question like a UK shopper and lists the pages it would cite.' },
  { who: 'Code', tag: 't-eng', title: 'Verify sources', body: 'A cited page must be one its own search returned, or it is dropped. Then code opens every cited page: a page that is gone, redirects to the home page or no longer covers the question is left out of every count. Sites that block automated checks stay in, marked unchecked.' },
  { who: 'Code', tag: 't-eng', title: 'Count', body: 'Code counts how many answers cite each site, per engine, from the pages that passed.' },
  { who: 'Code', tag: 't-eng', title: 'Check', body: 'For each cited site the Worker reads ads.txt, a cited page (affiliate links, CDN headers) and robots.txt (which AI agents it lets in). Marketplaces, forums and brands drop out.' },
  { who: 'AI agent', tag: 't-ai', title: 'Profile', body: 'A profiler agent works out who owns each site and the best first contact, by simple rules: founder-run → founder, media company → commercial lead, large group → partnerships.' },
  { who: 'Code', tag: 't-eng', title: 'Fact-check', body: 'Code opens the page the profiler cited and keeps a name only if it is really there. In the first run, 7 of 20 suggested names survived; the rest fall back to the role.' },
  { who: 'Code', tag: 't-eng', title: 'Draft', body: 'The first email is built from counted facts only: their citations, the sites cited next to them, a page AI leaned on, and their robots.txt. Its ask is to open the free report.' },
  { who: 'You', tag: 't-you', title: 'Review', body: 'A person edits, approves or skips each draft. Nothing is sent from the app.' },
  { who: 'Scheduled agent', tag: 't-ai', title: 'Repeat', body: 'Every 6 hours a scheduled agent in the cloud asks the app to refresh the next vertical, so the leaderboard and leads keep moving without anyone pressing a button. Every 5 minutes the Worker re-checks a batch of cited pages, so each source is verified again within a week.' },
];

export default function How() {
  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">How it works</span>
          <h1>Agents judge, code counts</h1>
          <p>
            The engine finds publishers that AI shopping answers already depend on, shows them that traffic in a report they will want to open,
            and hands the Blankspace team a checked contact and a first email.
          </p>
        </div>
      </div>
      <ol className="card lift how">
        {STEPS.map((s, i) => (
          <li key={s.title} className="how-step">
            <span className="how-n">{i + 1}</span>
            <div>
              <h3>
                {s.title} <span className={`tag ${s.tag}`}>{s.who}</span>
              </h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section className="panel">
        <h2>Guardrails</h2>
        <ul className="facts">
          <li>No URL in an answer unless the engine’s own search returned it, and no page in a count unless code opened it and found it on topic.</li>
          <li>No name on a lead unless code found it on the cited public page. No guessed emails.</li>
          <li>No number in an email that code did not count.</li>
          <li>Nothing is sent without a person. Each draft ends with a one-line opt-out.</li>
          <li>Agent tokens are encrypted in the database and never reach the browser. Retried agent calls reuse their message id, so they never bill twice.</li>
        </ul>
      </section>
      <section className="panel">
        <h2>What it costs and how long it takes</h2>
        <p className="muted">
          A site check asks 5 questions per engine and takes about 5 to 10 minutes. A full vertical asks 15 per engine and takes 10 to 25. In
          the first run, one vertical cost roughly US$2 of agent time per engine.
        </p>
      </section>
    </div>
  );
}
