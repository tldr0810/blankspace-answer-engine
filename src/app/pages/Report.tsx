/** The hook: the page a publisher receives. Their AI answer share, the pages AI read, who else gets cited. */

import { useEffect, useState } from 'react';
import { AI_AGENTS, ENGINE_LABEL, VERTICAL_LABEL, type CheckMiss, type SiteFacts, type SiteReport } from '../../shared/engine';
import { api } from '../api';
import SiteDrawer from '../components/SiteDrawer';
import { CountUp, EngineBar, EngineTag, Icon, NextStep, PageSkeleton, SilentEngines, SourceMark, VerdictTag } from '../ui';

export default function Report(props: { runId: string; domain: string }) {
  const [report, setReport] = useState<SiteReport | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setOpen(null);
    // The email's link ends in /email, so the open counts toward the funnel.
    const via = location.hash.endsWith('/email') ? '?via=email' : '';
    api<SiteReport>(`/api/engine/runs/${encodeURIComponent(props.runId)}/report/${encodeURIComponent(props.domain)}${via}`)
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
            <CountUp value={answers} /> <small className="muted">of {report.total}</small>
          </div>
        </div>
        <div className="kpi">
          <div className="l">Answer share</div>
          <div className="v"><CountUp value={share} />%</div>
        </div>
        <div className="kpi">
          <div className="l">Rank among publishers</div>
          <div className="v">{report.rank ? `#${report.rank}` : '–'}</div>
        </div>
        <div className="kpi">
          <div className="l">Pages AI relied on</div>
          <div className="v"><CountUp value={report.pages.length} /></div>
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
          <SilentEngines engines={report.silent ?? []} />
          <ol className="board pick">
            {(report.board.some((r) => r.domain === report.domain)
              ? report.board
              : [...report.board, { domain: report.domain, byEngine: report.row?.byEngine ?? {}, answers, verified: report.row?.verified }]
            ).map((r) => (
              <li key={r.domain} className={r.domain === report.domain ? 'you' : ''}>
                <button type="button" className="b-row" aria-haspopup="dialog" aria-expanded={open === r.domain} onClick={() => setOpen(r.domain)}>
                  <span className="d">
                    <span className="dn">{r.domain}</span>
                    <SourceMark verified={r.verified} />
                  </span>
                  <EngineBar byEngine={r.byEngine} engines={report.engines} max={max} />
                  <span className="n">{r.answers}</span>
                  <Icon name="chevron" className="b-go" />
                </button>
              </li>
            ))}
          </ol>
          <p className="muted small pick-hint">Pick any site to see the pages AI agents read and the questions it was cited for.</p>
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
          <a href={`#leads/${encodeURIComponent(report.domain)}`}>Open the draft email</a>
        </section>
      )}

      <NextStep href={`#leads/${encodeURIComponent(report.domain)}`} title={`Write to ${report.domain}`} text="This report is what the publisher gets. Their lead has the contact and a first email that links here." />

      {open && <SiteDrawer runId={report.runId} domain={open} fullReport={open !== report.domain} onClose={() => setOpen(null)} />}
    </article>
  );
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
