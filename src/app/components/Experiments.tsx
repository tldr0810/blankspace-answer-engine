/**
 * What the machine tests first and how it knows it is working. Every number comes from the
 * same funnel the Leads page records (sent, report opened, replied, call booked). Until enough
 * emails have gone out, a clearly marked sample shows how the panel reads; Live switches to the
 * real counts.
 */

import { useEffect, useState } from 'react';
import { CONTACT_TYPE_LABEL, CONTACT_TYPES, contactType, EMAIL_VARIANTS, VARIANT_LABEL, VERTICAL_LABEL, VERTICALS, type ContactType, type EmailVariant, type Lead, type Vertical } from '../../shared/engine';
import { api } from '../api';

/** One email that went out, and what came of it. */
interface Sent {
  variant: EmailVariant;
  type: ContactType;
  vertical: Vertical;
  opened: boolean;
  replied: boolean;
  booked: boolean;
  /** When the call was booked, for calls per week. */
  bookedAt: number | null;
}

/** Rates mean little below this many sent. */
const MIN_SENT = 20;
const WEEK = 7 * 24 * 3600_000;

const fromLeads = (leads: Lead[]): Sent[] =>
  leads
    .filter((l) => l.outcome)
    .map((l) => {
      const st = l.outcome!.stage;
      return {
        variant: l.variant,
        type: contactType(l.contactRole),
        vertical: l.vertical,
        opened: l.reportOpens > 0 || st !== 'sent',
        replied: st !== 'sent',
        booked: st === 'booked',
        bookedAt: l.outcome!.at.booked ? Date.parse(l.outcome!.at.booked) : null,
      };
    });

/** A made-up month of sends, seeded so it reads the same on every visit. Each arm, contact type and vertical gets its own odds. */
function sample(): Sent[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const openOdds: Record<EmailVariant, number> = { A: 0.38, B: 0.52 };
  const replyOdds: Record<ContactType, number> = { partnerships: 0.32, commercial: 0.26, leadership: 0.38, editorial: 0.12, other: 0.15 };
  const types: ContactType[] = ['partnerships', 'partnerships', 'commercial', 'commercial', 'commercial', 'leadership', 'leadership', 'editorial', 'other'];
  const out: Sent[] = [];
  for (let i = 0; i < 140; i++) {
    const variant = EMAIL_VARIANTS[i % 2];
    const type = types[Math.floor(rnd() * types.length)];
    const vertical = VERTICALS[Math.floor(rnd() * VERTICALS.length)];
    const opened = rnd() < openOdds[variant] + (vertical === 'consumer_tech' ? 0.08 : 0);
    const replied = opened && rnd() < replyOdds[type];
    const booked = replied && rnd() < 0.55;
    out.push({ variant, type, vertical, opened, replied, booked, bookedAt: booked ? Date.now() - Math.floor(rnd() * 4) * WEEK : null });
  }
  return out;
}
const SAMPLE = sample();

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');

function Row(props: { label: string; rows: Sent[] }) {
  const n = props.rows.length;
  const c = (k: 'opened' | 'replied' | 'booked') => props.rows.filter((r) => r[k]).length;
  return (
    <tr>
      <td>{props.label}</td>
      <td>{n}</td>
      <td>{pct(c('opened'), n)}</td>
      <td>{pct(c('replied'), n)}</td>
      <td>{pct(c('booked'), n)}</td>
    </tr>
  );
}

