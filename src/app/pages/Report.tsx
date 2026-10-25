/** The hook: the page a publisher receives. Their AI answer share, the pages AI read, who else gets cited. */

import { useEffect, useState } from 'react';
import { AI_AGENTS, ENGINE_LABEL, VERTICAL_LABEL, type CheckMiss, type PageVerdict, type SiteFacts, type SiteReport } from '../../shared/engine';
import { api } from '../api';
import { EngineBar, EngineTag, PageSkeleton, SourceMark, VerdictTag } from '../ui';

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
  if (!report) return <PageSkeleton kind="report" label="Loading the report" />;
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
                <span className="d">
                  {r.domain}
                  <SourceMark verified={r.verified} />
                </span>
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
          <p className="muted small">Three public signals of whether this site lives on ad and affiliate money, the money AI answers take away when readers stop clicking through.</p>
          <MoneySignals facts={report.facts} />
        </section>
      </div>

      {report.pages.length > 0 && (
        <section className="panel">
          <h2>Your pages AI agents read</h2>
          <ul className="links">
            {report.pages.slice(0, 12).map((u) => (
              <li key={u} className="page-check">
                <a href={u} target="_blank" rel="noreferrer">
                  {u}
                </a>
                <PageVerdictTag verdict={report.pageVerdicts[u]} />
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

function PageVerdictTag({ verdict }: { verdict?: PageVerdict }) {
  if (verdict === 'ok') return <span className="tag t-eng">Checked: live, on topic</span>;
  if (verdict === 'blocked') return <span className="tag t-watch">Site blocks checks</span>;
  if (verdict) return <span className="tag t-err">{verdict === 'dead' ? 'Gone, not counted' : 'Off topic, not counted'}</span>;
  return <span className="tag t-mute">Not checked yet</span>;
}

const MISS_TEXT: Record<CheckMiss, string> = {
  bot_check: "Couldn't check: the site's bot protection stopped our automated request. That says nothing about the file itself, and the same wall turns away AI agents.",
  refused: "Couldn't check: the site refuses automated requests.",
  no_answer: "Couldn't check: the site didn't answer within 9 seconds.",
  not_a_file: 'Probably none: the address answers with a web page instead of the file.',
  error: "Couldn't check: the site returned a server error.",
};

function missText(miss?: CheckMiss) {
  return miss ? MISS_TEXT[miss] : "Couldn't check on the last run. It is checked again on the next run.";
}

/** ads.txt, affiliate links and the edge network, each with what it means for an ad-funded site. */
function MoneySignals({ facts }: { facts: SiteFacts | null }) {
  const ads = facts?.adsTxtLines;
  const cdn = facts?.cdn && facts.cdn !== 'unknown' ? facts.cdn : null;
  const edge = cdn && ['Cloudflare', 'Fastly', 'CloudFront', 'Akamai'].includes(cdn);
  const rows = [
    {
      label: 'Sells ad space',
      tag: ads == null ? null : ads > 0,
      value: ads == null ? missText(facts?.adsTxtMiss) : ads > 0 ? `Yes: its ads.txt lists ${ads} authorised ad sellers.` : 'No ads.txt file, so no programmatic ads.',
      why: 'ads.txt is a public file where a site names every company allowed to sell its ad space. A long list means display ads pay real bills.',
    },
    {
      label: 'Earns from affiliate links',
      tag: facts?.affiliate ?? null,
      value: facts?.affiliate == null ? missText(facts?.pageMiss) : facts.affiliate ? `Yes: affiliate links found on its ${facts.affiliateFrom ?? 'cited page'}.` : `None found on its ${facts.affiliateFrom ?? 'cited page'}.`,
      why: 'Links like Amazon or Skimlinks pay the site a cut when a reader buys. When an AI answer replaces the visit, that click never happens.',
    },
    {
      label: 'Edge network in front of the site',
      tag: cdn ? Boolean(edge) : null,
      value: cdn ? (edge ? `${cdn}.` : `${cdn} (no edge network detected).`) : 'Not detected.',
      why: 'Networks like Cloudflare or Fastly see every request before the site does, so AI agent visits can be spotted and priced there.',
    },
  ];
  return (
    <dl className="signals">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>
            {r.label}
            {r.tag == null ? <span className="tag t-mute">Unknown</span> : r.tag ? <span className="tag t-eng">Yes</span> : <span className="tag t-mute">No</span>}
          </dt>
          <dd>{r.value}</dd>
          <dd className="why-line">{r.why}</dd>
        </div>
      ))}
    </dl>
  );
}
