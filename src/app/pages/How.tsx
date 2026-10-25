import { useEffect, useRef, useState } from 'react';
import type { Learning } from '../../shared/engine';
import { api } from '../api';
import { markTour } from '../components/Tour';

/** How the engine works: who does what, and the guardrails. */

const STEPS: { who: string; tag: string; title: string; body: string }[] = [
  { who: 'AI agents', tag: 't-ai', title: 'Ask', body: 'Each engine (a Claude, a Gemini and optionally a ChatGPT agent, all running in the cloud) searches the web for every buying question like a UK shopper and lists the pages it would cite. A run starts in one of two ways: every 6 hours on its own for the next category (step 11), or when someone types a site or question on the Check page.' },
  { who: 'Verification layer', tag: 't-eng', title: 'Verify sources', body: 'A cited page must be one its own search returned, or it is dropped. Then the verification layer opens every cited page: a page that is gone, redirects to the home page or no longer covers the question is left out of every count. Sites that block automated checks stay in, marked unchecked.' },
  { who: 'Verification layer', tag: 't-eng', title: 'Count', body: 'Deterministic counting: how many answers cite each site, per engine, from the pages that passed.' },
  { who: 'Verification layer', tag: 't-eng', title: 'Check', body: 'For each cited site the verification layer reads ads.txt, a cited page (affiliate links, CDN headers) and robots.txt (which AI agents it lets in). Marketplaces, forums and brands drop out.' },
  { who: 'AI agent', tag: 't-ai', title: 'Profile', body: 'A profiler agent works out who owns each site and the best first contact, by simple rules: founder-run → founder, media company → commercial lead, large group → partnerships.' },
  { who: 'Verification layer', tag: 't-eng', title: 'Fact-check', body: 'The verification layer opens the page the profiler cited and keeps a name only if it is really there. In the first run, 7 of 20 suggested names survived; the rest fall back to the role.' },
  { who: 'Second AI agent', tag: 't-ai', title: 'Second review', body: 'A verifier agent, never the one that found the lead and ideally another model family, works through a checklist like an editor: is it a publisher that earns from traffic, is the contact right and still in the role, does the cited page answer the question. Every answer needs a verbatim quote; the verification layer opens the page and an answer whose quote is not there turns to unsure. Any no holds the lead back, all yes passes it, anything else goes to a person. It can also bring a better contact, which counts only once the verification layer finds the name on its page.' },
  { who: 'Verification layer', tag: 't-eng', title: 'Draft', body: 'The first email is built from counted facts only: their citations, the sites cited next to them, a page AI leaned on, and their robots.txt. Its ask is to open the free report.' },
  { who: 'You', tag: 't-you', title: 'Review', body: 'A person edits, approves or skips each draft. Nothing is sent from the app.' },
  { who: 'You and the verification layer', tag: 't-you', title: 'Learn', body: 'Your calls (good fit, not a publisher, wrong contact) and every site the verifier rules out with a quote the verification layer found are remembered. The next run skips ruled-out sites, the verifier sees your past calls as examples, and the score’s signals are compared with what you approved and skipped.' },
  { who: 'Scheduled agent', tag: 't-ai', title: 'Repeat', body: 'Every 6 hours a scheduled agent in the cloud asks the app to refresh the next vertical, so the leaderboard and leads keep moving without anyone pressing a button. Every 5 minutes the Worker re-checks a batch of cited pages, so each source is verified again within a week.' },
];

export default function How() {
  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">How it works</span>
          <h1>Agents judge, the verification layer checks</h1>
          <p>
            The engine finds publishers that AI shopping answers already depend on, shows them that traffic in a report they will want to open,
            and hands the Blankspace team a checked contact and a first email. New here? <a href="#loop">See the whole loop on one screen</a>.
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
      <LearningPanel />
      <section className="panel">
        <h2>Guardrails</h2>
        <ul className="facts">
          <li>No URL in an answer unless the engine’s own search returned it, and no page in a count unless automated checks opened it and found it on topic.</li>
          <li>No name on a lead unless automated checks found it on the cited public page. No guessed emails.</li>
          <li>No number in an email that was not counted deterministically.</li>
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

const pct = (yes: number, n: number) => (n ? `${Math.round((100 * yes) / n)}%` : '–');

/** What the flow has learned: sites it remembers, how each agent is doing, and the score against people's decisions. */
function LearningPanel() {
  const [data, setData] = useState<Learning | null>(null);
  const ref = useRef<HTMLElement>(null);
  // Seeing this panel is the tour's last step.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && markTour('learn'), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [data]);
  useEffect(() => {
    let cancelled = false;
    api<Learning>('/api/engine/learning')
      .then((d) => !cancelled && setData(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!data) return null;
  const v = data.verifier;
  const enough = data.decided >= data.needed;
  return (
    <section className="panel learn" ref={ref} data-tour="learn">
      <h2>How the flow gets better</h2>
      <p className="muted">
        Every check and every call a person makes is kept and used on the next run. Agents never change the rules on their own: a site is only remembered when the
        verification layer found the quote, or a person decided.
      </p>
      <div className="learn-grid">
        <div>
          <span className="eyebrow">Remembered sites</span>
          {data.rules.length ? (
            <ul className="learn-list">
              {data.rules.slice(0, 6).map((r) => (
                <li key={r.domain}>
                  <span className="row wrap">
                    <b>{r.domain}</b>
                    <span className={`tag ${r.rule === 'publisher' ? 't-eng' : 't-ret'}`}>{r.rule === 'publisher' ? 'Publisher' : 'Not a publisher'}</span>
                    <span className={`tag ${r.by === 'person' ? 't-you' : 't-ai'}`}>{r.by === 'person' ? 'by you' : 'by the verifier'}</span>
                  </span>
                  <span className="muted small">{r.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              None yet. When the verifier rules a site out with a quote, or you call a lead, the site is remembered here and later runs skip or keep it without asking again.
            </p>
          )}
        </div>
        <div>
          <span className="eyebrow">How each agent is doing</span>
          <dl className="learn-stats">
            <div>
              <dt>Profiler names confirmed</dt>
              <dd>
                <b>{data.profiler.confirmed}</b> of {data.profiler.suggested}
              </dd>
            </div>
            <div>
              <dt>Leads the verifier reviewed</dt>
              <dd>
                <b>{v.reviewed}</b> · {v.pass} passed, {v.reject} held back, {v.unsure} to a person
              </dd>
            </div>
            <div>
              <dt>Verifier calls you overturned</dt>
              <dd>{v.called ? <><b>{v.overturned}</b> of {v.called}</> : <span className="muted">none called yet</span>}</dd>
            </div>
          </dl>
          <p className="muted small">A rate that slips says which agent needs a better prompt or another model.</p>
        </div>
        <div>
          <span className="eyebrow">Score against your decisions</span>
          <table className="learn-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Points</th>
                <th>Approved with</th>
                <th>without</th>
              </tr>
            </thead>
            <tbody>
              {data.signals.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td>{s.points}</td>
                  <td>{enough ? pct(s.withYes, s.withN) : '–'}</td>
                  <td>{enough ? pct(s.withoutYes, s.withoutN) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {enough
              ? `From ${data.decided} decided leads. A signal approved no more often with it than without has earned fewer points; the weights change only when a person changes them.`
              : `Collecting: ${data.decided} of ${data.needed} decided leads (approve, skip or a call). The weights stay as they are until there is enough to compare.`}
          </p>
        </div>
      </div>
    </section>
  );
}