function Breakdown<K extends string>(props: { title: string; note: string; keys: readonly K[]; label: (k: K) => string; of: (s: Sent) => K; rows: Sent[] }) {
  const groups = props.keys.map((k) => ({ k, rows: props.rows.filter((r) => props.of(r) === k) })).filter((g) => g.rows.length);
  return (
    <div>
      <span className="eyebrow">{props.title}</span>
      <table className="learn-table">
        <thead>
          <tr>
            <th />
            <th>Sent</th>
            <th>Opened</th>
            <th>Replied</th>
            <th>Booked</th>
          </tr>
        </thead>
        <tbody>
          {groups.length ? groups.map((g) => <Row key={g.k} label={props.label(g.k)} rows={g.rows} />) : (
            <tr>
              <td colSpan={5} className="muted">Nothing sent yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted small">{props.note}</p>
    </div>
  );
}

export default function Experiments() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [mode, setMode] = useState<'sample' | 'live' | null>(null);
  useEffect(() => {
    api<{ leads: Lead[] }>('/api/engine/leads')
      .then((r) => setLeads(r.leads))
      .catch(() => setLeads([]));
  }, []);

  const live = leads ? fromLeads(leads) : [];
  // Open on the real numbers once there are enough of them to read.
  const shown = mode ?? (live.length >= MIN_SENT ? 'live' : 'sample');
  const rows = shown === 'live' ? live : SAMPLE;
  const n = rows.length;
  const count = (k: 'opened' | 'replied' | 'booked') => rows.filter((r) => r[k]).length;
  const thisWeek = rows.filter((r) => r.bookedAt && r.bookedAt > Date.now() - WEEK).length;

  const targets = [
    { name: 'Report opened', why: 'The hook works: they want to see their own numbers.', value: n ? count('opened') / n : 0, goal: 0.4, show: pct(count('opened'), n), goalText: '40% of sent' },
    { name: 'Replied', why: 'The email reached the right person with a reason to talk.', value: n ? count('replied') / n : 0, goal: 0.1, show: pct(count('replied'), n), goalText: '10% of sent' },
    { name: 'Call booked', why: 'The conversation the machine exists to start.', value: n ? count('booked') / n : 0, goal: 0.05, show: pct(count('booked'), n), goalText: '5% of sent' },
    { name: 'Calls booked this week', why: '15 live sites to 40 by Christmas is 25 more in about 8 weeks. If one call in three signs, that is about 9 calls a week.', value: thisWeek, goal: 9, show: String(thisWeek), goalText: '9 a week' },
  ];

  return (
    <section className="panel experiments">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <h2>What we test first, and how we know it works</h2>
        <div className="tabs" role="group" aria-label="Which numbers">
          <button aria-pressed={shown === 'sample'} onClick={() => setMode('sample')}>Sample</button>
          <button aria-pressed={shown === 'live'} onClick={() => setMode('live')}>Live {leads ? live.length : ''}</button>
        </div>
      </div>
      {shown === 'sample' ? (
        <div className="notice sample-note">
          <b>Sample numbers.</b> A made-up month of 140 sent emails, to show how this panel reads once real emails go out. Live switches to what the Leads page has
          recorded{leads ? `: ${live.length} sent so far` : ''}.
        </div>
      ) : live.length < MIN_SENT ? (
        <div className="notice">Live, but only {live.length} sent so far. Rates settle after about {MIN_SENT} per row, so read these as early signs.</div>
      ) : null}

      <ol className="test-order">
        <li><b>Is the report opened?</b> The earliest signal, before anyone has to reply. If it isn’t, fix the hook before anything else.</li>
        <li><b>Which first email works?</b> Every site gets arm A or B by its name, so the split stays even without anyone picking.</li>
        <li><b>Who should we write to?</b> It is a different person at every publisher, so the reply rate by role says who to profile for.</li>
        <li><b>Which vertical first?</b> Put the scheduled runs where the booking rate is highest.</li>
      </ol>

      <span className="eyebrow">Working if</span>
      <table className="learn-table targets">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Target</th>
            <th>Now</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const early = t.name !== 'Calls booked this week' && n < MIN_SENT;
            const ok = t.value >= t.goal;
            return (
              <tr key={t.name}>
                <td>
                  <b>{t.name}</b>
                  <span className="muted small block">{t.why}</span>
                </td>
                <td>{t.goalText}</td>
                <td>{n || t.name === 'Calls booked this week' ? t.show : '–'}</td>
                <td>
                  <span className={`tag ${early ? 't-mute' : ok ? 't-eng' : 't-you'}`}>{early ? 'Too early' : ok ? 'On track' : 'Below'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="learn-grid">
        <Breakdown
          title="First email, A against B"
          note={`A: ${VARIANT_LABEL.A.toLowerCase()}. B: ${VARIANT_LABEL.B.toLowerCase()}. Call the winner once each arm has about 30 sent.`}
          keys={EMAIL_VARIANTS}
          label={(v) => `${v} · ${VARIANT_LABEL[v]}`}
          of={(s) => s.variant}
          rows={rows}
        />
        <Breakdown
          title="Who we wrote to"
          note="Read from each contact’s role. A type that books well is who the profiler should look for first."
          keys={CONTACT_TYPES}
          label={(k) => CONTACT_TYPE_LABEL[k]}
          of={(s) => s.type}
          rows={rows}
        />
        <Breakdown
          title="By vertical"
          note="Where to point the next scheduled runs."
          keys={VERTICALS}
          label={(v) => VERTICAL_LABEL[v]}
          of={(s) => s.vertical}
          rows={rows}
        />
      </div>
    </section>
  );
}
