/**
 * Start here: a four-step tour for a first visit. A checklist card, never a modal: "Show me"
 * opens the right page and rings what to press, and each step ticks itself when the visitor
 * does it (pages call `markTour`). Each step says who does the work: an AI agent, the
 * verification layer, or a person. On wide screens it sits in the sidebar so it never covers
 * the page; on phones it floats at the bottom. Progress lives in this browser only, so the tour never
 * touches the shared data.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';

export type TourStep = 'loop' | 'board' | 'review' | 'learn';

type Spot = { id: TourStep | 'live'; hash: string; target: string; tip: string };
type Who = { cls: string; text: string };

/** Not a step: the wrap-up offers it, for visitors who want to watch the real agents work. */
const LIVE: Spot = { id: 'live', hash: 'check', target: '[data-tour="live"]', tip: 'Type any UK publisher’s site and press Run' };

const AI: Who = { cls: 't-ai', text: 'AI agents' };
const CHECK: Who = { cls: 't-eng', text: 'Verification layer' };
const YOU: Who = { cls: 't-you', text: 'Person' };

const STEPS: (Spot & { id: TourStep; title: string; text: string; who: Who[] })[] = [
  {
    id: 'loop',
    title: 'See the loop',
    text: 'Six steps from an AI answer to a booked call. Each step is tagged with who does it. Pick any step to see a real example from the saved runs.',
    who: [AI, CHECK, YOU],
    hash: 'loop',
    target: '[data-tour="loop"]',
    tip: 'Pick any step to see who does it',
  },
  {
    id: 'board',
    title: 'Who AI cites',
    text: 'Agents in the cloud asked Claude and Gemini real UK buying questions. The verification layer opened every cited page and counted only the ones that hold up. Open a site to see the pages AI read.',
    who: [AI, CHECK],
    hash: 'board',
    target: '[data-tour="board"]',
    tip: 'Open a site to see the pages AI read',
  },
  {
    id: 'review',
    title: 'Agents judge, checks verify',
    text: 'A profiler agent finds the contact and a second agent reviews the lead with quotes. The verification layer keeps a name or a quote only if it is really on the page. Open a lead to see the evidence and the draft email.',
    who: [AI, CHECK, YOU],
    hash: 'leads',
    target: '[data-tour="review"]',
    tip: 'Open a lead to see the evidence',
  },
  {
    id: 'learn',
    title: 'How it gets better',
    text: 'Your calls on leads and every site the verifier rules out are remembered, so the next run skips them and the verifier learns from your examples.',
    who: [CHECK, YOU],
    hash: 'how',
    target: '[data-tour="learn"]',
    tip: 'What the flow has learned so far',
  },
];

const KEY = 'blankspace-tour-1';
type Saved = { done: TourStep[]; open: boolean };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      const done = Array.isArray(s.done) ? s.done.filter((d) => STEPS.some((x) => x.id === d)) : [];
      // The wrap-up shows once; a later visit after finishing starts as the pill.
      return { done, open: done.length < STEPS.length && !!s.open };
    }
  } catch {
    /* storage can be blocked; the tour still works for this visit */
  }
  // On phones the card would cover the first screen, so it starts as the pill there.
  return { done: [], open: window.matchMedia('(min-width: 861px)').matches };
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Pages call this when the visitor does a step's action. */
export function markTour(step: TourStep) {
  window.dispatchEvent(new CustomEvent<TourStep>('blankspace-tour', { detail: step }));
}

const motionOk = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const visible = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.getClientRects().length > 0) ?? null;
const firstOpen = (done: TourStep[]) => STEPS.find((s) => !done.includes(s.id))?.id ?? null;

