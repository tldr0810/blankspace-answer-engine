/**
 * Check: the hand-started way in. The schedule refreshes one category every 6 hours on its own;
 * here a person types a site (how often do AI answers cite it?) or a buying question (who do AI
 * answers lean on?), picks the category, and watches the engine work.
 */

import { useMemo, useState } from 'react';
import { ENGINE_LABEL, VERTICALS, VERTICAL_LABEL, type EngineState, type Run, type Vertical, type VerticalBoard } from '../../shared/engine';
import { api, ApiError } from '../api';
import { ago, EngineTag, hostOf, Icon, OriginTag, Picker } from '../ui';

type Mode = 'site' | 'question';

type Example = { text: string; vertical: Vertical };

/** Used while the boards load, or for a vertical with no checked publisher yet: each vertical's top publisher on 25 Oct 2026. */
const FALLBACK_SITES: Example[] = [
  { text: 'carwow.co.uk', vertical: 'automotive' },
  { text: 'techradar.com', vertical: 'consumer_tech' },
  { text: 'runrepeat.com', vertical: 'running' },
  { text: 'uk.pcmag.com', vertical: 'b2b_software' },
  { text: 'headforpoints.com', vertical: 'travel' },
];

/**
 * One example site per vertical: the most-cited publisher on its latest board, skipping sites
 * that blocked every page check, so a click always lands on a site with real data behind it.
 * A site that tops two boards goes to the one where it has the larger share, and the other
 * vertical takes its next publisher.
 */
export function exampleSites(boards: VerticalBoard[]): Example[] {
  const candidates = new Map(
    boards.map((b) => [b.vertical, b.rows.filter((r) => r.publisher === true && r.verified !== false).map((r) => ({ domain: r.domain, share: b.total ? r.answers / b.total : 0 }))]),
  );
  const order = [...candidates.keys()].sort((a, b) => (candidates.get(b)![0]?.share ?? 0) - (candidates.get(a)![0]?.share ?? 0));
  const used = new Set<string>();
  const picked = new Map<Vertical, string>();
  for (const vertical of order) {
    const pick = candidates.get(vertical)!.find((c) => !used.has(c.domain));
    if (!pick) continue;
    used.add(pick.domain);
    picked.set(vertical, pick.domain);
  }
  return FALLBACK_SITES.map((fallback) => {
    const domain = picked.get(fallback.vertical);
    return domain ? { text: domain, vertical: fallback.vertical } : fallback;
  });
}

const QUESTION_EXAMPLES: Example[] = [
  { text: 'best electric car for a family of five', vertical: 'automotive' },
  { text: 'best headphones for working in a noisy office', vertical: 'consumer_tech' },
  { text: 'best trail shoes for wide feet', vertical: 'running' },
];

/**
 * The category a site already sits on: the board where it has the largest share of answers.
 * Lets the Check page pick the category that matches a typed site.
 */
export function siteVerticals(boards: VerticalBoard[]): Map<string, Vertical> {
  const best = new Map<string, { vertical: Vertical; share: number }>();
  for (const b of boards) {
    for (const r of b.rows) {
      if (r.publisher === false) continue;
      const share = b.total ? r.answers / b.total : 0;
      if (share > (best.get(r.domain)?.share ?? -1)) best.set(r.domain, { vertical: b.vertical, share });
    }
  }
  return new Map([...best].map(([domain, v]) => [domain, v.vertical]));
}

const siteOf = (raw: string) => {
  const value = raw.trim().toLowerCase();
  return value ? hostOf(value.includes('://') ? value : `https://${value}`) : '';
};

export function runTitle(run: Run): string {
  if (run.kind === 'site') return run.domain ?? 'Site check';
  if (run.kind === 'question') return `“${run.questions[0]}”`;
  return `All ${VERTICAL_LABEL[run.vertical!].toLowerCase()} questions`;
}

