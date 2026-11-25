import { HARDENED, STANDARD, type KdfParams } from './format';
import { currentEngine, deriveArgon2id } from './kdf';
import { createSha256 } from './hash';

export interface BenchResult {
  /** Milliseconds for one Argon2id derivation at each setting (null if this device couldn't run it). */
  argonStandardMs: number | null;
  argonHardenedMs: number | null;
  /** AES-256-GCM in 1 MiB chunks, MB/s. */
  encryptMBs: number;
  decryptMBs: number;
  /** SHA-256 of the locked file (used for blockchain timestamps), MB/s. */
  hashMBs: number;
  engine: string | null;
  cores: number | null;
  memoryGB: number | null;
  userAgent: string;
}

const MB = 1024 * 1024;
const SAMPLE_MB = 64;

async function timeArgon(params: KdfParams): Promise<number | null> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pw = new TextEncoder().encode('benchmark passphrase');
  const t0 = performance.now();
  try {
    await deriveArgon2id(pw, salt, params);
  } catch {
    return null;
  }
  return Math.round(performance.now() - t0);
}

function fill(buf: Uint8Array) {
  for (let i = 0; i < buf.length; i += 65536)
    crypto.getRandomValues(buf.subarray(i, i + 65536) as Uint8Array<ArrayBuffer>);
}

/** Measures what this device can do. Runs in the crypto worker. */
export async function runBenchmark(): Promise<BenchResult> {
  const argonStandardMs = await timeArgon(STANDARD);
  const argonHardenedMs = await timeArgon(HARDENED);

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const chunk = new Uint8Array(MB);
  fill(chunk);
  const iv = new Uint8Array(12);
  const cts: ArrayBuffer[] = [];

  let t0 = performance.now();
  for (let i = 0; i < SAMPLE_MB; i++) {
    new DataView(iv.buffer).setUint32(8, i);
    cts.push(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, chunk as BufferSource));
  }
  const encryptMBs = SAMPLE_MB / ((performance.now() - t0) / 1000);

  t0 = performance.now();
  for (let i = 0; i < SAMPLE_MB; i++) {
    new DataView(iv.buffer).setUint32(8, i);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cts[i]);
  }
  const decryptMBs = SAMPLE_MB / ((performance.now() - t0) / 1000);

  t0 = performance.now();
  const h = await createSha256();
  for (let i = 0; i < SAMPLE_MB; i++) h.update(chunk);
  h.digest();
  const hashMBs = SAMPLE_MB / ((performance.now() - t0) / 1000);

  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    argonStandardMs,
    argonHardenedMs,
    encryptMBs: Math.round(encryptMBs),
    decryptMBs: Math.round(decryptMBs),
    hashMBs: Math.round(hashMBs),
    engine: currentEngine(),
    cores: nav.hardwareConcurrency ?? null,
    memoryGB: nav.deviceMemory ?? null,
    userAgent: nav.userAgent
  };
}
