/**
 * ArgonVault container format, version 1.
 *
 *   password ──Argon2id(salt, m, t, p)──▶ master key (32 bytes)
 *   master ──HKDF-SHA256 "argonvault/v1/enc"──▶ AES-256-GCM key
 *   master ──HKDF-SHA256 "argonvault/v1/commit"──▶ HMAC-SHA256 key
 *
 * File layout (all integers big-endian):
 *
 *   offset size  field
 *   0      3     magic "AGV"
 *   3      1     version (1)
 *   4      1     kdf id (1 = Argon2id)
 *   5      4     Argon2 memory in KiB
 *   9      1     Argon2 iterations (t)
 *   10     1     Argon2 parallelism (p)
 *   11     16    random salt
 *   27     1     log2(chunk size)
 *   28     7     random nonce prefix
 *   35     32    key commitment = HMAC(commit key, bytes 0..34)
 *   67     ...   chunks: AES-256-GCM(ciphertext ‖ 16-byte tag)
 *
 * Chunk i is encrypted with nonce = prefix(7) ‖ i (u32) ‖ lastFlag (1) and
 * the full 67-byte header as associated data. So chunks cannot be reordered,
 * dropped, truncated, appended to, or moved between files, and no header
 * field (including the Argon2 cost) can be changed without detection.
 *
 * The encrypted plaintext begins with metadata, so the original file name
 * and type are hidden too: nameLen (u16) ‖ name ‖ typeLen (u8) ‖ type ‖ data.
 */

import { createSha256 } from './hash';

export const MAGIC = [0x41, 0x47, 0x56] as const; // "AGV"
const VERSION = 1;
const KDF_ARGON2ID = 1;
export const HEADER_LEN = 67;
const COMMIT_OFFSET = 35;
const TAG_LEN = 16;
export const NOTE_TYPE = 'application/x-argonvault-note';

export interface KdfParams {
  /** memory in KiB */
  m: number;
  t: number;
  p: number;
}

/** RFC 9106 §4, second recommended option: 64 MiB, 3 passes, 4 lanes. */
export const STANDARD: KdfParams = { m: 64 * 1024, t: 3, p: 4 };
/** Four times the memory and one more pass, for files that matter most. */
export const HARDENED: KdfParams = { m: 256 * 1024, t: 4, p: 4 };

/** Limits accepted when opening a file, so a hostile header can't exhaust memory. */
const LIMITS = { mMin: 8 * 1024, mMax: 1024 * 1024, tMax: 16, pMax: 16, chunkMin: 12, chunkMax: 24 };

export type DeriveFn = (
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
  onProgress?: (p: number) => void
) => Promise<Uint8Array>;

interface Source {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

type Progress = (phase: 'kdf' | 'crypt', fraction: number) => void;

export class LockerError extends Error {
  constructor(
    public code: 'not-locker' | 'unsupported' | 'wrong-password' | 'tampered' | 'bad-input',
    message: string
  ) {
    super(message);
  }
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** NFC so the same password typed on different keyboards gives the same key. */
function passwordBytes(password: string): Uint8Array {
  if (!password) throw new LockerError('bad-input', 'Enter a password.');
  return enc.encode(password.normalize('NFC'));
}

interface Keys {
  aes: CryptoKey;
  commit: CryptoKey;
}

async function deriveKeys(master: Uint8Array): Promise<Keys> {
  const base = await subtle.importKey('raw', master as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = async (label: string) =>
    new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(label) },
        base,
        256
      )
    );
  const aesRaw = await bits('argonvault/v1/enc');
  const commitRaw = await bits('argonvault/v1/commit');
  const aes = await subtle.importKey('raw', aesRaw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const commit = await subtle.importKey('raw', commitRaw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ]);
  // Best effort: the raw bytes are no longer needed once the keys are non-extractable.
  master.fill(0);
  aesRaw.fill(0);
  commitRaw.fill(0);
  return { aes, commit };
}

