// oxlint-disable-next-line import/default -- Vite turns this query import into a Worker constructor
import CryptoWorker from './worker?worker&inline';
import type { Reply, Request } from './worker';

type Done = Exclude<Reply, { kind: 'progress' }>;
type ProgressFn = (phase: 'kdf' | 'crypt', fraction: number) => void;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: Done) => void; progress?: ProgressFn }>();

function getWorker() {
  if (worker) return worker;
  worker = new CryptoWorker();
  worker.onmessage = (ev: MessageEvent<Reply>) => {
    const r = ev.data;
    const job = pending.get(r.id);
    if (!job) return;
    if (r.kind === 'progress') return job.progress?.(r.phase, r.fraction);
    pending.delete(r.id);
    job.resolve(r);
  };
  // If the worker itself fails (it shouldn't), fail every open job instead of hanging.
  worker.onerror = ev => {
    console.error('ArgonVault worker error:', ev.message);
    for (const [id, job] of pending)
      job.resolve({
        id,
        kind: 'error',
        code: 'internal',
        message: 'The encryption engine stopped unexpectedly. Reload the page and try again.'
      });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export function run(req: WithoutId<Request>, progress?: ProgressFn): Promise<Done> {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, { resolve, progress });
    getWorker().postMessage({ ...req, id });
  });
}
