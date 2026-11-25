/// <reference lib="webworker" />
// All key derivation and encryption runs here, off the page's main thread.
import {
  armor, blobSource, bytesSource, concat, dearmor, lock, LockerError, MAGIC, NOTE_TYPE, unlock, type KdfParams
} from './format';
import { currentEngine, deriveArgon2id } from './kdf';

export type Request =
  | { id: number; op: 'lock'; data: Blob; name: string; type: string; password: string; params: KdfParams; armored: boolean }
  | { id: number; op: 'lockNote'; text: string; password: string; params: KdfParams }
  | { id: number; op: 'unlock'; data: Blob; password: string };

export type Reply =
  | { id: number; kind: 'progress'; phase: 'kdf' | 'crypt'; fraction: number }
  | { id: number; kind: 'locked'; blob?: Blob; text?: string; seal: Uint8Array; engine: string | null }
  | {
      id: number;
      kind: 'unlocked';
      blob?: Blob;
      note?: string;
      name: string;
      type: string;
      seal: Uint8Array;
      params: KdfParams;
      engine: string | null;
    }
  | { id: number; kind: 'error'; code: string; message: string };

const post = (r: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  const progress = (phase: 'kdf' | 'crypt', fraction: number) => post({ id: req.id, kind: 'progress', phase, fraction });
  try {
    if (req.op === 'lock' || req.op === 'lockNote') {
      const isNote = req.op === 'lockNote';
      const src = isNote ? bytesSource(new TextEncoder().encode(req.text)) : blobSource(req.data);
      const r = await lock(src, isNote ? '' : req.name, isNote ? NOTE_TYPE : req.type, req.password, deriveArgon2id, {
        params: req.params,
        onProgress: progress
      });
      const armored = isNote || (req.op === 'lock' && req.armored);
      post({
        id: req.id,
        kind: 'locked',
        seal: r.seal,
        engine: currentEngine(),
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
    const out = await unlock(src, req.password, deriveArgon2id, progress);
    const isNote = out.type === NOTE_TYPE;
    post({
      id: req.id,
      kind: 'unlocked',
      name: out.name,
      type: out.type,
      seal: out.seal,
      params: out.params,
      engine: currentEngine(),
      ...(isNote
        ? { note: new TextDecoder().decode(concat(out.parts)) }
        : { blob: new Blob(out.parts as BlobPart[], { type: out.type || 'application/octet-stream' }) })
    });
  } catch (e) {
    if (e instanceof LockerError) {
      post({ id: req.id, kind: 'error', code: e.code, message: e.message });
      return;
    }
    const text = String((e as Error)?.message ?? e);
    const memory = e instanceof RangeError || /memory|allocation|out of bounds/i.test(text);
    post({
      id: req.id,
      kind: 'error',
      code: memory ? 'memory' : 'internal',
      message: memory
        ? 'This device ran out of memory. Try Standard key strength, or a smaller file.'
        : 'Something went wrong inside the encryption engine. Reload the page and try again.'
    });
  }
};