function nonce(prefix: Uint8Array, index: number, last: boolean): Uint8Array {
  const n = new Uint8Array(12);
  n.set(prefix, 0);
  new DataView(n.buffer).setUint32(7, index, false);
  n[11] = last ? 1 : 0;
  return n;
}

/** Longest prefix of `text` whose UTF-8 encoding fits in `max` bytes, never splitting a character. */
function fitUtf8(text: string, max: number): string {
  if (enc.encode(text).length <= max) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const n = enc.encode(ch).length;
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

function encodeMeta(name: string, type: string): Uint8Array {
  const nameB = enc.encode(truncateName(name.normalize('NFC')));
  const typeB = enc.encode(fitUtf8(type, 255));
  const meta = new Uint8Array(2 + nameB.length + 1 + typeB.length);
  new DataView(meta.buffer).setUint16(0, nameB.length, false);
  meta.set(nameB, 2);
  meta[2 + nameB.length] = typeB.length;
  meta.set(typeB, 3 + nameB.length);
  return meta;
}

/** Keeps a name within 255 bytes, preserving a short extension. */
export function truncateName(name: string): string {
  if (enc.encode(name).length <= 255) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  return fitUtf8(name.slice(0, name.length - ext.length), 255 - enc.encode(ext).length) + ext;
}

/** Receives output in order. When given, nothing is kept in memory. */
export type Sink = (part: Uint8Array) => Promise<void> | void;

interface LockOptions {
  params?: KdfParams;
  chunkLog2?: number;
  onProgress?: Progress;
  sink?: Sink;
}

interface Locked {
  /** The locked file, in pieces. Empty when a sink was given. */
  parts: Uint8Array[];
  /** First 8 bytes of the key commitment: same file + same password = same seal. */
  seal: Uint8Array;
  /** SHA-256 of the whole locked file: what gets timestamped on the blockchain. */
  fileHash: Uint8Array;
}

export async function lock(
  data: Source,
  name: string,
  type: string,
  password: string,
  derive: DeriveFn,
  opts: LockOptions = {}
): Promise<Locked> {
  const params = opts.params ?? STANDARD;
  const chunkLog2 = opts.chunkLog2 ?? 20;
  const pw = passwordBytes(password);
  const salt = randomBytes(16);
  const prefix = randomBytes(7);

  const header = new Uint8Array(HEADER_LEN);
  const hv = new DataView(header.buffer);
  header.set(MAGIC, 0);
  header[3] = VERSION;
  header[4] = KDF_ARGON2ID;
  hv.setUint32(5, params.m, false);
  header[9] = params.t;
  header[10] = params.p;
  header.set(salt, 11);
  header[27] = chunkLog2;
  header.set(prefix, 28);

  const master = await derive(pw, salt, params, f => opts.onProgress?.('kdf', f));
  pw.fill(0);
  const keys = await deriveKeys(master);
  const commitment = new Uint8Array(
    await subtle.sign('HMAC', keys.commit, header.subarray(0, COMMIT_OFFSET) as BufferSource)
  );
  header.set(commitment, COMMIT_OFFSET);

  const meta = encodeMeta(name, type);
  const total = meta.length + data.size;
  const CS = 2 ** chunkLog2;
  const count = Math.max(1, Math.ceil(total / CS));
  if (count > 0xffffffff) throw new LockerError('bad-input', 'This file is too large.');

  const parts: Uint8Array[] = [];
  const hash = await createSha256();
  const emit = async (part: Uint8Array) => {
    hash.update(part);
    if (opts.sink) await opts.sink(part);
    else parts.push(part);
  };
  await emit(header);
  for (let i = 0; i < count; i++) {
    const off = i * CS;
    const len = Math.min(CS, total - off);
    const plain = new Uint8Array(len);
    let filled = 0;
    if (off < meta.length) {
      const m = meta.subarray(off, Math.min(meta.length, off + len));
      plain.set(m, 0);
      filled = m.length;
    }
    if (filled < len) {
      const fileOff = off + filled - meta.length;
      plain.set(await data.read(fileOff, len - filled), filled);
    }
    const ct = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce(prefix, i, i === count - 1) as BufferSource,
        additionalData: header as BufferSource
      },
      keys.aes,
      plain as BufferSource
    );
    plain.fill(0);
    await emit(new Uint8Array(ct));
    opts.onProgress?.('crypt', (i + 1) / count);
  }
  return { parts, seal: commitment.slice(0, 8), fileHash: hash.digest() };
}

