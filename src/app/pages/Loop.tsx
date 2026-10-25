/**
 * The loop: what the app does, on one screen. Six steps sit on a ring and a token travels
 * it, from an AI answer citing a publisher to a booked call, then round again on the next
 * scheduled refresh. Each step shows a real example from the saved results.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VERTICAL_LABEL, type EngineState, type Lead } from '../../shared/engine';
import { splitEmail } from '../../shared/email';
import { api } from '../api';
import { Icon } from '../ui';

/* ───────── geometry: a 700 × 720 stage, scaled down to fit ───────── */

const W = 700;
const H = 720;
const CX = 350;
const CY = 350;
const R = 250;
const CIRC = 2 * Math.PI * R;
const START = -90;
const STEP_MS = 4200;

const at = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
};
const motionOk = () => typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Key = 'ask' | 'count' | 'report' | 'contact' | 'email' | 'call';
const ORDER: Key[] = ['ask', 'count', 'report', 'contact', 'email', 'call'];
const angleOf = (i: number) => START + i * 60;

interface StepDef {
  name: string;
  tags: { cls: string; text: string }[];
  icon: React.ReactNode;
  what: string;
  /** The guardrail code enforces on the way to the next step. */
  check: string;
}

const STEPS: Record<Key, StepDef> = {
  ask: {
    name: 'AI answers',
    tags: [{ cls: 't-ai', text: 'AI agents' }],
    icon: <path d="M4 5.5h16v10H9l-5 4zM8 9.5h8M8 12.5h5" />,
    what: 'Claude, Gemini and ChatGPT agents, running in the cloud, search the web for real UK buying questions and answer like a shopper would, citing the pages they lean on.',
    check: 'Only pages its own search returned',
  },
  count: {
    name: 'Leaderboard',
    tags: [{ cls: 't-eng', text: 'Engine check' }],
    icon: <path d="M3.5 20h17M6.5 16.5v-5M12 16.5V5.5M17.5 16.5v-8" />,
    what: 'Automated checks open every cited page, drops dead or off-topic ones, and counts how many answers cite each site. Marketplaces, forums and brands drop out, leaving the publishers AI already depends on.',
    check: 'Dead and off-topic pages dropped',
  },
  report: {
    name: 'Site report',
    tags: [{ cls: 't-new', text: 'The hook' }],
    icon: <path d="M6 3.5h9l3.5 3.5v13.5H6zM9 11h6.5M9 14.5h6.5M9 7.5h3" />,
    what: 'Each publisher gets a free report they will want to open: which buying questions AI cites them for, who sits next to them, and which AI bots their robots.txt lets in. That traffic is what Blankspace turns into revenue.',
    check: 'Publishers only, with deterministically counted facts',
  },
  contact: {
    name: 'Verified contact',
    tags: [
      { cls: 't-ai', text: 'AI agent' },
      { cls: 't-eng', text: 'Engine check' },
    ],
    icon: <path d="M12 12a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6zM4.5 20c.8-3.6 3.8-5.6 7.5-5.6s6.7 2 7.5 5.6" />,
    what: 'A profiler agent works out who owns the site and who to talk to first. The verification layer opens the page it cited and keeps the name only if it is really there, otherwise the lead falls back to the role.',
    check: 'Name found on a public page, or role only',
  },
  email: {
    name: 'First email',
    tags: [{ cls: 't-you', text: 'You' }],
    icon: <path d="M3.5 6h17v12h-17zM4 6.5l8 6.5 8-6.5" />,
    what: 'A first email built only from counted facts: their citations, the sites cited next to them, and their robots.txt. The ask is to open the free report. A person edits, approves or skips it.',
    check: 'Nothing is sent without a person',
  },
  call: {
    name: 'Booked call',
    tags: [{ cls: 't-you', text: 'You' }],
    icon: <path d="M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4M9 15l2 2 4-4" />,
    what: 'The publisher opens their report, sees how much AI answers already lean on them, and books a call with the Blankspace team. This is where the machine hands over to people.',
    check: 'Then the next vertical refreshes',
  },
};

interface Example {
  text: string;
  link?: { href: string; label: string };
}

