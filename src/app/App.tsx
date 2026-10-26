/**
 * The shell: sidebar navigation routed by location.hash, a sticky top bar, and the pages.
 *
 *   #loop                  what the app does, as one loop (home)
 *   #check                 start a live check
 *   #run/<id>              one run, live
 *   #board                 AI answer share by vertical
 *   #report/<run>/<site>   the report a publisher would get
 *   #leads                 contacts and first-email drafts
 *   #leads/<site>          the same, opened at that site's email
 *   #how                   how the engine works
 *   #settings              owner only: connect Manyfold agents, assign roles
 */

import { useCallback, useEffect, useState } from 'react';
import type { EngineState } from '../shared/engine';
import type { AppState } from '../shared/types';
import { api, onUnauthorized } from './api';
import PasswordGate from './components/PasswordGate';
import Board from './pages/Board';
import Check from './pages/Check';
import How from './pages/How';
import Leads from './pages/Leads';
import Loop from './pages/Loop';
import Report from './pages/Report';
import RunView from './pages/RunView';
import Settings from './pages/Settings';
import Tour from './components/Tour';
import { Icon, PageSkeleton } from './ui';

type Page = 'loop' | 'check' | 'run' | 'board' | 'report' | 'leads' | 'how' | 'settings';
const NAV: Page[] = ['loop', 'check', 'board', 'leads', 'how', 'settings'];
const TITLES: Record<Page, string> = {
  loop: 'The loop',
  check: 'Check',
  run: 'Run',
  board: 'Leaderboard',
  report: 'Report',
  leads: 'Leads',
  how: 'How it works',
  settings: 'Settings',
};

interface Route {
  page: Page;
  runId: string | null;
  domain: string | null;
}

function parseHash(): Route {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [head, a, b] = raw.split('/');
  if (head === 'run' && a) return { page: 'run', runId: a, domain: null };
  if (head === 'report' && a && b) return { page: 'report', runId: a, domain: b };
  if (head === 'leads' && a) return { page: 'leads', runId: null, domain: a };
  const page = (['loop', 'check', 'board', 'leads', 'how', 'settings'] as Page[]).includes(head as Page) ? (head as Page) : 'loop';
  return { page, runId: null, domain: null };
}

const ICON: Record<Page, React.ReactNode> = {
  loop: <svg viewBox="0 0 16 16"><path d="M12.5 6A5 5 0 1 0 13 9.5M12.5 2.5V6H9" /></svg>,
  check: <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3.5 3.5" /></svg>,
  run: <svg viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" /></svg>,
  board: <svg viewBox="0 0 16 16"><path d="M2.5 13.5h11M4 11V7M8 11V3.5M12 11V5.5" /></svg>,
  report: <svg viewBox="0 0 16 16"><path d="M3 2.5h8l2 2v9H3z" /><path d="M5.5 7h5M5.5 10h5" /></svg>,
  leads: <svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5L8 9l5.5-4.5" /></svg>,
  how: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.3v.2" /></svg>,
  settings: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>,
};

const go = (hash: string) => {
  location.hash = `#${hash}`;
};

