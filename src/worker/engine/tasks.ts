/**
 * Background A2A calls for the engine: submit with `message/send` (non-blocking), then
 * poll `tasks/get` until the task is terminal. The Workflow owns the waiting between
 * polls, so no request is ever held open for a long agent turn.
 *
 * Lessons carried over from the interview-prep app:
 *  - a task can report `completed` a moment before its artifact lands, so an empty
 *    completed task is polled again for a grace period instead of being accepted;
 *  - the messageId is derived from our own row id, so a retried submit is the same
 *    message to the agent and cannot bill a second turn.
 */

import { z } from 'zod';
import { A2AError, applyA2AResult, createAccumulator, fetchTimeout, safeErrorText, snapshotFrom, TERMINAL_STATES } from '../a2a';
import type { AgentCredential } from '../types';

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 20_000;

export interface TaskSnapshot {
  taskId: string | null;
  contextId: string | null;
  state: string;
  text: string;
  terminal: boolean;
}

function rpc(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params });
}

async function call(cred: AgentCredential, body: string, timeoutMs: number): Promise<TaskSnapshot> {
  const response = await fetchTimeout(
    cred.rpcUrl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${cred.token}`,
      },
      body,
      redirect: 'manual',
    },
    timeoutMs,
  );
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new A2AError(`${cred.label} returned HTTP ${response.status}.`, retryable, response.status === 401);
  }
  const envelope = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!envelope) throw new A2AError(`${cred.label} returned an empty response.`, true);
  if (envelope.error) {
    const error = envelope.error as Record<string, unknown>;
    throw new A2AError(`${cred.label} RPC error ${error.code ?? ''}: ${error.message ?? ''}`, false);
  }
  const accumulator = createAccumulator();
  applyA2AResult(accumulator, envelope.result);
  const snapshot = snapshotFrom(accumulator);
  return {
    taskId: snapshot.taskId,
    contextId: snapshot.contextId,
    state: snapshot.state,
    text: snapshot.text,
    terminal: TERMINAL_STATES.has(snapshot.state),
  };
}

export function submitTask(
  cred: AgentCredential,
  options: { messageId: string; text: string; contextId?: string | null },
): Promise<TaskSnapshot> {
  return call(
    cred,
    rpc('message/send', {
      message: {
        kind: 'message',
        role: 'user',
        messageId: options.messageId,
        ...(options.contextId ? { contextId: options.contextId } : {}),
        parts: [{ kind: 'text', text: options.text }],
      },
      configuration: { blocking: false, acceptedOutputModes: ['text/plain'] },
    }),
    SUBMIT_TIMEOUT_MS,
  );
}

export function getTask(cred: AgentCredential, taskId: string): Promise<TaskSnapshot> {
  return call(cred, rpc('tasks/get', { id: taskId }), POLL_TIMEOUT_MS);
}

/**
 * The skills end every reply with one ```json block, after any working notes. Take the
 * last fenced block; fall back to the last balanced top-level object in the text.
 */
export function extractJson(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(fences[i][1]);
    } catch {
      /* try an earlier block */
    }
  }
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let last: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) last = text.slice(start, i + 1);
    }
  }
  if (last) {
    try {
      return JSON.parse(last);
    } catch {
      /* fall through */
    }
  }
  throw new Error('The reply did not contain a parseable JSON object.');
}

/**
 * Why a reply was rejected, worded for the agent's repair turn and the event feed. zod's raw
 * issue list ("expected int, received number" inside a JSON dump) is what the founder could not
 * act on in round 5; the pretty form names each field: "→ at responses[0].interest".
 */
export function problemText(error: unknown): string {
  const text = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : error;
  return safeErrorText(text).slice(0, 500);
}
