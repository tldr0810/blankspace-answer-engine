/**
 * A right-side drawer with one site's slice of a run: its share, the pages AI agents read and the
 * questions it was cited for. Opened from any leaderboard row; Escape, the scrim or the close
 * button shut it and focus returns to the row that opened it.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ENGINE_LABEL, VERTICAL_LABEL, type PageVerdict, type SiteReport } from '../../shared/engine';
import { api } from '../api';
import { EngineBar, Icon, SourceMark } from '../ui';

export function PageVerdictTag({ verdict }: { verdict?: PageVerdict }) {
  if (verdict === 'ok') return <span className="tag t-eng">Checked: live, on topic</span>;
  if (verdict === 'blocked') return <span className="tag t-watch">Site blocks checks</span>;
  if (verdict) return <span className="tag t-err">{verdict === 'dead' ? 'Gone, not counted' : 'Off topic, not counted'}</span>;
  return <span className="tag t-mute">Not checked yet</span>;
}

export default function SiteDrawer(props: { runId: string; domain: string; onClose: () => void; fullReport?: boolean }) {
  const [report, setReport] = useState<SiteReport | null>(null);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const { onClose } = props;

  useEffect(() => {
    setReport(null);
    setError('');
    let live = true;
    api<SiteReport>(`/api/engine/runs/${encodeURIComponent(props.runId)}/report/${encodeURIComponent(props.domain)}`)
      .then((r) => live && setReport(r))
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [props.runId, props.domain]);

  // Focus moves into the drawer, the page behind stops scrolling, and both come back on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const answers = report?.row?.answers ?? 0;
  const share = report?.total ? Math.round((answers / report.total) * 100) : 0;
  const max = report ? Math.max(1, ...report.board.map((r) => r.answers)) : 1;

  return (
    <div className="drawer-wrap" onKeyDown={onKey}>
      <div className="drawer-scrim" onClick={onClose} aria-hidden />
      <div className="drawer" ref={panel} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <div>
            <span className="eyebrow">{report ? `${VERTICAL_LABEL[report.vertical]} · AI answer share` : 'AI answer share'}</span>
            <h2 id="drawer-title">
              {props.domain}
              {report?.row && <SourceMark verified={report.row.verified} />}
            </h2>
          </div>
          <button ref={closeBtn} type="button" className="drawer-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="drawer-body">
          {error ? (
            <div className="notice error">{error}</div>
          ) : !report ? (
            <div className="drawer-loading" role="status" aria-label="Loading this site">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className="sk" style={{ width: `${90 - i * 12}%` }} />
              ))}
            </div>
          ) : (
            <>
              <div className="drawer-kpis">
                <div className="kpi hot">
                  <div className="l">Answers citing it</div>
                  <div className="v">
                    {answers} <small className="muted">of {report.total}</small>
                  </div>
                </div>
                <div className="kpi">
                  <div className="l">Share</div>
                  <div className="v">{share}%</div>
                </div>
                <div className="kpi">
                  <div className="l">Publisher rank</div>
                  <div className="v">{report.rank ? `#${report.rank}` : '–'}</div>
                </div>
              </div>
              {report.row && (
                <div className="drawer-bar">
                  <EngineBar byEngine={report.row.byEngine} engines={report.engines} max={max} />
                  <span className="muted small">
                    {report.engines.map((e) => `${ENGINE_LABEL[e]} ${report.row?.byEngine[e] ?? 0}`).join(' · ')}
                  </span>
                </div>
              )}

              <section>
                <h3>Pages AI agents read</h3>
                {report.pages.length === 0 ? (
                  <p className="muted small">No cited pages were logged for this site in this run.</p>
                ) : (
                  <ul className="drawer-pages">
                    {report.pages.slice(0, 12).map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer">
                          {u.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                        <PageVerdictTag verdict={report.pageVerdicts[u]} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {report.queries.length > 0 && (
                <section>
                  <h3>Questions where it was cited</h3>
                  <ul className="links">
                    {report.queries.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="drawer-callout">
                <h3>This is the view from outside</h3>
                <p>
                  Each citation is an AI agent that fetched the page to answer someone about to buy. The site’s analytics don’t show those
                  visits. Blankspace analytics is free and shows the real number: every AI request, by agent and by page, and what that
                  audience is worth.
                </p>
                <p className="muted small">
                  Method: {report.total} answers from {report.engines.length} AI {report.engines.length === 1 ? 'engine' : 'engines'} with live
                  web search, asked as a UK shopper. Answers vary by assistant and by day, so this is a sample, not server logs.
                </p>
              </section>
            </>
          )}
        </div>

        {props.fullReport && (
          <footer className="drawer-foot">
            <a className="button primary" href={`#report/${props.runId}/${props.domain}`} onClick={onClose}>
              Open the full report <Icon name="right" />
            </a>
          </footer>
        )}
      </div>
    </div>
  );
}