/** Wide enough that the sidebar is always on screen, so the tour can sit in it. */
function useWide() {
  const query = '(min-width: 861px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export default function App() {
  const [app, setApp] = useState<AppState | null>(null);
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [route, setRoute] = useState<Route>(parseHash);
  const [gateOpen, setGateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const docked = useWide();

  const refresh = useCallback(async () => {
    try {
      const [nextApp, nextEngine] = await Promise.all([api<AppState>('/api/state'), api<EngineState>('/api/engine/state')]);
      setApp(nextApp);
      setEngine(nextEngine);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    onUnauthorized(() => setGateOpen(true));
    const timer = setInterval(() => void refresh(), 20_000);
    return () => {
      window.removeEventListener('hashchange', onHash);
      onUnauthorized(null);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    document.body.classList.toggle('no-scroll', menuOpen);
  }, [menuOpen]);

  const admin = Boolean(app?.adminOk);
  const needsPassword = Boolean(app?.adminRequired && !app?.adminOk);
  const running = engine?.runs.filter((r) => r.status === 'running').length ?? 0;
  const page = route.page;

  // Settings asks for the password when the deployment has one.
  useEffect(() => {
    if (page === 'settings' && needsPassword) setGateOpen(true);
  }, [page, needsPassword]);

  let body: React.ReactNode;
  if (!app || !engine) {
    body = loadError ? <div className="notice error">{loadError}</div> : <PageSkeleton kind={page === 'board' ? 'board' : page === 'leads' ? 'leads' : page === 'run' ? 'run' : page === 'report' ? 'report' : 'page'} />;
  } else if (page === 'run' && route.runId) {
    body = <RunView runId={route.runId} admin={admin} onChange={refresh} />;
  } else if (page === 'report' && route.runId && route.domain) {
    body = <Report runId={route.runId} domain={route.domain} />;
  } else if (page === 'board') {
    body = <Board engine={engine} admin={admin} onStarted={refresh} needPassword={() => setGateOpen(true)} />;
  } else if (page === 'leads') {
    body = <Leads engine={engine} focus={route.domain} />;
  } else if (page === 'loop') {
    body = <Loop engine={engine} />;
  } else if (page === 'how') {
    body = <How />;
  } else if (page === 'settings') {
    body = admin ? <Settings app={app} engine={engine} onChange={refresh} /> : <p className="muted">Settings is for the owner.</p>;
  } else {
    body = <Check engine={engine} admin={admin} onStarted={refresh} />;
  }

  return (
    <div className="app">
      <div className={`scrim ${menuOpen ? 'on' : ''}`} aria-hidden onClick={() => setMenuOpen(false)} />
      <aside className={`side ${menuOpen ? 'open' : ''}`} id="side-nav">
        <div className="ws">
          <span className="logo-mark" aria-hidden>b</span>
          <span>
            Blankspace<small>AI Answer Share</small>
          </span>
          <button className="x side-x" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <nav className="nav" aria-label="Pages">
          {NAV.filter((p) => p !== 'settings' || !app?.adminRequired || admin).map((p) => (
            <a key={p} href={`#${p}`} aria-current={page === p || (p === 'check' && page === 'run') || (p === 'board' && page === 'report') ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
              {ICON[p]}
              {TITLES[p]}
              {p === 'check' && running > 0 && <span className="ct new">{running} live</span>}
            </a>
          ))}
        </nav>
        {docked && <Tour docked go={go} />}
        <div className="sidefoot">
          {engine && (
            <div className="small">
              {engine.engines.length
                ? `Engines connected: ${engine.engines.length}`
                : 'No engines connected yet. Saved results are shown.'}
            </div>
          )}
          {app?.adminRequired && !admin && (
            <button className="link small" onClick={() => setGateOpen(true)}>
              Owner sign in
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="burger" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="side-nav" onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 18 18" aria-hidden><path d="M3 5h12M3 9h12M3 13h12" /></svg>
          </button>
          <div className="crumb">
            <span className="crumb-root">
              Answer Share <span>/</span>
            </span>{' '}
            <b>{TITLES[page]}</b>
          </div>
          {page !== 'check' && (
            <a className="button primary sm top-cta" href="#check">
              Run a check
            </a>
          )}
        </div>
        <div className="page">
          {/* Keyed on the route so each page eases in when you move between them. */}
          <div key={`${page}/${route.runId ?? ''}/${route.domain ?? ''}`} className="page-in">
            {body}
          </div>
        </div>
      </main>

      {!docked && <Tour docked={false} go={go} />}

      {gateOpen && needsPassword && (
        <PasswordGate
          onSubmitted={async () => {
            await refresh();
          }}
          onCancel={() => {
            setGateOpen(false);
            if (page === 'settings') location.hash = '#check';
          }}
        />
      )}
    </div>
  );
}
