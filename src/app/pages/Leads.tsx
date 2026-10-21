/**
 * Contacts and first-email drafts. The owner edits, approves or skips; nothing is sent from
 * the app. Names the fact-check could not confirm are shown as the role only.
 */

import { useEffect, useMemo, useState } from 'react';
import { VERTICAL_LABEL, type EngineState, type Lead, type RunDetail } from '../../shared/engine';
import { api, ApiError } from '../api';
import { hostOf, Icon, VerdictTag } from '../ui';

export default function Leads(props: { engine: EngineState; admin: boolean; needPassword: () => void }) {
  const runIds = useMemo(() => {
    const ids = props.engine.boards.map((b) => b.runId);
    for (const run of props.engine.runs) if (run.kind === 'site' && run.status === 'done' && !ids.includes(run.id)) ids.push(run.id);
    return ids;
  }, [props.engine]);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'verified' | 'approved'>('all');

  useEffect(() => {
    let cancelled = false;
    Promise.all(runIds.map((id) => api<RunDetail>(`/api/engine/runs/${encodeURIComponent(id)}`).catch(() => null))).then((details) => {
      if (cancelled) return;
      const all = details.flatMap((d) => d?.leads ?? []);
      setLeads(all.sort((a, b) => b.score - a.score));
    });
    return () => {
      cancelled = true;
    };
  }, [runIds]);

  if (!leads) return <p className="muted">Loading…</p>;
  const shown = leads.filter((l) => (filter === 'verified' ? l.verdict === 'verified' : filter === 'approved' ? l.status === 'approved' : true));
  const update = (id: string, patch: Partial<Lead>) => setLeads((all) => all!.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">Leads</span>
          <h1>Who to talk to, and what to say first</h1>
          <p>
            Each publisher the engine kept, the person or role to contact, whether code confirmed that name on a public page, and a first email
            built only from counted facts. Nothing is sent from here.
          </p>
        </div>
        <div className="tabs" role="tablist">
          {(['all', 'verified', 'approved'] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? `All ${leads.length}` : f === 'verified' ? `Checked contact ${leads.filter((l) => l.verdict === 'verified').length}` : `Approved ${leads.filter((l) => l.status === 'approved').length}`}
            </button>
          ))}
        </div>
      </div>

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
          <LeadRow key={l.id} lead={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} admin={props.admin} needPassword={props.needPassword} onUpdate={(p) => update(l.id, p)} />
        ))}
      </section>
    </div>
  );
}

function LeadRow(props: { lead: Lead; open: boolean; onToggle: () => void; admin: boolean; needPassword: () => void; onUpdate: (patch: Partial<Lead>) => void }) {
  const { lead } = props;
  const [text, setText] = useState(lead.email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const save = async (patch: { email?: string; status?: Lead['status'] }) => {
    if (!props.admin) {
      props.needPassword();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/api/engine/leads/${encodeURIComponent(lead.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      props.onUpdate(patch);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy is blocked here. Select the text instead.');
    }
  };

  return (
    <>
      <div className={`dr leadrow ${props.open ? 'cur' : ''} ${lead.status === 'skipped' ? 'off' : ''}`} onClick={props.onToggle} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' ? props.onToggle() : null)}>
        <span className={`chev ${props.open ? 'open' : ''}`}>
          <Icon name="chevron" />
        </span>
        <span className="fit">{lead.score}</span>
        <span className="n">
          <span className="nm">{lead.domain}</span>
          <span className="tag t-mute">{VERTICAL_LABEL[lead.vertical]}</span>
        </span>
        <span className="s">
          {lead.contactName ?? lead.contactRole ?? '–'}
          {lead.contactName && lead.contactRole ? ` · ${lead.contactRole}` : ''}
        </span>
        <span className="row">
          <VerdictTag lead={lead} />
          {lead.status !== 'draft' && <span className={`tag ${lead.status === 'approved' ? 't-you' : 't-mute'}`}>{lead.status}</span>}
        </span>
      </div>
      {props.open && (
        <div className="mail">
          <ul className="sig">
            <li>
              <span className="t">Cited</span> in {lead.answers} of {lead.total} AI answers · <a href={`#report/${lead.runId}/${lead.domain}`}>report</a>
            </li>
            {lead.owner && (
              <li>
                <span className="t">Owner</span> {lead.owner}
                {lead.companyType ? ` · ${lead.companyType}` : ''}
              </li>
            )}
            {lead.monetisation && (
              <li>
                <span className="t">Money</span> {lead.monetisation}
              </li>
            )}
            {lead.verifyNote && (
              <li>
                <span className="t">Check</span> {lead.verifyNote}{' '}
                {lead.contactSourceUrl && (
                  <a className="src" href={lead.contactSourceUrl} target="_blank" rel="noreferrer">
                    Source <b>{hostOf(lead.contactSourceUrl)}</b>
                  </a>
                )}
              </li>
            )}
          </ul>
          <div className="meta">To: {lead.verdict === 'verified' && lead.contactName ? `${lead.contactName} · ${lead.contactRole ?? ''}` : `${lead.contactRole ?? 'commercial lead'} (find the name before sending)`}</div>
          {props.admin ? <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} aria-label="Email draft" /> : <pre>{text}</pre>}
          <div className="mailbar">
            <span className="muted small">{props.admin ? 'Edits are saved to this draft only.' : 'Owner can edit and approve.'}</span>
            <span className="row">
              <button className="sm" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              {props.admin && text !== (lead.email ?? '') && (
                <button className="sm" disabled={saving} onClick={() => void save({ email: text })}>
                  Save edit
                </button>
              )}
              <button className="sm" disabled={saving} onClick={() => void save({ status: lead.status === 'skipped' ? 'draft' : 'skipped' })}>
                {lead.status === 'skipped' ? 'Restore' : 'Skip'}
              </button>
              <button className="primary sm" disabled={saving || lead.status === 'approved'} onClick={() => void save({ status: 'approved', email: text })}>
                {lead.status === 'approved' ? 'Approved' : 'Approve'}
              </button>
            </span>
          </div>
          {error && <div className="notice error">{error}</div>}
        </div>
      )}
    </>
  );
}
