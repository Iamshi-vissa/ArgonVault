import { argon2id as argon2Wasm } from 'hash-wasm';
import { argon2idAsync as argon2Js } from '@noble/hashes/argon2.js';
import type { DeriveFn } from './format';

export type Engine = 'wasm' | 'js';
let engine: Engine | null = null;

/**
 * Argon2id. Uses the WebAssembly build of hash-wasm (fast); if the page's
 * security policy blocks WebAssembly, falls back to @noble/hashes, a pure
 * JavaScript implementation. Both produce identical output.
 */
export const deriveArgon2id: DeriveFn = async (password, salt, { m, t, p }, onProgress) => {
  if (engine !== 'js') {
    try {
      const out = await argon2Wasm({
        password,
        salt,
        iterations: t,
        parallelism: p,
        memorySize: m,
        hashLength: 32,
        outputType: 'binary'
      });
      engine = 'wasm';
      return out;
    } catch (e) {
      if (engine === 'wasm') throw e;
      engine = 'js';
    }
  }
  return argon2Js(password, salt, { t, m, p, dkLen: 32, asyncTick: 25, onProgress });
};

export const currentEngine = () => engine;