export default function Loop(props: { engine: EngineState }) {
  const { engine } = props;
  const [leads, setLeads] = useState<Lead[] | null>(null);
  useEffect(() => {
    api<{ leads: Lead[] }>('/api/engine/leads')
      .then((r) => setLeads(r.leads))
      .catch(() => setLeads([]));
  }, []);

  /* ── the real example the walkthrough follows: the best verified lead ── */
  const stats = useMemo(() => {
    const publishers = new Set<string>();
    let answers = 0;
    for (const b of engine.boards) {
      answers += b.total;
      for (const r of b.rows) if (r.publisher !== false) publishers.add(r.domain);
    }
    const verified = (leads ?? []).filter((l) => l.verdict === 'verified').length;
    return { publishers: publishers.size, answers, verified };
  }, [engine.boards, leads]);

  const examples = useMemo((): Record<Key, Example> | null => {
    if (!leads) return null;
    const ranked = [...leads].sort((a, b) => Number(b.verdict === 'verified') - Number(a.verdict === 'verified') || b.score - a.score);
    const lead = ranked[0];
    if (!lead) return null;
    const board = engine.boards.find((b) => b.vertical === lead.vertical);
    const pubRows = (board?.rows ?? []).filter((r) => r.publisher !== false);
    const rank = pubRows.findIndex((r) => r.domain === lead.domain);
    const vertical = VERTICAL_LABEL[lead.vertical];
    const question = lead.queries[0];
    const subject = lead.email ? splitEmail(lead.email).subject : '';
    const who = lead.contactName ? `${lead.contactName}, ${lead.contactRole ?? 'contact'}` : lead.contactRole ?? 'the owner';
    return {
      ask: {
        text: question
          ? `“${question}” was one of ${board?.questions ?? 15} ${vertical.toLowerCase()} questions. ${lead.domain} was cited in ${lead.answers} of ${lead.total} answers.`
          : `${lead.domain} was cited in ${lead.answers} of ${lead.total} ${vertical.toLowerCase()} answers.`,
      },
      count: {
        text: rank >= 0
          ? `${lead.domain} ranks #${rank + 1} of ${pubRows.length} publishers on the ${vertical.toLowerCase()} board.`
          : `${pubRows.length} publishers made the ${vertical.toLowerCase()} board.`,
        link: { href: '#board', label: 'Open the leaderboard' },
      },
      report: {
        text: `The report ${lead.domain} would receive, with every number traced to a cited page.`,
        link: { href: `#report/${encodeURIComponent(lead.runId)}/${encodeURIComponent(lead.domain)}`, label: `Open ${lead.domain}’s report` },
      },
      contact: {
        text:
          lead.verdict === 'verified'
            ? `${who}. Verified the name on ${lead.contactSourceUrl ? new URL(lead.contactSourceUrl).pathname || '/' : 'the cited page'}.`
            : `First contact: ${who}. ${stats.verified} contacts across all verticals are verified so far.`,
        link: { href: '#leads', label: 'See all leads' },
      },
      email: {
        text: subject ? `Draft subject: “${subject}”` : 'A draft waits on the Leads page for a person to review.',
        link: { href: '#leads', label: 'Review the drafts' },
      },
      call: {
        text: 'The demo stops here on purpose: the conversation is run by the Blankspace team, not an agent.',
      },
    };
  }, [leads, engine.boards, stats.verified]);

  /* ── the stage: scale to fit ── */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Below ~560px the ring would shrink past legibility, so phones get a vertical track.
    const measure = () => {
      setScale(Math.min(1, el.clientWidth / W));
      setCompact(el.clientWidth < 560);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── the token: an angle tweened with requestAnimationFrame ── */
  const tokenRef = useRef<HTMLDivElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const angle = useRef(START);
  const frame = useRef(0);
  const paint = useCallback(() => {
    const p = at(angle.current);
    if (tokenRef.current) tokenRef.current.style.transform = `translate(${p.x - 11}px, ${p.y - 11}px)`;
    const frac = Math.max(0, Math.min(1, (angle.current - START) / 360));
    if (arcRef.current) arcRef.current.style.strokeDashoffset = String(CIRC * (1 - frac));
  }, []);
  /** Tween the token to an angle. Past a full lap it settles back on the start. */
  const moveTo = useCallback(
    (to: number) => {
      cancelAnimationFrame(frame.current);
      const from = angle.current;
      const settle = () => {
        if (angle.current >= START + 360) angle.current = START;
        paint();
      };
      if (!motionOk()) {
        angle.current = to;
        settle();
        return;
      }
      const t0 = performance.now();
      const dur = 1000;
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        angle.current = from + (to - from) * e;
        paint();
        if (t < 1) frame.current = requestAnimationFrame(tick);
        else settle();
      };
      frame.current = requestAnimationFrame(tick);
    },
    [paint],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => paint(), [paint, compact]);

  /* ── which step is shown, and the autoplay: one lap, then it settles ── */
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => {
      const next = (active + 1) % ORDER.length;
      setActive(next);
      if (next === 0) {
        moveTo(START + 360);
        setPlaying(false);
      } else moveTo(angleOf(next));
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, active, moveTo]);

  const panelRef = useRef<HTMLElement>(null);
  const pick = (i: number) => {
    setPlaying(false);
    // On phones the panel sits under the track, so bring it into view.
    if (compact) panelRef.current?.scrollIntoView({ behavior: motionOk() ? 'smooth' : 'auto', block: 'start' });
    setActive(i);
    moveTo(angleOf(i));
  };
  const play = () => {
    cancelAnimationFrame(frame.current);
    angle.current = START;
    paint();
    setActive(0);
    setPlaying(true);
  };

  const key = ORDER[active];
  const step = STEPS[key];
  const example = examples?.[key];
  const next = VERTICAL_LABEL[engine.autopilot.nextVertical];

  const hub = (
    <div className="card loop-hub">
      <span className="eyebrow">On repeat</span>
      <b className="disp">Every 6 hours</b>
      <p>
        A scheduled agent in the cloud refreshes the next vertical, so the board moves and new leads appear without anyone pressing a button.
      </p>
      <span className="tag t-mute">Next up: {next}</span>
    </div>
  );

  const panel = (
    <aside className="panel loop-panel" aria-live="polite" ref={panelRef}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">
          Step {active + 1} of {ORDER.length}
        </span>
        <div className="dots" aria-hidden>
          {ORDER.map((k, i) => (
            <i key={k} className={i === active ? 'on' : i < active ? 'past' : ''} />
          ))}
        </div>
      </div>
      <h2>{step.name}</h2>
      <div className="row">
        {step.tags.map((t) => (
          <span key={t.text} className={`tag ${t.cls}`}>
            {t.text}
          </span>
        ))}
      </div>
      <p className="muted">{step.what}</p>
      <div className="loop-example">
        <span className="eyebrow">In this demo</span>
        {examples === null && leads === null ? <span className="sk" style={{ width: '80%' }} /> : <p>{example?.text ?? 'Run a check to see a real example here.'}</p>}
        {example?.link && (
          <a className="button sm" href={example.link.href}>
            {example.link.label} <Icon name="right" />
          </a>
        )}
      </div>
      <div className="loop-guard">
        <Icon name="check" /> {step.check}
      </div>
      <div className="row loop-nav">
        <button className="sm" onClick={() => pick((active + ORDER.length - 1) % ORDER.length)} aria-label="Previous step">
          <Icon name="chevron" className="flip" />
        </button>
        <button className="sm" onClick={() => pick((active + 1) % ORDER.length)} aria-label="Next step">
          <Icon name="chevron" />
        </button>
        {playing ? (
          <button className="sm subtle" onClick={() => setPlaying(false)}>
            Pause
          </button>
        ) : (
          <button className="sm subtle" onClick={play}>
            <Icon name="play" /> Play from the start
          </button>
        )}
      </div>
    </aside>
  );

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">The loop</span>
          <h1>From an AI answer to a booked call, on repeat</h1>
          <p>
            AI shopping answers already send buyers to UK publishers. This app finds which ones, gives each a report worth opening, and hands
            the Blankspace team a checked contact and a first email. Then it does it again.
          </p>
          <div className="legend" aria-label="What the tags mean">
            <span className="item"><span className="tag t-ai">AI agent</span> runs in the cloud</span>
            <span className="item"><span className="tag t-eng">Engine check</span> the verification layer has the final say</span>
            <span className="item"><span className="tag t-new">The hook</span> what the publisher gets</span>
            <span className="item"><span className="tag t-you">You</span> a person decides</span>
          </div>
        </div>
        <div className="loop-stats">
          <div className="stat"><b>{stats.answers}</b><span>AI answers read</span></div>
          <div className="stat"><b>{stats.publishers}</b><span>publishers found</span></div>
          <div className="stat hot"><b>{leads ? stats.verified : '–'}</b><span>verified contacts</span></div>
        </div>
      </div>

      <div className="loop">
        <div className="loop-stage" ref={wrapRef}>
          {compact ? (
            <ol className="vtrack">
              {ORDER.map((k, i) => {
                const s = STEPS[k];
                return (
                  <li key={k} className={`vstep ${i === active ? 'is-active' : i < active ? 'is-past' : ''}`}>
                    <button className="vbtn" onClick={() => pick(i)} aria-label={`Step ${i + 1}: ${s.name}`}>
                      <span className="sbadge small">
                        <svg viewBox="0 0 24 24" aria-hidden>{s.icon}</svg>
                      </span>
                      <span className="vtext">
                        <span className="nm">{s.name}</span>
                        <span className="row">
                          {s.tags.map((t) => (
                            <span key={t.text} className={`tag ${t.cls}`}>{t.text}</span>
                          ))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              <li className="vback">
                <svg viewBox="0 0 16 16" aria-hidden><path d="M12.5 6A5 5 0 1 0 13 9.5M12.5 2.5V6H9" /></svg>
                Back to the start every 6 hours, next up {next}
              </li>
            </ol>
          ) : (
            <div className="stage-wrap" style={{ height: H * scale }}>
              <div className="stage" style={{ transform: `scale(${scale})` }}>
                <svg className="ring" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
                  <circle className="ringline" cx={CX} cy={CY} r={R} />
                  <circle
                    ref={arcRef}
                    className="arc"
                    cx={CX}
                    cy={CY}
                    r={R}
                    style={{ transform: `rotate(${START}deg)`, transformOrigin: `${CX}px ${CY}px`, strokeDasharray: CIRC, strokeDashoffset: CIRC }}
                  />
                  {ORDER.map((_, i) => {
                    const deg = angleOf(i) + 30;
                    const p = at(deg);
                    return (
                      <g key={deg} style={{ transform: `translate(${p.x}px, ${p.y}px) rotate(${deg + 90}deg)` }}>
                        <path className="arrow" d="M-5 -7 L5 0 L-5 7" />
                      </g>
                    );
                  })}
                </svg>
                <div className="token" ref={tokenRef} />

                {ORDER.map((k, i) => {
                  const p = at(angleOf(i));
                  const s = STEPS[k];
                  return (
                    <button
                      key={k}
                      className={`station ${i === active ? 'is-active' : ''}`}
                      style={{ left: p.x - 80, top: p.y - 46 }}
                      onClick={() => pick(i)}
                      aria-label={`Step ${i + 1}: ${s.name}. Show details`}
                      aria-pressed={i === active}
                    >
                      <span className="sbadge">
                        <svg viewBox="0 0 24 24" aria-hidden>{s.icon}</svg>
                        <span className="sbadge-n">{i + 1}</span>
                      </span>
                      <span className="nm">{s.name}</span>
                      <span className="row" style={{ justifyContent: 'center', gap: 4 }}>
                        {s.tags.map((t) => (
                          <span key={t.text} className={`tag ${t.cls}`}>{t.text}</span>
                        ))}
                      </span>
                    </button>
                  );
                })}

{hub}
              </div>
            </div>
          )}
        </div>
        {panel}
      </div>

      <section className="panel">
        <h2>Why this loop</h2>
        <ul className="facts loop-why">
          <li><b>The list finds itself.</b> The publishers worth calling are the ones AI answers already cite, so the engines do the prospecting.</li>
          <li><b>The hook keeps working.</b> A report and a leaderboard that refresh on schedule give every publisher a reason to open, share and come back.</li>
          <li><b>People stay where they matter.</b> Agents judge, the verification layer checks, and a person approves every email and runs every call.</li>
        </ul>
        <p className="muted small">
          Want the detail behind each step? <a href="#how">How it works</a> lists every check, or <a href="#check">run a check</a> on any site.
        </p>
      </section>
    </div>
  );
}
