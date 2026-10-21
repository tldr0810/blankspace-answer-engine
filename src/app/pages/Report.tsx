/** The hook: the page a publisher receives. Their AI answer share, the pages AI read, who else gets cited. */

import { useEffect, useState } from 'react';
import { AI_AGENTS, ENGINE_LABEL, VERTICAL_LABEL, type SiteReport } from '../../shared/engine';
import { api } from '../api';
import { EngineBar, EngineTag, VerdictTag } from '../ui';

export default function Report(props: { runId: string; domain: string }) {
  const [report, setReport] = useState<SiteReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    api<SiteReport>(`/api/engine/runs/${encodeURIComponent(props.runId)}/report/${encodeURIComponent(props.domain)}`)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [props.runId, props.domain]);

  if (error) return <div className="notice error">{error}</div>;
  if (!report) return <p className="muted">Loading…</p>;
  const label = VERTICAL_LABEL[report.vertical].toLowerCase();
  const answers = report.row?.answers ?? 0;
  const share = report.total ? Math.round((answers / report.total) * 100) : 0;
  const robots = report.facts?.robots ?? {};
  const max = Math.max(1, ...report.board.map((r) => r.answers));

  return (
    <article className="report stack">
      <div className="ph">
        <div>
          <span className="eyebrow">AI Answer Share report · {VERTICAL_LABEL[report.vertical]}</span>
          <h1>{report.domain}</h1>
          <p>
            We asked {report.engines.map((e) => ENGINE_LABEL[e]).join(' and ')} the buying questions UK shoppers ask about {label}, with live web
            search, and logged every page they cited.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi hot">
          <div className="l">AI answers citing you</div>
          <div className="v">
            {answers} <small className="muted">of {report.total}</small>
          </div>
        </div>
        <div className="kpi">
          <div className="l">Answer share</div>
          <div className="v">{share}%</div>
        </div>
        <div className="kpi">
          <div className="l">Rank among publishers</div>
          <div className="v">{report.rank ? `#${report.rank}` : '–'}</div>
        </div>
        <div className="kpi">
          <div className="l">Pages AI relied on</div>
          <div className="v">{report.pages.length}</div>
        </div>
      </div>

      <div className="grid2">
        <section className="panel">
          <h2>Who AI answers rely on for {label}</h2>
          <div className="legend">
            {report.engines.map((e) => (
              <EngineTag key={e} engine={e} />
            ))}
          </div>
          <ol className="board">
            {report.board.map((r) => (
              <li key={r.domain} className={r.domain === report.domain ? 'you' : ''}>
                <span className="d">{r.domain}</span>
                <EngineBar byEngine={r.byEngine} engines={report.engines} max={max} />
                <span className="n">{r.answers}</span>
              </li>
            ))}
            {!report.board.some((r) => r.domain === report.domain) && (
              <li className="you">
                <span className="d">{report.domain}</span>
                <EngineBar byEngine={report.row?.byEngine ?? {}} engines={report.engines} max={max} />
                <span className="n">{answers}</span>
              </li>
            )}
          </ol>
        </section>

        <section className="panel">
          <h2>Which AI agents your robots.txt lets in</h2>
          {Object.keys(robots).length === 0 ? (
            <p className="muted">We could not read a robots.txt for this site.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Used for</th>
                  <th>Your rule</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(robots).map(([agent, ok]) => (
                  <tr key={agent}>
                    <td className="mono">{agent}</td>
                    <td className="muted">{AI_AGENTS[agent] ?? ''}</td>
                    <td>{ok ? <span className="tag t-eng">allowed</span> : <span className="tag t-err">blocked</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>How the site makes money, seen from outside</h3>
          <ul className="facts">
            <li>ads.txt: {report.facts?.adsTxtLines == null ? 'not readable' : report.facts.adsTxtLines ? `${report.facts.adsTxtLines} seller lines` : 'none'}</li>
            <li>Affiliate links on a cited page: {report.facts?.affiliate == null ? 'not readable' : report.facts.affiliate ? 'yes' : 'none found'}</li>
            <li>Served through: {report.facts?.cdn ?? 'unknown'}</li>
          </ul>
        </section>
      </div>

      {report.pages.length > 0 && (
        <section className="panel">
          <h2>Your pages AI agents read</h2>
          <ul className="links">
            {report.pages.slice(0, 12).map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer">
                  {u}
                </a>
              </li>
            ))}
          </ul>
          <h3>Questions where you were cited</h3>
          <ul className="links">
            {report.queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel callout-panel">
        <h2>This is the view from outside</h2>
        <p>
          Each citation is an AI agent that fetched your page to answer someone about to buy. Your analytics don’t show those visits.
          Blankspace analytics is free and shows the real number: every AI request, by agent and by page, and what that audience is worth.
        </p>
        <p className="muted small">
          Method: {report.total} answers from {report.engines.length} AI {report.engines.length === 1 ? 'engine' : 'engines'} with live web search,
          asked as a UK shopper. Answers vary by assistant and by day, so this is a sample, not your server logs.
        </p>
      </section>

      {report.lead && (
        <section className="panel">
          <h2>For the Blankspace team</h2>
          <div className="row">
            <span className="tag t-ink">Score {report.lead.score}</span>
            <VerdictTag lead={report.lead} />
            {report.lead.companyType && <span className="tag t-mute">{report.lead.companyType}</span>}
          </div>
          <p>
            Talk to: <b>{report.lead.contactName ?? report.lead.contactRole ?? 'unknown'}</b>
            {report.lead.contactName && report.lead.contactRole ? ` · ${report.lead.contactRole}` : ''}
          </p>
          {report.lead.owner && <p className="muted small">Owner: {report.lead.owner}</p>}
          {report.lead.verifyNote && <p className="muted small">Fact-check: {report.lead.verifyNote}</p>}
          <a href="#leads">Open the draft email</a>
        </section>
      )}
    </article>
  );
}
