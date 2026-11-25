import { createSHA256 } from 'hash-wasm';
import { sha256 } from '@noble/hashes/sha2.js';
import { wasmAllowed } from './wasm';

export interface Hasher {
  update(data: Uint8Array): void;
  digest(): Uint8Array;
}

/**
 * Incremental SHA-256 for the locked-file fingerprint. The WebAssembly build is
 * about ten times faster than pure JavaScript, which matters for large files;
 * the JavaScript one is the fallback where WebAssembly is blocked.
 */
export async function createSha256(): Promise<Hasher> {
  if (typeof WebAssembly === 'object' && wasmAllowed()) {
    const h = await createSHA256();
    h.init();
    return { update: d => void h.update(d), digest: () => h.digest('binary') };
  }
  const h = sha256.create();
  return { update: d => void h.update(d), digest: () => h.digest() };
}
