/** Owner only: connect Manyfold agents and decide which one plays which role. */

import { useState } from 'react';
import { ROLES, ROLE_HELP, ROLE_LABEL, type EngineState, type Role } from '../../shared/engine';
import type { AppState } from '../../shared/types';
import { api, ApiError } from '../api';
import ConnectPanel from '../components/ConnectPanel';
import { Picker } from '../ui';

export default function Settings(props: { app: AppState; engine: EngineState; onChange: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const agents = props.app.agents;

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
            Connect your Manyfold agents, then give each role an agent. Scouts need live web search. Visitors never see this page or any
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
          <li>Each live run spends agent turns on your Manyfold account.</li>
        </ul>
      </section>
    </div>
  );
}
