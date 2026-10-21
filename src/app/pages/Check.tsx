/**
 * Home: run a live check. A visitor types a site (how often do AI answers cite it?) or a buying
 * question (who do AI answers lean on?), picks the vertical, and watches the engine work.
 */

import { useState } from 'react';
import { ENGINE_LABEL, VERTICALS, VERTICAL_LABEL, type EngineState, type Run, type Vertical } from '../../shared/engine';
import { api, ApiError } from '../api';
import { ago, EngineTag, Icon, Picker } from '../ui';

type Mode = 'site' | 'question';

const EXAMPLES: Record<Mode, { text: string; vertical: Vertical }[]> = {
  site: [
    { text: 'whathifi.com', vertical: 'consumer_tech' },
    { text: 'runnersworld.com', vertical: 'running' },
    { text: 'headforpoints.com', vertical: 'travel' },
  ],
  question: [
    { text: 'best electric car for a family of five', vertical: 'automotive' },
    { text: 'best headphones for working in a noisy office', vertical: 'consumer_tech' },
    { text: 'best trail shoes for wide feet', vertical: 'running' },
  ],
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

  const recent = engine.runs.filter((r) => !r.seed).slice(0, 8);

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">Live · UK buying questions</span>
          <h1>How often do AI answers send buyers to your site?</h1>
          <p>
            Type a publisher’s site or a question a shopper would ask. Real AI agents search the web and answer, code counts who they
            cite, checks how each site makes money, finds the right person and drafts the first email.
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
        <div className="check-row">
          <input
            id="check-text"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'site' ? 'whathifi.com' : 'best noise cancelling headphones under £200'}
            aria-label={mode === 'site' ? 'Site' : 'Buying question'}
            autoComplete="off"
          />
          <Picker
            className="check-vertical"
            value={vertical}
            onChange={(value) => setVertical(value as Vertical)}
            label="Vertical"
            options={VERTICALS.map((v) => ({ value: v, label: VERTICAL_LABEL[v] }))}
          />
          <button className="primary" type="submit" disabled={busy || !ready || !text.trim()}>
            <Icon name="play" /> {busy ? 'Starting…' : 'Run'}
          </button>
        </div>
        <div className="check-foot">
          <span className="muted small">
            {mode === 'site'
              ? `Asks 5 ${VERTICAL_LABEL[vertical].toLowerCase()} buying questions on every engine, then checks the site and finds who to talk to.`
              : 'Asks every engine this one question, then checks the sites they cite.'}
          </span>
          <span className="row">
            {EXAMPLES[mode].map((ex) => (
              <button
                key={ex.text}
                type="button"
                className="chip-btn"
                onClick={() => {
                  setText(ex.text);
                  setVertical(ex.vertical);
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
          <h2>Recent live runs</h2>
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
                      {VERTICAL_LABEL[run.vertical!]} · {run.engines.map((e) => ENGINE_LABEL[e]).join(' + ')} · {ago(run.startedAt)}
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
