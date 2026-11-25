import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionEntry } from './Session';

export interface SessionStore<R> {
  entries: SessionEntry[];
  now: number;
  add: (e: Omit<SessionEntry, 'id' | 'at'>, keep?: R) => void;
  get: (id: number) => R | undefined;
  clear: () => void;
}

/** What was locked or opened in this tab. Lives above the pages, so it survives moving between them. */
export function useSession<R>(): SessionStore<R> {
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const kept = useRef(new Map<number, R>());
  const next = useRef(1);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const add = useCallback((e: Omit<SessionEntry, 'id' | 'at'>, keep?: R) => {
    const id = next.current++;
    if (keep !== undefined) kept.current.set(id, keep);
    const at = Date.now();
    setNow(at);
    setEntries(list => [{ ...e, id, at }, ...list]);
  }, []);

  const get = useCallback((id: number) => kept.current.get(id), []);
  const clear = useCallback(() => {
    kept.current.clear();
    setEntries([]);
  }, []);

  return { entries, now, add, get, clear };
}
