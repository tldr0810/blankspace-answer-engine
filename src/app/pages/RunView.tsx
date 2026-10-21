/** One run, live: the steps, each engine's turn, the feed, who got cited, and the leads. */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ENGINE_LABEL, ROLE_LABEL, STEPS, STEP_LABEL, VERTICAL_LABEL, type Role, type RunDetail } from '../../shared/engine';
import { api } from '../api';
import { ago, EngineBar, EngineTag, Icon, PageSkeleton, SourceMark, VerdictTag } from '../ui';
import { runTitle } from './Check';

export default function RunView(props: { runId: string; admin: boolean; onChange: () => Promise<void> }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(await api<RunDetail>(`/api/engine/runs/${encodeURIComponent(props.runId)}`));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = detail?.run.status === 'running';
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [live, load]);
  useEffect(() => {
    if (detail && !live) void props.onChange();
    // Refresh the shell once when the run finishes.
  }, [live]);

  if (error) return <div className="notice error">{error}</div>;
  if (!detail) return <PageSkeleton kind="run" label="Loading the run" />;
  const { run } = detail;
  const steps = run.kind === 'question' ? STEPS.slice(0, 3) : STEPS;
  const at = run.step === 'done' ? steps.length : steps.indexOf(run.step as (typeof STEPS)[number]);
  const max = Math.max(1, ...detail.board.map((r) => r.answers));
  const perEngine = run.questions.length;

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">
            {run.kind === 'site' ? 'Site check' : run.kind === 'question' ? 'Question' : 'Vertical run'} · {VERTICAL_LABEL[run.vertical!]} ·{' '}
            {ago(run.startedAt)}
          </span>
          <h1>{runTitle(run)}</h1>
          <p>
            {run.questions.length} {run.questions.length === 1 ? 'question' : 'questions'} asked to {run.engines.map((e) => ENGINE_LABEL[e]).join(' and ')}.
            {run.seed && ' This is the bundled first run, made with agents on Manyfold on 21 October 2026.'}
          </p>
        </div>
        {run.kind === 'site' && run.status === 'done' && (
          <a className="button primary" href={`#report/${run.id}/${run.domain}`}>
            Open the report <Icon name="right" />
          </a>
        )}
      </div>

      <section className="panel run-steps">
        <div className="stepper">
          {steps.map((s, i) => (
            <span key={s} className="row" style={{ flex: i < steps.length - 1 ? '1 1 auto' : '0 0 auto', gap: 0 }}>
              <span className={`sp ${i < at ? 'done' : i === at && live ? 'now' : ''}`}>
                <span className="n">{i < at ? <Icon name="check" size={12} /> : i + 1}</span>
                {STEP_LABEL[s]}
              </span>
              {i < steps.length - 1 && <span className={`conn ${i < at ? 'done' : ''}`} />}
            </span>
          ))}
        </div>
        <div className="nowline">
          <span className={`pulse ${live ? 'live' : ''}`} style={run.status === 'failed' ? { background: 'var(--err)' } : run.status === 'done' ? { background: 'var(--eng)' } : undefined} />
          <span>
            <b>{run.status === 'running' ? 'Working' : run.status === 'done' ? 'Finished' : 'Stopped'}</b>{' '}
            {run.status === 'failed' ? run.error : run.stepDetail ?? (run.status === 'running' ? 'Agents are searching the web. A turn usually takes 2 to 6 minutes.' : '')}
          </span>
        </div>
        {detail.calls.length > 0 && (
          <div className="calls">
            {detail.calls.map((c, i) => (
              <span key={i} className={`tag ${c.state === 'completed' ? 't-eng' : c.state === 'invalid_output' || c.state === 'failed' ? 't-err' : 't-ai'}`}>
                {ROLE_LABEL[c.role as Role] ?? c.role}: {c.state === 'completed' ? 'done' : c.state === 'invalid_output' ? 'unreadable reply' : c.state}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Who the AI answers cited</h2>
          {detail.board.length === 0 ? (
            <p className="muted">{live ? 'Waiting for the first answers…' : 'No citations.'}</p>
          ) : (
            <>
              <div className="legend">
                {run.engines.map((e) => (
                  <EngineTag key={e} engine={e} />
                ))}
                <span className="muted small">Bar = answers citing the site, out of {perEngine} per engine</span>
              </div>
              <ol className="board">
                {detail.board.slice(0, 12).map((r, i) => (
                  <li
                    key={r.domain}
                    className={`${r.domain === run.domain ? 'you' : ''} ${r.publisher === false ? 'off' : ''}`}
                    style={{ '--i': i } as CSSProperties}
                  >
                    <span className="d">
                      {r.domain}
                      <SourceMark verified={r.verified} />
                    </span>
                    <EngineBar byEngine={r.byEngine} engines={run.engines} max={max} />
                    <span className="n">{r.answers}</span>
                  </li>
                ))}
              </ol>
              {run.kind === 'site' && !detail.board.some((r) => r.domain === run.domain) && run.step !== 'ask' && (
                <p className="notice">No engine cited {run.domain} for these questions. That is a finding too: the report shows who they cite instead.</p>
              )}
            </>
          )}
        </section>

        <section className="panel">
          <h2>What happened</h2>
          <ol className="feed">
            {detail.events.map((e) => (
              <li key={e.id}>
                <span className="muted small">{new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {detail.leads.length > 0 && (
        <section className="panel">
          <h2>{run.kind === 'site' ? 'Who to talk to' : 'Publishers worth a conversation'}</h2>
          <div className="leadgrid">
            {detail.leads.map((l) => (
              <a key={l.id} className="leadcard" href={`#report/${run.id}/${l.domain}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b className="mono">{l.domain}</b>
                  <span className="score">{l.score}</span>
                </div>
                <div className="muted small">
                  Cited in {l.answers} of {l.total} answers{l.facts?.adsTxtLines ? ` · ads.txt ${l.facts.adsTxtLines}` : ''}
                  {l.facts?.affiliate ? ' · affiliate links' : ''}
                </div>
                <div className="small">
                  {l.contactName ?? l.contactRole ?? 'Contact pending'}
                  {l.contactName && l.contactRole ? ` · ${l.contactRole}` : ''}
                </div>
                <VerdictTag lead={l} />
              </a>
            ))}
          </div>
          <p className="muted small">Drafts are on the Leads page. Nothing is sent from here.</p>
        </section>
      )}
    </div>
  );
}