interface HeaderInfo {
  params: KdfParams;
  chunkLog2: number;
}

function readHeader(header: Uint8Array): HeaderInfo {
  if (header.length < HEADER_LEN || header[0] !== MAGIC[0] || header[1] !== MAGIC[1] || header[2] !== MAGIC[2])
    throw new LockerError('not-locker', 'This isn’t an ArgonVault file.');
  if (header[3] !== VERSION || header[4] !== KDF_ARGON2ID)
    throw new LockerError('unsupported', 'This file was made by a newer version of ArgonVault.');
  const m = new DataView(header.buffer, header.byteOffset).getUint32(5, false);
  const t = header[9];
  const p = header[10];
  const chunkLog2 = header[27];
  if (m < LIMITS.mMin || m > LIMITS.mMax || t < 1 || t > LIMITS.tMax || p < 1 || p > LIMITS.pMax)
    throw new LockerError('unsupported', 'This file asks for key settings outside the safe range.');
  if (chunkLog2 < LIMITS.chunkMin || chunkLog2 > LIMITS.chunkMax)
    throw new LockerError('unsupported', 'This file uses an unsupported chunk size.');
  return { params: { m, t, p }, chunkLog2 };
}

interface Unlocked {
  name: string;
  type: string;
  /** The original contents, in pieces. Empty when a sink was given. */
  parts: Uint8Array[];
  seal: Uint8Array;
  params: KdfParams;
  /** SHA-256 of the locked file, to look up its blockchain timestamp. */
  fileHash: Uint8Array;
}

interface UnlockOptions {
  onProgress?: Progress;
  /**
   * Receives the original contents chunk by chunk, each only after it has been
   * authenticated. A later chunk can still fail, so a sink must be able to
   * discard what it wrote (File System Access writes commit only on close).
   */
  sink?: Sink;
  /** Called with the original name and type as soon as the first chunk is verified. */
  onMeta?: (name: string, type: string) => void;
}

export async function unlock(
  src: Source,
  password: string,
  derive: DeriveFn,
  opts: UnlockOptions | Progress = {}
): Promise<Unlocked> {
  const { onProgress, sink, onMeta }: UnlockOptions = typeof opts === 'function' ? { onProgress: opts } : opts;
  if (src.size < HEADER_LEN + TAG_LEN) throw new LockerError('not-locker', 'This isn’t an ArgonVault file.');
  const header = (await src.read(0, HEADER_LEN)).slice();
  const info = readHeader(header);
  const pw = passwordBytes(password);
  const master = await derive(pw, header.slice(11, 27), info.params, f => onProgress?.('kdf', f));
  pw.fill(0);
  const keys = await deriveKeys(master);

  const ok = await subtle.verify(
    'HMAC',
    keys.commit,
    header.subarray(COMMIT_OFFSET) as BufferSource,
    header.subarray(0, COMMIT_OFFSET) as BufferSource
  );
  if (!ok) throw new LockerError('wrong-password', 'That password doesn’t open this file.');

  const prefix = header.slice(28, 35);
  const CS = 2 ** info.chunkLog2;
  const body = src.size - HEADER_LEN;
  const step = CS + TAG_LEN;
  const count = Math.ceil(body / step);
  const lastLen = body - (count - 1) * step;
  if (lastLen < TAG_LEN) throw new LockerError('tampered', 'This file is damaged or was changed after locking.');

  const hash = await createSha256();
  hash.update(header);
  const plain: Uint8Array[] = [];
  let name = '';
  let type = '';
  for (let i = 0; i < count; i++) {
    const len = i === count - 1 ? lastLen : step;
    const ct = await src.read(HEADER_LEN + i * step, len);
    hash.update(ct);
    let pt: Uint8Array;
    try {
      pt = new Uint8Array(
        await subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: nonce(prefix, i, i === count - 1) as BufferSource,
            additionalData: header as BufferSource
          },
          keys.aes,
          ct as BufferSource
        )
      );
    } catch {
      throw new LockerError('tampered', 'This file is damaged or was changed after locking.');
    }
    if (i === 0) {
      const meta = parseMeta(pt);
      name = sanitizeName(meta.name);
      type = meta.type;
      onMeta?.(name, type);
      pt = pt.subarray(meta.length);
    }
    if (sink) await sink(pt);
    else plain.push(pt);
    onProgress?.('crypt', (i + 1) / count);
  }

  return {
    name,
    type,
    parts: plain,
    seal: header.slice(COMMIT_OFFSET, COMMIT_OFFSET + 8),
    params: info.params,
    fileHash: hash.digest()
  };
}

