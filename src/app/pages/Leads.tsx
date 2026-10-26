/**
 * Contacts and first-email drafts. The owner edits To, Subject and body, then Send approves the
 * draft and opens their own mail app with it; the app itself never sends mail. Names the
 * fact-check could not confirm are shown as the role only.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { EDGE_CDNS, finalDecision, ORIGIN_LABEL, OUTCOME_LABEL, OUTCOME_STAGES, VARIANT_LABEL, type LeadOutcome, type OutcomeStage, PAID_LOOKUP, PERSON_CALL_LABEL, PERSON_CALLS, REVIEW_CHECK_LABEL, scoreParts, VERTICAL_LABEL, type EngineState, type Lead, type LeadReview, type PersonCall, type RunOrigin, type Verdict } from '../../shared/engine';
import { api, ApiError } from '../api';
import { markTour } from '../components/Tour';
import { isEmailAddress, joinEmail, mailtoHref, splitEmail, type EmailParts } from '../../shared/email';
import { hostOf, Icon, OriginTag, PageSkeleton, Picker, ReviewTag, VerdictTag } from '../ui';

const ORIGINS: RunOrigin[] = ['schedule', 'check', 'owner', 'seed'];
/** The call list: the first this many ranked leads are who to write to first. */
const TOP = 25;

