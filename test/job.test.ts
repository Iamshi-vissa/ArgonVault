import { describe, expect, it } from 'vitest';
import { jobReducer, type JobState } from '../src/tool/useCryptoJob';

type S = JobState<string>;
const idle: S = { status: 'idle', ticket: 0 };

describe('job state machine', () => {
  it('runs start → progress → finish', () => {
    let s = jobReducer(idle, { type: 'start', ticket: 1 });
    expect(s.status).toBe('working');
    s = jobReducer(s, { type: 'progress', ticket: 1, phase: 'crypt', fraction: 0.5 });
    expect(s).toMatchObject({ status: 'working', phase: 'crypt', fraction: 0.5 });
    s = jobReducer(s, { type: 'finish', ticket: 1, result: 'ok' });
    expect(s).toMatchObject({ status: 'done', result: 'ok' });
  });

  it('ignores progress and results from a job the user moved on from', () => {
    let s = jobReducer(idle, { type: 'start', ticket: 1 });
    s = jobReducer(s, { type: 'reset' }); // e.g. switched from Lock to Unlock
    expect(s).toEqual({ status: 'idle', ticket: 2 });
    expect(jobReducer(s, { type: 'progress', ticket: 1, phase: 'kdf', fraction: 1 })).toBe(s);
    expect(jobReducer(s, { type: 'finish', ticket: 1, result: 'stale' })).toBe(s);
    expect(jobReducer(s, { type: 'fail', ticket: 1, code: 'x', message: 'y' })).toBe(s);
  });

  it('refuses to start a second job while one is running, or with an old ticket', () => {
    const s = jobReducer(idle, { type: 'start', ticket: 1 });
    expect(jobReducer(s, { type: 'start', ticket: 2 })).toBe(s);
    const later: S = { status: 'idle', ticket: 5 };
    expect(jobReducer(later, { type: 'start', ticket: 3 })).toBe(later);
  });

  it('showing an earlier result retires the running job', () => {
    let s = jobReducer(idle, { type: 'start', ticket: 1 });
    s = jobReducer(s, { type: 'show', result: 'from list' });
    expect(s).toMatchObject({ status: 'done', result: 'from list', ticket: 2 });
    expect(jobReducer(s, { type: 'finish', ticket: 1, result: 'stale' })).toBe(s);
  });
});