export default function Tour(props: { go: (hash: string) => void; docked: boolean }) {
  const [saved, setSaved] = useState<Saved>(load);
  const [current, setCurrent] = useState<TourStep | null>(() => firstOpen(saved.done));
  const [spot, setSpot] = useState<Spot | null>(null);
  const [nudge, setNudge] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const { done, open } = saved;
  const all = done.length === STEPS.length;

  const update = (next: Partial<Saved>) => setSaved((s) => ({ ...s, ...next }));
  const closeSpot = useCallback(() => setSpot(null), []);

  useEffect(() => save(saved), [saved]);
  // A finished step hands the card on to the next open one.
  useEffect(() => {
    if (!current || done.includes(current)) setCurrent(firstOpen(done));
  }, [done, current]);

  useEffect(() => {
    const onStep = (e: Event) => {
      const step = (e as CustomEvent<TourStep>).detail;
      setSaved((s) => {
        if (s.done.includes(step)) return s;
        const nextDone = [...s.done, step];
        // Finishing opens the card once for the wrap-up; otherwise the pill just nudges.
        return { done: nextDone, open: nextDone.length === STEPS.length ? true : s.open };
      });
      setSpot((s) => (s?.id === step ? null : s));
      setNudge(true);
    };
    window.addEventListener('blankspace-tour', onStep);
    return () => window.removeEventListener('blankspace-tour', onStep);
  }, []);

  useEffect(() => {
    if (!nudge) return;
    const t = window.setTimeout(() => setNudge(false), 1600);
    return () => window.clearTimeout(t);
  }, [nudge]);

  // Anything else pinned to the bottom corner sits above the tour rather than under it.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || props.docked) return;
    const set = () => document.documentElement.style.setProperty('--tour-h', `${el.offsetHeight + 12}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--tour-h');
    };
  }, [open, all, props.docked]);

  const showMe = (step: Spot) => {
    update({ open: false });
    setSpot(step);
    props.go(step.hash);
  };

  const restart = () => update({ done: [], open: true });

  const next = STEPS.find((s) => s.id === current);
  const n = next ? STEPS.indexOf(next) + 1 : STEPS.length;

  return (
    <>
      {spot && <Spotlight step={spot} onClose={closeSpot} />}
      {open ? (
        <div className={`tour ${props.docked ? 'docked' : ''}`} ref={rootRef as React.RefObject<HTMLDivElement>} role="dialog" aria-label="Start here">
          <div className="tour-head">
            <div>
              <div className="eyebrow">{all ? 'Tour complete' : 'Start here'}</div>
              <div className="disp tour-title">{all ? "That's the loop" : 'Four steps, about three minutes'}</div>
            </div>
            <button className="x" aria-label="Close the tour" onClick={() => update({ open: false })}>
              <Icon name="x" />
            </button>
          </div>
          <div className="tour-bar" aria-hidden>
            {STEPS.map((s) => (
              <i key={s.id} className={done.includes(s.id) ? 'on' : ''} />
            ))}
          </div>
          {all ? (
            <div className="tour-end">
              <p>
                Agents find and judge, the verification layer checks every name, number and quote, and a person makes every call that matters. Each
                call is remembered, so the next run starts smarter.
              </p>
              <div className="tour-live">
                <b>Try it on a real site.</b> Run a check and the agents in the cloud ask 5 buying questions per engine, then the verification layer
                counts who they cite. It takes about 5 to 10 minutes.
                <button className="sm" onClick={() => showMe(LIVE)}>
                  Show me where <Icon name="right" size={13} />
                </button>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="sm" onClick={() => { update({ open: false }); props.go('how'); }}>
                  How it works
                </button>
                <button className="link small" onClick={restart}>
                  Start over
                </button>
              </div>
            </div>
          ) : (
            <ol className="tour-steps">
              {STEPS.map((s, i) => {
                const isDone = done.includes(s.id);
                const isCur = s.id === current;
                return (
                  <li key={s.id} className={`${isDone ? 'done' : ''} ${isCur ? 'cur' : ''}`}>
                    <button className="tour-step" aria-expanded={isCur} onClick={() => setCurrent(s.id)}>
                      <span className="tour-n">{isDone ? <Icon name="check" size={13} /> : i + 1}</span>
                      <span className="tour-st">{s.title}</span>
                    </button>
                    {isCur && (
                      <div className="tour-body">
                        <span className="row wrap tour-who">
                          {s.who.map((w) => (
                            <span key={w.text} className={`tag ${w.cls}`}>
                              {w.text}
                            </span>
                          ))}
                        </span>
                        <p>{s.text}</p>
                        <button className="primary sm" onClick={() => showMe(s)}>
                          Show me <Icon name="right" size={13} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : (
        <button className={`tour-pill ${props.docked ? 'docked' : ''} ${nudge ? 'nudge' : ''}`} ref={rootRef as React.RefObject<HTMLButtonElement>} onClick={() => update({ open: true })} aria-label="Open the tour">
          <span className="tour-ring-mini" style={{ ['--p' as string]: `${(done.length / STEPS.length) * 100}%` }} aria-hidden>
            {all ? <Icon name="check" size={12} /> : done.length}
          </span>
          {all ? (
            'Tour done'
          ) : (
            <>
              Start here<span className="tour-pill-next">{next ? `${n} of ${STEPS.length}: ${next.title}` : ''}</span>
            </>
          )}
        </button>
      )}
    </>
  );
}

/** A ring around what to press, and one line saying why. Follows the element as the page moves. */
function Spotlight(props: { step: Spot; onClose: () => void }) {
  const { step, onClose } = props;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let raf = 0;
    let el: HTMLElement | null = null;
    let scrolled = false;
    const started = performance.now();
    const tick = () => {
      if (!el || !el.isConnected || !el.getClientRects().length) el = visible(step.target);
      // Wait out the page's own jump to the top after a hash change before scrolling to the target.
      if (el && performance.now() - started > 350) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: 'center', behavior: motionOk() ? 'smooth' : 'auto' });
        }
        const r = el.getBoundingClientRect();
        setRect((old) => (old && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height ? old : r));
      } else if (performance.now() - started > 8000) {
        // Pages load their data first; give up if the target never shows.
        return onClose();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // The ring goes once the visitor presses the thing, clicks elsewhere, or presses Escape.
    const onDown = () => window.setTimeout(onClose, 0);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const arm = window.setTimeout(() => window.addEventListener('pointerdown', onDown), 300);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(arm);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [step, onClose]);

  if (!rect) return null;
  const pad = 8;
  const gap = 10;
  const tipH = 44;
  // Prefer above the ring, centred on it and clear of the sticky top bar, so the tip covers
  // neither the rows under what to press nor the start of a heading; below when there is no
  // room above; otherwise just inside the ring's top edge. The tip is at most 260px wide.
  const above = rect.top - pad - gap - tipH > 72;
  const below = !above && rect.bottom + pad + gap + tipH < window.innerHeight;
  const half = Math.min(130, (window.innerWidth - 24) / 2);
  const mid = Math.max(12 + half, Math.min(rect.left + rect.width / 2, window.innerWidth - 12 - half));
  const tipStyle: React.CSSProperties = above
    ? { left: mid, top: rect.top - pad - gap, translate: '-50% -100%' }
    : below
      ? { left: mid, top: rect.bottom + pad + gap, translate: '-50% 0' }
      : { left: mid, top: Math.max(72, rect.top + 12), translate: '-50% 0' };
  // Portalled to the body: inside the sidebar the ring would sit under the page's own layers.
  return createPortal(
    <>
      <div className="tour-spot" aria-hidden style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-tip" role="status" style={tipStyle}>
        {step.tip}
      </div>
    </>,
    document.body,
  );
}