export default function Check(props: { engine: EngineState; admin: boolean; onStarted: () => Promise<void> }) {
  const { engine } = props;
  const [mode, setMode] = useState<Mode>('site');
  const [text, setText] = useState('');
  const [vertical, setVertical] = useState<Vertical>('consumer_tech');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The site whose board picked the category, so the note can say why it changed.
  const [matched, setMatched] = useState<string | null>(null);
  const known = useMemo(() => siteVerticals(engine.boards), [engine.boards]);

  const ready = engine.engines.length > 0;
  const left = Math.max(0, engine.limits.dailyLimit - engine.limits.runsToday);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'site' ? { kind: 'site', vertical, domain: text } : { kind: 'question', vertical, question: text };
      const { run } = await api<{ run: Run }>('/api/engine/runs', { method: 'POST', body: JSON.stringify(body) });
      await props.onStarted();
      location.hash = `#run/${run.id}`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const examples = mode === 'site' ? exampleSites(engine.boards) : QUESTION_EXAMPLES;
  const recent = engine.runs.filter((r) => !r.seed).slice(0, 8);
  // The grey hint is always a site from the chosen category, so the two never disagree.
  const hint = mode === 'site' ? (examples.find((ex) => ex.vertical === vertical) ?? examples[0]).text : 'best noise cancelling headphones under £200';

  const type = (value: string) => {
    setText(value);
    if (mode !== 'site') return;
    const site = siteOf(value);
    const on = known.get(site);
    // Switch once per site, so a category picked by hand afterwards stays.
    if (on && site !== matched) {
      setVertical(on);
      setMatched(site);
    } else if (!on) setMatched(null);
  };

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">Your check · you pick the site</span>
          <h1>How often do AI answers send buyers to your site?</h1>
          <p>
            The agents already refresh one category every 6 hours on their own (next up: {VERTICAL_LABEL[engine.autopilot.nextVertical]}), and
            what they find lands on the <a href="#board">Leaderboard</a> and <a href="#leads">Leads</a>. This page is the other way in: type a
            publisher’s site or a question a shopper would ask, pick its category and press Run. AI agents search the web and answer, automated
            checks count who they cite and how each site makes money, an agent finds who to talk to, and a first email is drafted for you to
            review.
          </p>
        </div>
      </div>

      <form className="panel check" onSubmit={(e) => void start(e)}>
        <div className="seg" role="tablist" aria-label="What to check">
          <button type="button" role="tab" aria-selected={mode === 'site'} onClick={() => setMode('site')}>
            A publisher’s site
          </button>
          <button type="button" role="tab" aria-selected={mode === 'question'} onClick={() => setMode('question')}>
            A buying question
          </button>
        </div>
        <div className="check-row" data-tour="live">
          <input
            id="check-text"
            type="text"
            value={text}
            onChange={(e) => type(e.target.value)}
            placeholder={hint}
            aria-label={mode === 'site' ? 'Site' : 'Buying question'}
            autoComplete="off"
          />
          <Picker
            className="check-vertical"
            value={vertical}
            onChange={(value) => setVertical(value as Vertical)}
            label="Category"
            options={VERTICALS.map((v) => ({ value: v, label: VERTICAL_LABEL[v] }))}
          />
          <button className="primary" type="submit" disabled={busy || !ready || !text.trim()}>
            <Icon name="play" /> {busy ? 'Starting…' : 'Run'}
          </button>
        </div>
        {mode === 'site' && matched && siteOf(text) === matched && (
          <p className="check-match small">
            <Icon name="check" /> {matched} is on the {VERTICAL_LABEL[known.get(matched)!]} leaderboard, so that category is picked.
            {known.get(matched) !== vertical && ` You changed it to ${VERTICAL_LABEL[vertical]}.`}
          </p>
        )}
        <div className="check-foot">
          <span className="muted small">
            {mode === 'site'
              ? `Asks 5 ${VERTICAL_LABEL[vertical].toLowerCase()} buying questions on every engine, then checks the site and finds who to talk to.`
              : 'Asks every engine this one question, then checks the sites they cite.'}
          </span>
          <span className="row">
            {examples.map((ex) => (
              <button
                key={`${ex.vertical}:${ex.text}`}
                type="button"
                className="chip-btn"
                title={mode === 'site' ? `Most-cited ${VERTICAL_LABEL[ex.vertical].toLowerCase()} publisher` : VERTICAL_LABEL[ex.vertical]}
                onClick={() => {
                  setText(ex.text);
                  setVertical(ex.vertical);
                  setMatched(null);
                }}
              >
                {ex.text}
              </button>
            ))}
          </span>
        </div>
        <div className="check-meta">
          {ready ? (
            <span className="row">
              <span className="muted small">Engines:</span>
              {engine.engines.map((e) => (
                <EngineTag key={e} engine={e} />
              ))}
            </span>
          ) : (
            <span className="warn small">No AI agents are connected right now, so live runs are off. The saved results below are real.</span>
          )}
          <span className="muted small">
            {props.admin ? 'Owner: no daily limit' : `${left} of ${engine.limits.dailyLimit} live runs left today`}
          </span>
        </div>
        {error && <div className="notice error">{error}</div>}
      </form>

      <div className="grid2">
        <section className="panel">
          <h2>Recent runs</h2>
          <p className="muted small">Both ways in: runs the schedule started every 6 hours, and checks people started here.</p>
          {recent.length === 0 ? (
            <p className="muted">None yet. Start one above; it takes a few minutes because real agents search the web.</p>
          ) : (
            <ul className="runlist">
              {recent.map((run) => (
                <li key={run.id}>
                  <a href={`#run/${run.id}`}>
                    <span className={`status s-${run.status}`}>{run.status === 'running' ? 'Live' : run.status === 'done' ? 'Done' : 'Stopped'}</span>
                    <b>{runTitle(run)}</b>
                    <span className="muted small">
                      <OriginTag origin={run.origin} /> {VERTICAL_LABEL[run.vertical!]} · {run.engines.map((e) => ENGINE_LABEL[e]).join(' + ')} · {ago(run.startedAt)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Already measured</h2>
          <p className="muted small">
            {engine.boards.reduce((n, b) => n + b.total, 0)} AI answers across {engine.boards.length} verticals. Open a vertical to see who
            AI answers lean on.
          </p>
          <ul className="runlist">
            {engine.boards.map((b) => (
              <li key={b.vertical}>
                <a href={`#board`} onClick={() => sessionStorage.setItem('board', b.vertical)}>
                  <b>{VERTICAL_LABEL[b.vertical]}</b>
                  <span className="muted small">
                    Top: {b.rows.filter((r) => r.publisher !== false)[0]?.domain ?? '–'} · {b.total} answers · {ago(b.runAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
