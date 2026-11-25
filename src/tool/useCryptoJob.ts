import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';

/**
 * One lock or unlock job as a small state machine:
 *
 *   idle ──start──▶ working ──finish──▶ done
 *     ▲               │  ▲                │
 *     │               │  └──progress──┘   │
 *     │               └──────fail───────▶ failed
 *     └──────────────reset───────────────┘
 *
 * Every start and reset issues a new ticket. Progress, finish and fail carry
 * the ticket of the job they belong to, and the reducer ignores any that don't
 * match: a result from a job the user has moved on from can't reach the screen.
 */

type Phase = 'kdf' | 'crypt';

export type JobState<R> =
  | { status: 'idle'; ticket: number }
  | { status: 'working'; ticket: number; phase: Phase; fraction: number }
  | { status: 'failed'; ticket: number; code: string; message: string }
  | { status: 'done'; ticket: number; result: R };

type JobAction<R> =
  | { type: 'start'; ticket: number }
  | { type: 'progress'; ticket: number; phase: Phase; fraction: number }
  | { type: 'finish'; ticket: number; result: R }
  | { type: 'fail'; ticket: number; code: string; message: string }
  | { type: 'show'; result: R }
  | { type: 'reset' };

export function jobReducer<R>(state: JobState<R>, action: JobAction<R>): JobState<R> {
  switch (action.type) {
    case 'reset':
      return { status: 'idle', ticket: state.ticket + 1 };
    case 'show':
      // Shows an earlier result (from the session list) and retires any running job.
      return { status: 'done', ticket: state.ticket + 1, result: action.result };
    case 'start':
      if (state.status === 'working' || action.ticket <= state.ticket) return state;
      return { status: 'working', ticket: action.ticket, phase: 'kdf', fraction: 0 };
    case 'progress':
      if (state.status !== 'working' || action.ticket !== state.ticket) return state;
      return { ...state, phase: action.phase, fraction: action.fraction };
    case 'finish':
      if (state.status !== 'working' || action.ticket !== state.ticket) return state;
      return { status: 'done', ticket: state.ticket, result: action.result };
    case 'fail':
      if (state.status !== 'working' || action.ticket !== state.ticket) return state;
      return { status: 'failed', ticket: state.ticket, code: action.code, message: action.message };
  }
}

export type Outcome<R> = { ok: true; result: R } | { ok: false; code: string; message: string } | { ok: 'cancelled' };

export interface JobControls {
  ticket: number;
  progress: (phase: Phase, fraction: number) => void;
  /** False once the user has moved on (reset, another job, or the page closed). */
  current: () => boolean;
}

export function useCryptoJob<R>() {
  const [state, dispatch] = useReducer(jobReducer<R>, { status: 'idle', ticket: 0 } as JobState<R>);
  // Mirrors of the state for async callbacks, synced after each render.
  const latest = useRef(0);
  const status = useRef(state.status);
  useLayoutEffect(() => {
    latest.current = state.ticket;
    status.current = state.status;
  }, [state]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(async (work: (job: JobControls) => Promise<Outcome<R>>): Promise<Outcome<R>> => {
    if (status.current === 'working') return { ok: 'cancelled' }; // one job at a time
    status.current = 'working';
    const ticket = latest.current + 1;
    latest.current = ticket;
    dispatch({ type: 'start', ticket });
    const controls: JobControls = {
      ticket,
      progress: (phase, fraction) => dispatch({ type: 'progress', ticket, phase, fraction }),
      current: () => mounted.current && latest.current === ticket
    };
    const outcome = await work(controls);
    if (outcome.ok === true) dispatch({ type: 'finish', ticket, result: outcome.result });
    else if (outcome.ok === false) dispatch({ type: 'fail', ticket, code: outcome.code, message: outcome.message });
    else dispatch({ type: 'reset' });
    return outcome;
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const show = useCallback((result: R) => dispatch({ type: 'show', result }), []);

  return { state, start, reset, show };
}
