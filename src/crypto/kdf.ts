import { argon2id as argon2Wasm } from 'hash-wasm';
import { argon2idAsync as argon2Js } from '@noble/hashes/argon2.js';
import type { DeriveFn } from './format';

export type Engine = 'wasm' | 'js';

/**
 * Whether this page may compile WebAssembly. A Content Security Policy without
 * 'wasm-unsafe-eval' blocks it; compiling the smallest valid module tells us.
 */
function wasmAllowed(): boolean {
  try {
    new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    return true;
  } catch {
    return false;
  }
}

let engine: Engine | null = null;
const pick = (): Engine => (engine ??= typeof WebAssembly === 'object' && wasmAllowed() ? 'wasm' : 'js');

/**
 * Argon2id. Uses the WebAssembly build of hash-wasm (fast); where the page's
 * policy blocks WebAssembly, uses @noble/hashes, a pure JavaScript
 * implementation with identical output. Errors from the chosen engine, such as
 * running out of memory, are reported rather than retried on the slow engine.
 */
export const deriveArgon2id: DeriveFn = async (password, salt, { m, t, p }, onProgress) => {
  if (pick() === 'wasm') {
    return argon2Wasm({
      password,
      salt,
      iterations: t,
      parallelism: p,
      memorySize: m,
      hashLength: 32,
      outputType: 'binary'
    });
  }
  return argon2Js(password, salt, { t, m, p, dkLen: 32, asyncTick: 25, onProgress });
};

export const currentEngine = () => engine;
