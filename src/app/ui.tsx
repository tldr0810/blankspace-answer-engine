/** Small shared pieces: icons, engine colours, verdict tags, relative times. */

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ENGINE_LABEL, ORIGIN_HELP, ORIGIN_LABEL, PERSON_CALL_LABEL, type Engine, type Lead, type LeadReview, type RunOrigin } from '../shared/engine';

const ICON_PATHS = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  right: <path d="M3 8h10M9 4l4 4-4 4" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  out: <path d="M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5L7.5 8.5" />,
  play: <path d="M5 3.5v9l7-4.5z" />,
  down: <path d="M4 6l4 4 4-4" />,
  send: <path d="M2.5 7.5l11-5-4 11-2-4.5zM7.5 9l6-6.5" />,
};

export function Icon(props: { name: keyof typeof ICON_PATHS; size?: number; className?: string }) {
  const size = props.size ?? 14;
  return (
    <svg className={`icon ${props.className ?? ''}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden focusable="false">
      {ICON_PATHS[props.name]}
    </svg>
  );
}

export const ENGINE_VAR: Record<Engine, string> = { claude: 'var(--claude)', gemini: 'var(--gemini)', gpt: 'var(--gpt)' };

export function EngineTag({ engine }: { engine: Engine }) {
  return (
    <span className="tag t-mute">
      <i className="dot" style={{ background: ENGINE_VAR[engine] }} />
      {ENGINE_LABEL[engine]}
    </span>
  );
}

/** Answers per engine, one segment each, on a shared scale of `max` answers. */
export function EngineBar(props: { byEngine: Partial<Record<Engine, number>>; engines: Engine[]; max: number }) {
  return (
    <div className="ebar" role="img" aria-label={props.engines.map((e) => `${ENGINE_LABEL[e]} ${props.byEngine[e] ?? 0}`).join(', ')}>
      {props.engines.map((e) => (
        <i key={e} style={{ width: `${((props.byEngine[e] ?? 0) / Math.max(1, props.max)) * 100}%`, background: ENGINE_VAR[e] }} />
      ))}
    </div>
  );
}

/** Engines that were asked but cited nothing all run: said out loud, so a missing colour is never a mystery. */
export function SilentEngines({ engines }: { engines: Engine[] }) {
  if (!engines.length) return null;
  const names = engines.map((e) => ENGINE_LABEL[e]).join(' and ');
  return (
    <p className="small warn">
      {names} {engines.length === 1 ? 'was' : 'were'} asked too, but {engines.length === 1 ? 'its' : 'their'} web search returned nothing it could cite, so{' '}
      {engines.length === 1 ? 'its' : 'their'} answers are left out of these counts.
    </p>
  );
}

const ORIGIN_CLS: Record<RunOrigin, string> = { schedule: 't-ai', check: 't-you', owner: 't-you', seed: 't-mute' };

/** How a run, and so a lead, came in: the 6-hour schedule or a person. */
export function OriginTag({ origin }: { origin: RunOrigin }) {
  return (
    <span className={`tag ${ORIGIN_CLS[origin]}`} title={ORIGIN_HELP[origin]}>
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

export function VerdictTag({ lead }: { lead: Pick<Lead, 'verdict'> }) {
  switch (lead.verdict) {
    case 'verified':
      return <span className="tag t-eng"><Icon name="check" size={12} /> Contact checked</span>;
    case 'not_found':
      return <span className="tag t-watch">Name not on source, use role</span>;
    case 'fetch_blocked':
      return <span className="tag t-watch">Source blocked the check</span>;
    case 'no_person':
      return <span className="tag t-mute">Role only</span>;
    default:
      return <span className="tag t-mute">Checking…</span>;
  }
}

/** The verifier agent's decision on a lead, once code has checked its quotes. */
export function ReviewTag({ review }: { review: Pick<LeadReview, 'decision' | 'person'> | null }) {
  if (!review) return null;
  if (review.person) {
    const fit = review.person.call === 'fit';
    return <span className={`tag ${fit ? 't-you' : 't-ret'}`}>{PERSON_CALL_LABEL[review.person.call]} · person</span>;
  }
  switch (review.decision) {
    case 'pass':
      return <span className="tag t-ai"><Icon name="check" size={12} /> Reviewed</span>;
    case 'reject':
      return <span className="tag t-ret">Held back</span>;
    default:
      return <span className="tag t-watch">Needs a person</span>;
  }
}

export function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export interface PickerOption {
  value: string;
  label: string;
  /** A count shown on the right of the option, and after the label on the button. */
  count?: number;
  /** One short line under the option saying what it means. */
  hint?: string;
}

/** A dropdown drawn in the app's own style, in place of the browser's native select menu. */
export function Picker(props: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  /** Show a filled dot when a value is set and a dashed one when it is empty (role pickers). */
  dot?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = props.options.findIndex((o) => o.value === props.value);
  const current = props.options[selected];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const show = () => {
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    const option = props.options[i];
    if (option && option.value !== props.value) props.onChange(option.value);
  };

  const onKey = (e: KeyboardEvent) => {
    const last = props.options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const moves: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1) {
      const i = props.options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  const empty = props.dot && !props.value;
  return (
    <div className={`picker ${open ? 'open' : ''} ${props.className ?? ''}`} ref={root}>
      <button
        type="button"
        className={`picker-btn ${empty ? 'empty' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={props.label}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={props.disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        {props.dot && <i className="picker-dot" />}
        <span className="picker-val">
          {current?.label ?? ''}
          {current?.count !== undefined && <span className="picker-count">{current.count}</span>}
        </span>
        <Icon name="down" className="picker-chev" />
      </button>
      {open && (
        <ul className="picker-menu" role="listbox" id={listId} aria-label={props.label}>
          {props.options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={i === active ? 'active' : ''}
              style={{ '--i': i } as CSSProperties}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className="check">{i === selected && <Icon name="check" size={12} />}</span>
              <span className="picker-opt">
                <span className="picker-label">{o.label}</span>
                {o.hint && <span className="picker-hint">{o.hint}</span>}
              </span>
              {o.count !== undefined && <span className="picker-count">{o.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A site's source check, next to its name: a cited page opened and on topic, or every check refused. */
export function SourceMark({ verified }: { verified?: boolean | null }) {
  if (verified === true) {
    return (
      <span className="src-mark ok" role="img" aria-label="Source checked: a cited page loads and covers the question">
        <Icon name="check" size={11} />
      </span>
    );
  }
  if (verified === false) return <span className="src-mark unchecked" role="img" aria-label="Unchecked: the site blocks automated checks" />;
  return null;
}

/* ───────── skeletons: the page's shape while its data loads ───────── */

function SkLines(props: { widths: string[] }) {
  return (
    <div className="sk-stack">
      {props.widths.map((w, i) => (
        <span key={i} className="sk" style={{ width: w }} />
      ))}
    </div>
  );
}

export function SkeletonHeader() {
  return (
    <div className="sk-head" aria-hidden>
      <span className="sk" style={{ width: 110, height: 10 }} />
      <span className="sk" style={{ width: 'min(520px, 80%)', height: 34 }} />
      <span className="sk" style={{ width: 'min(640px, 95%)' }} />
      <span className="sk" style={{ width: 'min(420px, 70%)' }} />
    </div>
  );
}

export function SkeletonBoard(props: { rows?: number }) {
  return (
    <div className="sk-card sk-list" aria-hidden>
      {Array.from({ length: props.rows ?? 8 }, (_, i) => (
        <div key={i} className="sk-row" style={{ '--i': i } as CSSProperties}>
          <span className="sk" style={{ width: 18 }} />
          <span className="sk" style={{ width: `${150 - ((i * 23) % 60)}px` }} />
          <span className="sk round" style={{ flex: 1, height: 14, maxWidth: `${88 - i * 7}%` }} />
          <span className="sk" style={{ width: 34 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards(props: { count?: number }) {
  return (
    <div className="sk-grid2" aria-hidden>
      {Array.from({ length: props.count ?? 2 }, (_, i) => (
        <div key={i} className="sk-card">
          <span className="sk" style={{ width: '45%', height: 18 }} />
          <SkLines widths={['92%', '84%', '70%', '88%', '60%']} />
        </div>
      ))}
    </div>
  );
}

/** A whole page's placeholder, shaped like the page that is coming. */
export function PageSkeleton(props: { kind?: 'board' | 'run' | 'report' | 'leads' | 'page'; label?: string }) {
  const kind = props.kind ?? 'page';
  return (
    <div className="stack sk-page" role="status" aria-label={props.label ?? 'Loading'}>
      <SkeletonHeader />
      {kind === 'run' && (
        <div className="sk-card sk-steps" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="sk-row">
              <span className="sk circle" style={{ width: 24, height: 24 }} />
              <span className="sk" style={{ width: 90 }} />
            </span>
          ))}
        </div>
      )}
      {kind === 'report' && (
        <div className="sk-kpis" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="sk-card">
              <span className="sk" style={{ width: '60%', height: 10 }} />
              <span className="sk" style={{ width: '40%', height: 30 }} />
            </div>
          ))}
        </div>
      )}
      {(kind === 'board' || kind === 'leads') && <SkeletonBoard rows={kind === 'leads' ? 6 : 9} />}
      {(kind === 'run' || kind === 'report' || kind === 'page') && <SkeletonCards />}
    </div>
  );
}

/** The way on at the foot of a page, so the path through the app reads as one journey. */
export function NextStep(props: { href: string; title: string; text: string }) {
  return (
    <a className="next-step" href={props.href}>
      <span className="eyebrow">Next</span>
      <b>{props.title}</b>
      <span>{props.text}</span>
      <Icon name="chevron" className="next-chev" />
    </a>
  );
}

/** A number that counts up from zero when it first shows, so a page's headline figures arrive with it. */
export function CountUp(props: { value: number; ms?: number }) {
  const { value, ms = 700 } = props;
  const [shown, setShown] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0));
  const last = useRef(shown);
  last.current = shown;
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || value === 0) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const from = last.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return <span className="countup">{shown}</span>;
}
