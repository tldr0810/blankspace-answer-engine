import { describe, expect, it } from 'vitest';
import { newRun, scoutBatches } from '../src/worker/engine/runner';

describe('scoutBatches', () => {
  const run = newRun('vertical', { vertical: 'running', engines: ['claude'], origin: 'schedule' });

  it('splits a vertical into turns of 5 questions', () => {
    const batches = scoutBatches(run, { calls: {}, candidates: [], enriched: 0, verified: 0 }, 'scout_claude');
    expect(batches.map((b) => b.key)).toEqual(['scout_claude.b0', 'scout_claude.b1', 'scout_claude.b2']);
    expect(batches.flatMap((b) => b.questions)).toEqual(run.questions);
    expect(batches.every((b) => b.questions.length <= 5)).toBe(true);
  });

  it('keeps one turn for a run that started before batching', () => {
    const legacy = { role: 'scout_claude' as const, agentId: 'a', callId: 'c', taskId: 't', polls: 0, emptyPolls: 0, resubmits: 0, status: 'pending' as const };
    const batches = scoutBatches(run, { calls: { scout_claude: legacy }, candidates: [], enriched: 0, verified: 0 }, 'scout_claude');
    expect(batches).toEqual([{ key: 'scout_claude', questions: run.questions }]);
  });
});