export default function Leads(props: { engine: EngineState; focus: string | null }) {
  // Refetch when a run finishes, so new leads show without a reload.
  const doneRuns = props.engine.runs.filter((r) => r.status === 'done').map((r) => r.id).join(',');
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'verified' | 'approved'>('all');
  // The tag key starts folded so the list starts on the first screen.
  const [keyOpen, setKeyOpen] = useState(false);
  const [source, setSource] = useState<RunOrigin | 'any'>('any');
  // A link to #leads/<site> opens that site's lead at its email, once the list is in.
  const focused = useRef<string | null>(null);
  const scrollTo = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ leads: Lead[] }>('/api/engine/leads')
      .then((r) => !cancelled && setLeads(r.leads))
      .catch(() => !cancelled && setLeads((l) => l ?? []));
    return () => {
      cancelled = true;
    };
  }, [doneRuns]);

  useEffect(() => {
    if (!leads || !props.focus || focused.current === props.focus) return;
    focused.current = props.focus;
    const lead = leads.find((l) => l.domain === props.focus);
    if (!lead) return;
    setFilter('all');
    setSource('any');
    setOpen(lead.id);
    scrollTo.current = lead.id;
  }, [leads, props.focus]);
  // Scroll once the opened lead has rendered its email.
  useEffect(() => {
    if (!open || scrollTo.current !== open) return;
    scrollTo.current = null;
    document.getElementById(`email-${open}`)?.scrollIntoView({ block: 'center' });
  }, [open]);

  if (!leads) return <PageSkeleton kind="leads" label="Loading leads" />;
  const shown = leads
    .filter((l) => (filter === 'verified' ? l.verdict === 'verified' : filter === 'approved' ? l.status === 'approved' : true))
    .filter((l) => source === 'any' || l.origin === source);
  const sources = ORIGINS.filter((o) => leads.some((l) => l.origin === o));
  // Leads arrive ranked by score. A lead the verifier held back or a person skipped gets no rank.
  const rank = new Map<string, number>();
  for (const l of leads) if (finalDecision(l.review) !== 'reject' && l.status !== 'skipped') rank.set(l.id, rank.size + 1);
  const lastTop = [...shown].reverse().find((l) => (rank.get(l.id) ?? Infinity) <= TOP)?.id;
  // The tour points at the top lead, so its tip sits over the column headings rather than another lead.
  const tourLead = shown[0]?.id;
  // The funnel after the email: each stage counts every lead that reached it or went further.
  const reached = (st: OutcomeStage) => leads.filter((l) => l.outcome && OUTCOME_STAGES.indexOf(l.outcome.stage) >= OUTCOME_STAGES.indexOf(st)).length;
  const funnel = {
    ranked: rank.size,
    approved: leads.filter((l) => l.status === 'approved').length,
    sent: reached('sent'),
    opened: leads.filter((l) => l.outcome && (l.reportOpens > 0 || l.outcome.stage !== 'sent')).length,
    replied: reached('replied'),
    booked: reached('booked'),
  };
  const rate = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}% of sent` : 'none sent yet');
  const update = (id: string, patch: Partial<Lead>) => setLeads((all) => all!.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">Leads</span>
          <h1>Who to talk to, and what to say first</h1>
          <p>
            Each publisher the engine kept, one row per site across every run, the person or role to contact, whether automated checks confirmed that name on a public page, and a first email
            built only from counted facts. Nothing is sent from here.
          </p>
          <p>
            <b>Ranked by score, best first.</b> The top {TOP} are who to write to first. The list keeps growing past {TOP} because the agents keep
            finding publishers every 6 hours, so a new site that outscores one in the top {TOP} moves up on its own. A lead the second review held back
            gets no rank and sits at the bottom.
          </p>
          <p className="muted small">
            Leads come in two ways: <OriginTag origin="schedule" /> the scheduled agent refreshes one category on its own, and{' '}
            <OriginTag origin="check" /> someone types a site on the <a href="#check">Check</a> page. A site found both ways shows its latest run.
          </p>
        </div>
        <div className="row wrap lead-filters">
          <Picker
            className="lead-source"
            value={source}
            onChange={(value) => setSource(value as RunOrigin | 'any')}
            label="Source"
            options={[
              { value: 'any', label: 'All sources' },
              ...sources.map((o) => ({ value: o, label: `${ORIGIN_LABEL[o]} ${leads.filter((l) => l.origin === o).length}` })),
            ]}
          />
          <div className="tabs" role="tablist">
            {(['all', 'verified', 'approved'] as const).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? `All ${leads.length}` : f === 'verified' ? `Checked contact ${leads.filter((l) => l.verdict === 'verified').length}` : `Approved ${leads.filter((l) => l.status === 'approved').length}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="card funnel" aria-label="From lead to booked call">
        <ol className="funnel-steps">
          <li><b>{funnel.ranked}</b><span>Ranked</span></li>
          <li><b>{funnel.approved}</b><span>Approved</span></li>
          <li><b>{funnel.sent}</b><span>Sent</span></li>
          <li><b>{funnel.opened}</b><span>Report opened</span><small>{rate(funnel.opened, funnel.sent)}</small></li>
          <li><b>{funnel.replied}</b><span>Replied</span><small>{rate(funnel.replied, funnel.sent)}</small></li>
          <li className="hot"><b>{funnel.booked}</b><span>Call booked</span><small>{rate(funnel.booked, funnel.sent)}</small></li>
        </ol>
        <p className="muted small">
          Open a lead and mark what happened after the email; report opens count on their own from the email’s link. <a href="#how">How it works</a> reads these against targets.{' '}
          <b>CRM:</b> each stage is meant to sync to the team’s CRM (HubSpot, Salesforce or Attio) through a connector, and agents can read and update deals over MCP. Not connected in this build.
        </p>
      </section>

      <section className="card lead-key" aria-label="How to read this list">
        <div className="lk-score">
          <span className="eyebrow">Score, out of 100</span>
          <p className="score-sum">
            <b>60</b> × share of AI answers that cite the site <i>+</i> <b>15</b> runs ads (ads.txt) <i>+</i> <b>15</b> uses affiliate links <i>+</i> <b>10</b> sits on an edge CDN
          </p>
          <p className="muted small">
            Share of answers says how much AI already leans on the site. The other three say it earns from traffic and could put a price on AI bots at its CDN ({EDGE_CDNS.join(', ')}). Open a row to see its sum.
          </p>
        </div>
        <button type="button" className="sm lk-toggle" aria-expanded={keyOpen} onClick={() => setKeyOpen((o) => !o)}>
          {keyOpen ? 'Hide what the tags mean' : 'What the tags mean'}
          <Icon name="chevron" className={`chev ${keyOpen ? 'open' : ''}`} />
        </button>
        <div className={`lk-groups ${keyOpen ? '' : 'lk-closed'}`}>
          <div>
            <span className="eyebrow">Contact</span>
            <ul className="key-list">
              {KEY.map(([v, text]) => (
                <li key={v}>
                  <VerdictTag lead={{ verdict: v }} />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="eyebrow">Second review</span>
            <ul className="key-list">
              {REVIEW_KEY.map(([d, text]) => (
                <li key={d}>
                  <ReviewTag review={{ decision: d }} />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="eyebrow">Person</span>
            <ul className="key-list">
              <li>
                <span className="tag t-you">approved</span>
                <span>A person approved the email, with or without sending it yet.</span>
              </li>
              <li>
                <span className="tag t-mute">skipped</span>
                <span>Set aside. Restore brings it back.</span>
              </li>
              <li>
                <span className="tag t-you">Good fit · person</span>
                <span>Your call on a lead. It overrides the verifier and is remembered for the next runs.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="card lift clip">
        <div className="colh leadrow">
          <span />
          <span>Score</span>
          <span>Site</span>
          <span className="s">Contact</span>
          <span>Status</span>
        </div>
        {shown.length === 0 && <p className="empty">Nothing here yet.</p>}
        {shown.map((l) => (
          <Fragment key={l.id}>
          <LeadRow
            lead={l}
            tour={l.id === tourLead}
            open={open === l.id}
            onToggle={() => {
              if (open !== l.id) markTour('review');
              setOpen(open === l.id ? null : l.id);
            }} rank={rank.get(l.id)} onUpdate={(p) => update(l.id, p)} />
          {l.id === lastTop && rank.size > TOP && (
            <p className="top-line">
              <b>Top {TOP} above.</b> {rank.size - TOP} more ranked below, next in line as new runs come in.
            </p>
          )}
          </Fragment>
        ))}
      </section>
    </div>
  );
}

/** Where to write: an address read on a public page, none published, or not looked for yet. */
function AddressFact({ lead }: { lead: Lead }) {
  const a = lead.address;
  if (!a) return <span className="sub">Not looked for yet. The verification layer reads the site’s contact pages within the next few minutes.</span>;
  if (!a.email) {
    return (
      <>
        <span className="row wrap">
          None published <span className="tag t-mute">no address</span>
        </span>
        <span className="sub">{a.note} Planned: {PAID_LOOKUP} for sites like this.</span>
      </>
    );
  }
  return (
    <>
      <span className="row wrap">
        <b className="mono addr">{a.email}</b>
        <span className="tag t-eng">Found on page</span>
      </span>
      <span className="sub">
        {a.kind === 'person' ? 'Their own address' : 'A shared inbox'}, {a.foundBy === 'agent' ? 'suggested by the profiler agent and confirmed on the page' : 'read by the verification layer on the site’s own page'}.
      </span>
      {a.sourceUrl && (
        <a className="src" href={a.sourceUrl} target="_blank" rel="noreferrer">
          Source <b>{hostOf(a.sourceUrl)}{new URL(a.sourceUrl).pathname.replace(/\/$/, '')}</b>
        </a>
      )}
    </>
  );
}

/** Where a lead stands, left to right: how it came in, the agent, the verification layer, then you. */
function LeadProgress({ lead, recipient }: { lead: Lead; recipient: string }) {
  const checked = lead.verdict === 'verified' ? 'Name found on a public page' : lead.verdict === 'fetch_blocked' ? 'Source page blocked the check' : 'No name confirmed, writes to the role';
  const yours = lead.status === 'approved' ? 'You approved it' : lead.status === 'skipped' ? 'You skipped it' : 'Your turn: approve or skip the draft';
  const address = !lead.address ? 'address not looked for yet' : lead.address.email ? 'address found on a page' : 'no address published';
  return (
    <ol className="lead-progress" aria-label="Where this lead stands">
      <li className="done">
        <span className="eyebrow">1 · Came in</span>
        <span>
          <OriginTag origin={lead.origin} /> <a href={`#run/${lead.runId}`}>See the run</a>
        </span>
      </li>
      <li className="done">
        <span className="eyebrow">2 · Agent</span>
        <span>
          <span className="tag t-ai">AI agent</span> Found {recipient}
        </span>
      </li>
      <li className="done">
        <span className="eyebrow">3 · Verification layer</span>
        <span>
          <span className="tag t-eng">Checked</span> {checked}
          {lead.review ? ', second review done' : ''}, {address}
        </span>
      </li>
      <li className={lead.status === 'draft' ? 'now' : 'done'}>
        <span className="eyebrow">4 · You</span>
        <span>
          <span className="tag t-you">Person</span> {yours}
        </span>
      </li>
    </ol>
  );
}

const KEY: [Verdict, string][] = [
  ['verified', 'Name found on the source page.'],
  ['not_found', 'Name not on the source page. Write to the role.'],
  ['fetch_blocked', 'The source page blocked the check. Look before sending.'],
  ['no_person', 'No public page names anyone. Write to the role.'],
];

const REVIEW_KEY: [LeadReview['decision'], string][] = [
  ['pass', 'A second agent passed all three checks, each backed by a quote found on the page.'],
  ['reject', 'A second agent showed, with a quote, it is not a publisher or the page does not answer. Kept at the bottom.'],
  ['unsure', 'Could not tell, its quote was not on the page, or the contact is wrong. A person decides.'],
];

function LeadRow(props: { lead: Lead; rank?: number; tour: boolean; open: boolean; onToggle: () => void; onUpdate: (patch: Partial<Lead>) => void }) {
  const { lead } = props;
  // An address the verification layer found fills an empty To line.
  const stored = (): EmailParts => {
    const parts = splitEmail(lead.email ?? '');
    return !parts.to && lead.address?.email ? { ...parts, to: lead.address.email } : parts;
  };
  const [draft, setDraft] = useState<EmailParts>(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const text = joinEmail(draft);
  const dirty = text !== joinEmail(stored());
  const named = lead.verdict === 'verified' && lead.contactName;
  const recipient = named ? `${lead.contactName}${lead.contactRole ? ` · ${lead.contactRole}` : ''}` : (lead.contactRole ?? 'commercial lead');
  const canSend = isEmailAddress(draft.to) && draft.subject.trim() !== '' && draft.body.trim() !== '';
  const set = (key: keyof EmailParts) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const save = async (patch: { email?: string; status?: Lead['status'] }) => {
    setSaving(true);
    setError('');
    try {
      await api(`/api/engine/leads/${encodeURIComponent(lead.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      props.onUpdate(patch);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const [calling, setCalling] = useState(false);
  const makeCall = async (call: PersonCall) => {
    setCalling(true);
    setError('');
    try {
      const r = await api<{ lead: Lead }>(`/api/engine/leads/${encodeURIComponent(lead.id)}/call`, { method: 'POST', body: JSON.stringify({ call }) });
      props.onUpdate({ review: r.lead.review, verdict: r.lead.verdict, verifyNote: r.lead.verifyNote });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCalling(false);
    }
  };

  const send = async () => {
    if (!(await save({ email: text, status: 'approved' }))) return;
    if (!lead.outcome) void track('sent');
    window.location.href = mailtoHref(draft);
  };

  const [tracking, setTracking] = useState(false);
  const track = async (stage: OutcomeStage | null) => {
    setTracking(true);
    setError('');
    try {
      const r = await api<{ outcome: LeadOutcome | null }>(`/api/engine/leads/${encodeURIComponent(lead.id)}/outcome`, { method: 'PUT', body: JSON.stringify({ stage }) });
      props.onUpdate({ outcome: r.outcome, ...(r.outcome ? { status: 'approved' as const } : {}) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTracking(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy is blocked here. Select the text instead.');
    }
  };

  return (
    <>
      <div className={`dr leadrow ${props.open ? 'cur' : ''} ${lead.status === 'skipped' ? 'off' : ''}`} data-tour={props.tour ? 'review' : undefined} onClick={props.onToggle} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' ? props.onToggle() : null)}>
        <span className={`chev ${props.open ? 'open' : ''}`}>
          <Icon name="chevron" />
        </span>
        <span className="fit">{lead.score}</span>
        <span className="n">
          {props.rank && <span className="rk">#{props.rank}</span>}
          <span className="nm">{lead.domain}</span>
          <span className="tag t-mute">{VERTICAL_LABEL[lead.vertical]}</span>
          <OriginTag origin={lead.origin} />
        </span>
        <span className="s">
          {lead.contactName ?? lead.contactRole ?? '–'}
          {lead.contactName && lead.contactRole ? ` · ${lead.contactRole}` : ''}
        </span>
        <span className="row">
          <VerdictTag lead={lead} />
          <ReviewTag review={lead.review} />
          {lead.outcome ? (
            <span className={`tag ${lead.outcome.stage === 'booked' ? 't-new' : 't-you'}`}>{OUTCOME_LABEL[lead.outcome.stage]}</span>
          ) : (
            lead.status !== 'draft' && <span className={`tag ${lead.status === 'approved' ? 't-you' : 't-mute'}`}>{lead.status}</span>
          )}
        </span>
      </div>
      {props.open && (
        <div className="lead-open">
          <LeadProgress lead={lead} recipient={recipient} />
          <aside className="facts" aria-label={`What we know about ${lead.domain}`}>
            <span className="eyebrow">The facts</span>
            <dl>
              <div>
                <dt>Score</dt>
                <dd>
                  <b className="big">
                    {lead.score}
                    <small> of 100</small>
                  </b>
                  <ScoreSum lead={lead} />
                </dd>
              </div>
              <div>
                <dt>Cited</dt>
                <dd>
                  <b className="big">
                    {lead.answers}
                    <small> of {lead.total}</small>
                  </b>
                  <span>
                    AI answers · <a href={`#report/${lead.runId}/${lead.domain}`}>see the report</a>
                  </span>
                </dd>
              </div>
              {lead.review && lead.review.checks.length > 0 && (
                <div>
                  <dt>Second review</dt>
                  <dd>
                    <ReviewTag review={{ decision: lead.review.decision }} />
                    <ReviewChecks review={lead.review} />
                    {lead.review.change && <span className="sub">{lead.review.change}</span>}
                  </dd>
                </div>
              )}
              <div>
                <dt>Your call</dt>
                <dd>
                  <span className="row wrap call-row">
                    {PERSON_CALLS.map((c) => (
                      <button key={c} className={`sm ${lead.review?.person?.call === c ? 'primary' : ''}`} disabled={calling} aria-pressed={lead.review?.person?.call === c} onClick={() => void makeCall(c)}>
                        {PERSON_CALL_LABEL[c]}
                      </button>
                    ))}
                  </span>
                  <span className="sub">
                    {lead.review?.person
                      ? `Called ${new Date(lead.review.person.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. The next runs remember it.`
                      : 'Overrides the verifier. Good fit and Not a publisher are remembered for this site on every later run.'}
                  </span>
                </dd>
              </div>
              {lead.owner && (
                <div>
                  <dt>Owner</dt>
                  <dd>
                    {lead.owner}
                    {lead.companyType && <span className="sub">{lead.companyType}</span>}
                  </dd>
                </div>
              )}
              {lead.monetisation && (
                <div>
                  <dt>Money</dt>
                  <dd>{lead.monetisation}</dd>
                </div>
              )}
              <div>
                <dt>Contact</dt>
                <dd>
                  <span className="row wrap">
                    {recipient} <VerdictTag lead={lead} />
                  </span>
                  {lead.verifyNote && <span className="sub">{lead.verifyNote}</span>}
                  {lead.contactSourceUrl && (
                    <a className="src" href={lead.contactSourceUrl} target="_blank" rel="noreferrer">
                      Source <b>{hostOf(lead.contactSourceUrl)}</b>
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  <AddressFact lead={lead} />
                </dd>
              </div>
            </dl>
          </aside>

          <section className="composer" id={`email-${lead.id}`} aria-label="Email draft">
            <header>
              <span className="eyebrow">Email</span>
              <span className="row">
                <span className="tag t-mute" title="The first-email test arm, fixed by the site's name">Test {lead.variant} · {VARIANT_LABEL[lead.variant]}</span>
                <span className={`tag ${lead.status === 'approved' ? 't-you' : 't-mute'}`}>{lead.status === 'draft' ? (dirty ? 'unsaved edits' : 'draft') : lead.status}</span>
              </span>
            </header>
            <label className="cf">
              <span>To</span>
              <input type="text" inputMode="email" autoComplete="off" spellCheck={false} value={draft.to} onChange={set('to')} placeholder={named ? `${lead.contactName}'s email address` : `Email address of the ${recipient}`} />
            </label>
            <label className="cf">
              <span>Subject</span>
              <input type="text" value={draft.subject} onChange={set('subject')} placeholder="Subject" />
            </label>
            <textarea className="cbody" value={draft.body} onChange={set('body')} aria-label="Email body" />
            <footer>
              <span className="muted small">
                {!isEmailAddress(draft.to) ? (
                  <>
                    {!lead.address
                      ? 'The verification layer is still reading the site’s contact pages for an address. You can approve the draft now.'
                      : `${lead.domain} publishes no address we could read. Approve the draft now and add an address when you find one; ${PAID_LOOKUP} is planned for these.`}{' '}
                    <a href={named && lead.contactSourceUrl ? lead.contactSourceUrl : `https://${lead.domain}`} target="_blank" rel="noreferrer">
                      Look on {named && lead.contactSourceUrl ? hostOf(lead.contactSourceUrl) : lead.domain}
                    </a>
                  </>
                ) : (
                  'Send approves the draft and opens your mail app with it.'
                )}
              </span>
              <span className="row">
                <button className="sm" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button className="sm" disabled={saving} onClick={() => void save({ status: lead.status === 'skipped' ? 'draft' : 'skipped' })}>
                  {lead.status === 'skipped' ? 'Restore' : 'Skip'}
                </button>
                {dirty && (
                  <button className="sm" disabled={saving} onClick={() => void save({ email: text })}>
                    Save draft
                  </button>
                )}
                {!canSend ? (
                  // No address yet: approving still records the call, so the flow learns from it.
                  <button className="primary sm" disabled={saving || lead.status === 'approved'} onClick={() => void save({ email: text, status: 'approved' })}>
                    <Icon name="check" />
                    {lead.status === 'approved' ? 'Approved' : 'Approve'}
                  </button>
                ) : (
                  <button className="primary sm" disabled={saving} onClick={() => void send()}>
                    <Icon name="send" />
                    {lead.status === 'approved' ? 'Send again' : 'Send'}
                  </button>
                )}
              </span>
            </footer>
            <div className="outcome" aria-label="After the email">
              <span className="eyebrow">After the email</span>
              <span className="row wrap">
                {OUTCOME_STAGES.map((st) => {
                  const reached = lead.outcome && OUTCOME_STAGES.indexOf(lead.outcome.stage) >= OUTCOME_STAGES.indexOf(st);
                  return (
                    <button key={st} className={`sm ${reached ? 'primary' : ''}`} disabled={tracking} aria-pressed={!!reached} onClick={() => void track(lead.outcome?.stage === st ? null : st)}>
                      {reached && <Icon name="check" />}
                      {OUTCOME_LABEL[st]}
                    </button>
                  );
                })}
              </span>
              <span className="muted small">
                {lead.outcome
                  ? `${OUTCOME_LABEL[lead.outcome.stage]} ${new Date(lead.outcome.at[lead.outcome.stage] ?? '').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. Press it again to undo.`
                  : 'Send marks it sent. Mark a reply or a booked call when it happens, so the funnel above stays true.'}
                {lead.reportOpens > 0 && ` Report opened ${lead.reportOpens} ${lead.reportOpens === 1 ? 'time' : 'times'} from the email.`}
              </span>
            </div>
            {error && <div className="notice error">{error}</div>}
          </section>
        </div>
      )}
    </>
  );
}

function ScoreSum({ lead }: { lead: Lead }) {
  const p = scoreParts(lead.answers, lead.total, lead.facts);
  const f = lead.facts;
  const rows: [string, number, number][] = [
    [`Cited in ${lead.answers} of ${lead.total} answers`, p.share, 60],
    [!f ? 'ads.txt not checked yet' : f.adsTxtLines ? `ads.txt, ${f.adsTxtLines} lines` : 'No ads.txt found', p.adsTxt, 15],
    [!f ? 'Affiliate links not checked yet' : f.affiliate ? 'Affiliate links on its pages' : 'No affiliate links found', p.affiliate, 15],
    [!f ? 'CDN not checked yet' : p.cdn ? `On ${f.cdn}` : `Not on an edge CDN${f.cdn !== 'unknown' ? ` (${f.cdn})` : ''}`, p.cdn, 10],
  ];
  return (
    <ul className="score-parts">
      {rows.map(([label, got, max]) => (
        <li key={label} className={got ? '' : 'zero'}>
          <span>{label}</span>
          <b>
            {got}
            <small>/{max}</small>
          </b>
        </li>
      ))}
    </ul>
  );
}

const ANSWER_MARK: Record<'yes' | 'no' | 'unsure', string> = { yes: 'Yes', no: 'No', unsure: 'Unsure' };

function ReviewChecks({ review }: { review: LeadReview }) {
  return (
    <ul className="review-checks">
      {review.checks.map((c) => (
        <li key={c.key} className={`a-${c.answer}`}>
          <span className="rc-head">
            <b>{ANSWER_MARK[c.answer]}</b>
            <span>{REVIEW_CHECK_LABEL[c.key]}</span>
          </span>
          {c.note && <span className="sub">{c.note}</span>}
          {c.quote && <q className="sub">{c.quote}</q>}
          {c.url && (
            <a className="src" href={c.url} target="_blank" rel="noreferrer">
              {c.quoteCheck === 'on_page' ? 'Quote found on' : c.quoteCheck === 'unreadable' ? 'Page blocked the check' : 'Source'} <b>{hostOf(c.url)}</b>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
