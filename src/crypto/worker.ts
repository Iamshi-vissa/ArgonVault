/// <reference lib="webworker" />
// All key derivation and encryption runs here, off the page's main thread.
import {
  armor,
  blobSource,
  bytesSource,
  concat,
  dearmor,
  lock,
  LockerError,
  MAGIC,
  NOTE_TYPE,
  unlock,
  type KdfParams,
  type Sink
} from './format';
import { currentEngine, deriveArgon2id } from './kdf';
import { runBenchmark, type BenchResult } from './bench';

/**
 * `target` is a file the user chose with the File System Access API. When it is
 * given, output is streamed straight to disk and never held in memory. Writes
 * go to a temporary file that only replaces the target on close(), so a failed
 * or tampered unlock leaves nothing behind.
 */
export type Request =
  | {
      id: number;
      op: 'lock';
      data: Blob;
      name: string;
      type: string;
      password: string;
      params: KdfParams;
      armored: boolean;
      target?: FileSystemFileHandle;
    }
  | { id: number; op: 'lockNote'; text: string; password: string; params: KdfParams }
  | { id: number; op: 'unlock'; data: Blob; password: string; target?: FileSystemFileHandle }
  | { id: number; op: 'bench' };

export type Reply =
  | { id: number; kind: 'progress'; phase: 'kdf' | 'crypt'; fraction: number }
  | {
      id: number;
      kind: 'locked';
      blob?: Blob;
      text?: string;
      streamed: boolean;
      size: number;
      seal: Uint8Array;
      fileHash: Uint8Array;
      engine: string | null;
    }
  | {
      id: number;
      kind: 'unlocked';
      blob?: Blob;
      note?: string;
      streamed: boolean;
      size: number;
      name: string;
      type: string;
      seal: Uint8Array;
      fileHash: Uint8Array;
      params: KdfParams;
      engine: string | null;
    }
  | { id: number; kind: 'bench'; result: BenchResult }
  | { id: number; kind: 'error'; code: string; message: string };

const post = (r: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);

/** A sink that writes to a user-chosen file, counting bytes; `abort` discards everything written. */
async function diskSink(target: FileSystemFileHandle) {
  const writable = await target.createWritable();
  let size = 0;
  const sink: Sink = async part => {
    size += part.length;
    await writable.write(part as BufferSource);
  };
  return { sink, size: () => size, close: () => writable.close(), abort: () => writable.abort().catch(() => {}) };
}

function fail(id: number, e: unknown) {
  if (e instanceof LockerError) return post({ id, kind: 'error', code: e.code, message: e.message });
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'NoModificationAllowedError')
    return post({
      id,
      kind: 'error',
      code: 'disk',
      message: 'The browser wouldn’t let ArgonVault write to that file. Choose another place to save.'
    });
  if (name === 'QuotaExceededError')
    return post({
      id,
      kind: 'error',
      code: 'disk',
      message: 'There isn’t enough free space on the disk. Nothing was saved.'
    });
  const text = String((e as Error)?.message ?? e);
  const memory = e instanceof RangeError || /memory|allocation|out of bounds/i.test(text);
  post({
    id,
    kind: 'error',
    code: memory ? 'memory' : 'internal',
    message: memory
      ? 'This device ran out of memory. Try Standard key strength, or a smaller file.'
      : 'Something went wrong inside the encryption engine. Reload the page and try again.'
  });
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  const progress = (phase: 'kdf' | 'crypt', fraction: number) =>
    post({ id: req.id, kind: 'progress', phase, fraction });
  let disk: Awaited<ReturnType<typeof diskSink>> | null = null;
  try {
    if (req.op === 'bench') {
      post({ id: req.id, kind: 'bench', result: await runBenchmark() });
      return;
    }

    if (req.op === 'lock' || req.op === 'lockNote') {
      const isNote = req.op === 'lockNote';
      const src = isNote ? bytesSource(new TextEncoder().encode(req.text)) : blobSource(req.data);
      if (!isNote && req.target) disk = await diskSink(req.target);
      const r = await lock(src, isNote ? '' : req.name, isNote ? NOTE_TYPE : req.type, req.password, deriveArgon2id, {
        params: req.params,
        onProgress: progress,
        sink: disk?.sink
      });
      const base = { id: req.id, kind: 'locked' as const, seal: r.seal, fileHash: r.fileHash, engine: currentEngine() };
      if (disk) {
        await disk.close();
        post({ ...base, streamed: true, size: disk.size() });
        return;
      }
      const armored = isNote || (req.op === 'lock' && req.armored);
      const size = r.parts.reduce((n, p) => n + p.length, 0);
      post({
        ...base,
        streamed: false,
        size,
        ...(armored
          ? { text: armor(concat(r.parts), isNote ? 'note' : 'file') }
          : { blob: new Blob(r.parts as BlobPart[], { type: 'application/octet-stream' }) })
      });
      return;
    }

    // Unlock: accept binary files and ASCII-armoured text.
    let src = blobSource(req.data);
    const head = await src.read(0, 3);
    const binary = head.length === 3 && head[0] === MAGIC[0] && head[1] === MAGIC[1] && head[2] === MAGIC[2];
    if (!binary) {
      if (req.data.size > 512 * 1024 * 1024) throw new LockerError('not-locker', 'This isn’t an ArgonVault file.');
      const bytes = dearmor(await req.data.text());
      if (!bytes) throw new LockerError('not-locker', 'This isn’t an ArgonVault file or locked text.');
      src = bytesSource(bytes);
    }
    if (req.target) disk = await diskSink(req.target);
    const out = await unlock(src, req.password, deriveArgon2id, { onProgress: progress, sink: disk?.sink });
    const isNote = out.type === NOTE_TYPE;
    const base = {
      id: req.id,
      kind: 'unlocked' as const,
      name: out.name,
      type: out.type,
      seal: out.seal,
      fileHash: out.fileHash,
      params: out.params,
      engine: currentEngine()
    };
    if (disk) {
      await disk.close();
      post({ ...base, streamed: true, size: disk.size() });
      return;
    }
    const size = out.parts.reduce((n, p) => n + p.length, 0);
    post({
      ...base,
      streamed: false,
      size,
      ...(isNote
        ? { note: new TextDecoder().decode(concat(out.parts)) }
        : { blob: new Blob(out.parts as BlobPart[], { type: out.type || 'application/octet-stream' }) })
    });
  } catch (e) {
    await disk?.abort();
    fail(req.id, e);
  }
};
