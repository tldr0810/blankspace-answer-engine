/** Owner only: connect Manyfold agents and decide which one plays which role. */

import { useState } from 'react';
import { AUTOPILOT_MIN_GAP_HOURS, AUTOPILOT_STALE_HOURS, ROLES, ROLE_HELP, ROLE_LABEL, VERTICAL_LABEL, type EngineState, type Role } from '../../shared/engine';
import type { AppState } from '../../shared/types';
import { api, ApiError } from '../api';
import ConnectPanel from '../components/ConnectPanel';
import { ago, Picker } from '../ui';

const PING_RESULT = {
  started: 'started a refresh',
  paused: 'skipped because autopilot is paused',
  no_engines: 'skipped because no scout agents are assigned',
  running: 'skipped because a refresh was still going',
  too_soon: `skipped because the last refresh started under ${AUTOPILOT_MIN_GAP_HOURS} hours earlier`,
} as const;

export default function Settings(props: { app: AppState; engine: EngineState; onChange: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const agents = props.app.agents;
  const autopilot = props.engine.autopilot;
  const lastCall = autopilot.lastPingAt ?? autopilot.lastAt;
  const stale = autopilot.enabled && (!lastCall || Date.now() - Date.parse(lastCall) > AUTOPILOT_STALE_HOURS * 3_600_000);
  const automationPrompt = `Run this command once and reply with its output, nothing else:\ncurl -sS -X POST ${location.origin}/api/engine/autopilot`;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await props.onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const assign = (role: Role, agentId: string) =>
    act(`role-${role}`, () => api('/api/engine/roles', { method: 'PUT', body: JSON.stringify({ role, agentId: agentId || null }) }));

  return (
    <div className="stack">
      <div className="ph">
        <div>
          <span className="eyebrow">Settings</span>
          <h1>Agents</h1>
          <p>
            Connect your cloud agents, then give each role an agent. Scouts need live web search. Visitors never see this page or any
            token.
          </p>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}

      <section className="card lift">
        <div className="lh">
          <div>
            <h2>Roles</h2>
            <p>At least one scout makes live runs possible. The profiler is optional; without it drafts go to a role.</p>
          </div>
        </div>
        <div className="roles">
          {ROLES.map((role) => (
            <div key={role} className="role">
              <span className={`tag ${props.engine.roles[role] ? 't-eng' : 't-mute'}`}>{props.engine.roles[role] ? 'Set' : 'Empty'}</span>
              <div>
                <div className="rn">{ROLE_LABEL[role]}</div>
                <div className="rd">{ROLE_HELP[role]}</div>
              </div>
              <Picker
                value={props.engine.roles[role] ?? ''}
                disabled={busy === `role-${role}`}
                onChange={(value) => void assign(role, value)}
                label={`Agent for ${ROLE_LABEL[role]}`}
                options={[{ value: '', label: 'Not assigned' }, ...agents.map((a) => ({ value: a.agentId, label: a.name }))]}
                dot
              />
              <span className="last" />
            </div>
          ))}
        </div>
      </section>

      <section className="panel autopilot">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Autopilot</h2>
            <p className="muted">
              A scheduled agent in the cloud calls this app on its schedule. Each call refreshes the next vertical in rotation, at most once every{' '}
              {AUTOPILOT_MIN_GAP_HOURS} hours and never while one is still running, so extra calls cost nothing.
            </p>
          </div>
          <button
            type="button"
            className="switch"
            aria-pressed={autopilot.enabled}
            disabled={busy === 'autopilot'}
            onClick={() => void act('autopilot', () => api('/api/engine/autopilot', { method: 'PUT', body: JSON.stringify({ enabled: !autopilot.enabled }) }))}
          >
            <span className="knob">
              <i />
            </span>
            {autopilot.enabled ? 'On' : 'Paused'}
          </button>
        </div>
        {stale && (
          <p className="notice warn">
            {lastCall ? `No call from the scheduled agent since ${ago(lastCall)}` : 'The scheduled agent has not called yet'}, but it
            should call every 6 hours. Check that the schedule below is still active.
          </p>
        )}
        <ul className="facts">
          <li>
            Next to refresh: the <b>{VERTICAL_LABEL[autopilot.nextVertical]}</b> category
          </li>
          <li>
            Last refresh it started:{' '}
            {autopilot.lastRunId ? (
              <a href={`#run/${autopilot.lastRunId}`}>{ago(autopilot.lastAt)}</a>
            ) : (
              'none yet'
            )}
          </li>
          <li>
            Last call from the schedule:{' '}
            {autopilot.lastPingAt ? `${ago(autopilot.lastPingAt)}, ${PING_RESULT[autopilot.lastPingResult ?? 'started']}` : 'not recorded yet'}
          </li>
          <li>
            Sources checked by code: {props.engine.sources.ok} live and on topic, {props.engine.sources.dropped} dropped (gone or off topic),{' '}
            {props.engine.sources.blocked} on sites that block checks. Every cited page is checked again after 7 days.
          </li>
        </ul>
        <div className="automation">
          <span className="eyebrow">The schedule</span>
          <p className="small muted">
            Agent <b>blankspace-gtm</b>, schedule every 6 hours (<code>FREQ=HOURLY;INTERVAL=6</code>), prompt:
          </p>
          <pre className="prompt">{automationPrompt}</pre>
        </div>
      </section>

      <section className="panel">
        <h2>Connected agents</h2>
        {agents.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="agent-list">
            {agents.map((a) => (
              <div key={a.agentId} className="agent-card">
                <div className="agent-card-main">
                  <div className="agent-card-title">
                    {a.name}
                    <span className={`badge ${a.verified ? 'ok' : 'warn'}`}>{a.verified ? 'reachable' : 'not verified'}</span>
                  </div>
                  <p className="muted small">{a.description || a.rpcUrl}</p>
                  {a.warning && <p className="warn small">{a.warning}</p>}
                </div>
                <div className="agent-card-actions">
                  <button className="sm" disabled={busy === a.agentId} onClick={() => void act(a.agentId, () => api(`/api/agents/${a.agentId}/verify`, { method: 'POST' }))}>
                    Check
                  </button>
                  <button
                    className="sm danger-outline button"
                    disabled={busy === a.agentId}
                    onClick={() => void act(a.agentId, () => api(`/api/agents/${a.agentId}`, { method: 'DELETE' }))}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="connect-panel">
          <ConnectPanel initialSession={props.app.connect.session} onConnected={props.onChange} />
        </div>
      </section>

      <section className="panel">
        <h2>Before sharing the link</h2>
        <ul className="facts">
          <li>
            Set an admin password with <code>npx wrangler secret put ADMIN_PASSWORD</code>. Without one, anyone can open this page.
          </li>
          <li>Visitors can start site checks and questions up to the daily limit ({props.engine.limits.dailyLimit} a day). Change DAILY_RUN_LIMIT in wrangler.jsonc.</li>
          <li>Each live run spends agent turns on your cloud agent account.</li>
        </ul>
      </section>
    </div>
  );
}