/** Reads the name and type stored at the front of the first chunk. */
function parseMeta(first: Uint8Array): { name: string; type: string; length: number } {
  if (first.length < 3) throw new LockerError('tampered', 'This file is damaged.');
  const nameLen = new DataView(first.buffer, first.byteOffset).getUint16(0, false);
  if (3 + nameLen > first.length) throw new LockerError('tampered', 'This file is damaged.');
  const typeLen = first[2 + nameLen];
  const length = 3 + nameLen + typeLen;
  if (length > first.length) throw new LockerError('tampered', 'This file is damaged.');
  try {
    return {
      name: dec.decode(first.subarray(2, 2 + nameLen)),
      type: dec.decode(first.subarray(3 + nameLen, length)),
      length
    };
  } catch {
    throw new LockerError('tampered', 'This file is damaged.');
  }
}

/** A restored name must never contain a path. */
export function sanitizeName(name: string): string {
  // Path separators, characters Windows forbids, and control characters all become '_'.
  const safe = Array.from(name, ch => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('');
  const n = safe.replace(/^\.+/, '').trim();
  return n || 'unlocked-file';
}

export function bytesSource(bytes: Uint8Array): Source {
  return { size: bytes.length, read: async (o, l) => bytes.subarray(o, o + l) };
}

export function blobSource(blob: Blob): Source {
  return { size: blob.size, read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()) };
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ---------- ASCII armour: for notes, and for hosts that only save text ---------- */

const ARMOR = {
  file: ['-----BEGIN ARGONVAULT LOCKED FILE-----', '-----END ARGONVAULT LOCKED FILE-----'],
  note: ['-----BEGIN ARGONVAULT LOCKED NOTE-----', '-----END ARGONVAULT LOCKED NOTE-----']
};

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function armor(bytes: Uint8Array, kind: 'file' | 'note'): string {
  const b64 = toBase64(bytes);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return [ARMOR[kind][0], ...lines, ARMOR[kind][1], ''].join('\n');
}

/** Returns null if the text has no armour block. */
export function dearmor(text: string): Uint8Array | null {
  const m = text.match(
    /-----BEGIN ARGONVAULT LOCKED (?:FILE|NOTE)-----([\s\S]*?)-----END ARGONVAULT LOCKED (?:FILE|NOTE)-----/
  );
  if (!m) return null;
  const b64 = m[1].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new LockerError('tampered', 'The locked text is damaged.');
  return fromBase64(b64);
}

/** Short human-checkable form of a seal, e.g. 7F3A-91C2-0BDE-44A1. */
export function sealCode(seal: Uint8Array): string {
  const hex = Array.from(seal, b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  return hex.match(/.{4}/g)!.join('-');
}
