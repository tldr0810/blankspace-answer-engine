/** AI answer share by vertical: the monthly leaderboard publishers would want to be on. */

import { useState, type CSSProperties } from 'react';
import { ENGINE_LABEL, VERTICALS, VERTICAL_LABEL, type Engine, type EngineState, type Run, type Vertical, type VerticalBoard } from '../../shared/engine';
import { api, ApiError } from '../api';
import SiteDrawer from '../components/SiteDrawer';
import { markTour } from '../components/Tour';
import { ago, ENGINE_VAR, EngineBar, Icon, SourceMark } from '../ui';

/** One engine's part of this run: how many answers came back, and whether any of them named a page. */
function EngineStatus({ board, engine }: { board: VerticalBoard; engine: Engine }) {
  const got = board.engineAnswers?.[engine];
  const note = !got ? 'no answers this run' : got.cited === 0 ? `${got.answers} answers, no pages cited, left out of the counts` : `cited pages in ${got.cited} answers`;
  const quiet = !got || got.cited === 0;
  return (
    <span className={`tag t-mute eng-status${quiet ? ' quiet' : ''}`}>
      <i className="dot" style={{ background: ENGINE_VAR[engine] }} />
      {ENGINE_LABEL[engine]}
      <small>{note}</small>
    </span>
  );
}

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
  const [open, setOpen] = useState<string | null>(null);
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
            pages.
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
                {board.questions} questions · {board.total} answers came back · {board.seed ? 'first run, 21 Oct 2026' : ago(board.runAt)}
              </p>
            )}
          </div>
          <div className="legend">
            {board && [...board.engines, ...(board.silent ?? [])].map((e) => <EngineStatus key={e} board={board} engine={e} />)}
          </div>
        </div>
        {board && rows.length > 0 && (
          <ul className="board-key" aria-label="How to read this board">
            <li>
              <b className="k-n">
                {rows[0].answers}
                <small>/{board.total}</small>
              </b>
              cited in {rows[0].answers} of the {board.total} answers; the bar's colour shows which AI
            </li>
            <li>
              <SourceMark verified /> a cited page was opened and covers the question
            </li>
            <li>
              <SourceMark verified={false} /> the site blocks automated checks, so not confirmed yet
            </li>
            <li>
              <span className="k-off">greyed</span> not a publisher (a shop, dealer, brand or forum, or no ads or affiliate links), so not a lead
            </li>
          </ul>
        )}
        {!board ? (
          <p className="empty">No run for this vertical yet.</p>
        ) : (
          <ol className="board big pick" key={board.runId}>
            {rows.map((r, i) => (
              <li key={r.domain} className={r.publisher === false ? 'off' : ''} style={{ '--i': i } as CSSProperties}>
                <button type="button" className="b-row" data-tour={i === 0 ? 'board' : undefined} aria-haspopup="dialog" aria-expanded={open === r.domain} onClick={() => { markTour('board'); setOpen(r.domain); }}>
                  <span className="rk">{i + 1}</span>
                  <span className="d">
                    <span className="dn">{r.domain}</span>
                    <SourceMark verified={r.verified} />
                  </span>
                  <EngineBar byEngine={r.byEngine} engines={board.engines} max={perEngine * board.engines.length} />
                  <span className="n">
                    {r.answers}
                    <small>/{board.total}</small>
                  </span>
                  <Icon name="chevron" className="b-go" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      {board && (
        <p className="muted small src-legend">
          Pages that are gone or off topic are left out of the counts ({props.engine.sources.dropped} so far, of{' '}
          {props.engine.sources.ok + props.engine.sources.dropped + props.engine.sources.blocked} checked). Pick any site to see the pages AI read.{' '}
          <a href={`#run/${board.runId}`}>See how this run went</a>.
        </p>
      )}
      {board && open && <SiteDrawer runId={board.runId} domain={open} fullReport onClose={() => setOpen(null)} />}
    </div>
  );
}
