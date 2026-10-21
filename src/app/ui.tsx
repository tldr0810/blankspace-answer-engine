/** Small shared pieces: icons, engine colours, verdict tags, relative times. */

import { ENGINE_LABEL, type Engine, type Lead } from '../shared/engine';

const ICON_PATHS = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  right: <path d="M3 8h10M9 4l4 4-4 4" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  out: <path d="M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5L7.5 8.5" />,
  play: <path d="M5 3.5v9l7-4.5z" />,
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
