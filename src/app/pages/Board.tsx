/** AI answer share by vertical: the monthly leaderboard publishers would want to be on. */

import { useState, type CSSProperties } from 'react';
import { VERTICALS, VERTICAL_LABEL, type EngineState, type Run, type Vertical } from '../../shared/engine';
import { api, ApiError } from '../api';
import { ago, EngineBar, EngineTag } from '../ui';

const remembered = (): Vertical => {
  try {
    const v = sessionStorage.getItem('board');
    if (v && (VERTICALS as readonly string[]).includes(v)) return v as Vertical;
  } catch {
    /* storage blocked */
  }
  return 'running';
};

export default function Board(props: { engine: EngineState; admin: boolean; onStarted: () => Promise<void>; needPassword: () => void }) {
  const [vertical, setVertical] = useState<Vertical>(remembered);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const board = props.engine.boards.find((b) => b.vertical === vertical);
  const rows = board?.rows ?? [];
  const perEngine = board ? board.questions : 15;

  const pick = (v: Vertical) => {
    setVertical(v);
    try {
      sessionStorage.setItem('board', v);
    } catch {
      /* storage blocked */
    }
  };

  const rerun = async () => {
    if (!props.admin) {
      props.needPassword();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { run } = await api<{ run: Run }>('/api/engine/runs', { method: 'POST', body: JSON.stringify({ kind: 'vertical', vertical }) });
      await props.onStarted();
      location.hash = `#run/${run.id}`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">AI answer share</span>
          <h1>Who AI shopping answers lean on</h1>
          <p>
            Every buying question in a vertical, asked to each engine. A site’s bar is how many of those answers cited at least one of its
            pages. Greyed rows are marketplaces, forums or brands, not publishers.
          </p>
        </div>
        <button onClick={() => void rerun()} disabled={busy || props.engine.engines.length === 0}>
          {busy ? 'Starting…' : `Re-run ${VERTICAL_LABEL[vertical].toLowerCase()}`}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="tabs" role="tablist" aria-label="Vertical">
        {VERTICALS.map((v) => (
          <button key={v} role="tab" aria-pressed={v === vertical} onClick={() => pick(v)}>
            {VERTICAL_LABEL[v]}
          </button>
        ))}
      </div>

      <section className="card lift clip">
        <div className="lh">
          <div>
            <h2>{VERTICAL_LABEL[vertical]}</h2>
            {board && (
              <p>
                {board.total} answers · {board.questions} questions × {board.engines.length} engines · {board.seed ? 'first run, 21 Oct 2026' : ago(board.runAt)}
              </p>
            )}
          </div>
          <div className="legend">
            {(board?.engines ?? []).map((e) => (
              <EngineTag key={e} engine={e} />
            ))}
          </div>
        </div>
        {!board ? (
          <p className="empty">No run for this vertical yet.</p>
        ) : (
          <ol className="board big" key={board.runId}>
            {rows.map((r, i) => (
              <li key={r.domain} className={r.publisher === false ? 'off' : ''} style={{ '--i': i } as CSSProperties}>
                <span className="rk">{i + 1}</span>
                <a className="d" href={`#report/${board.runId}/${r.domain}`}>
                  {r.domain}
                </a>
                <EngineBar byEngine={r.byEngine} engines={board.engines} max={perEngine * board.engines.length} />
                <span className="n">
                  {r.answers}
                  <small>/{board.total}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {board && (
        <p className="muted small">
          Open any site for its report. <a href={`#run/${board.runId}`}>See how this run went</a>.
        </p>
      )}
    </div>
  );
}
