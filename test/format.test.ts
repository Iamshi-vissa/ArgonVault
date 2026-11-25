import { describe, expect, it } from 'vitest';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import {
  armor,
  bytesSource,
  concat,
  dearmor,
  HEADER_LEN,
  lock,
  LockerError,
  unlock,
  sanitizeName,
  truncateName,
  type KdfParams
} from '../src/crypto/format';
import { deriveArgon2id } from '../src/crypto/kdf';

// Small cost so the suite is fast; the format and code path are the same.
const FAST: KdfParams = { m: 8 * 1024, t: 1, p: 1 };
const CHUNK = 12; // 4 KiB chunks, so small inputs still span several chunks

const rand = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536));
  return b;
};

async function seal(data: Uint8Array, pw = 'correct horse battery staple', name = 'photo.jpg') {
  const r = await lock(bytesSource(data), name, 'image/jpeg', pw, deriveArgon2id, { params: FAST, chunkLog2: CHUNK });
  return { file: concat(r.parts), seal: r.seal };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as LockerError).code;
  }
  return 'ok';
}

describe('round trip', () => {
  for (const size of [0, 1, 4096 - 20, 4096, 3 * 4096 + 7, 200_000]) {
    it(`restores ${size} bytes, name and type`, async () => {
      const data = rand(size);
      const { file, seal: s1 } = await seal(data);
      const out = await unlock(bytesSource(file), 'correct horse battery staple', deriveArgon2id);
      expect(concat(out.parts)).toEqual(data);
      expect(out.name).toBe('photo.jpg');
      expect(out.type).toBe('image/jpeg');
      expect(out.seal).toEqual(s1);
    });
  }

  it('normalises Unicode passwords (NFC vs NFD)', async () => {
    const { file } = await seal(rand(100), 'café-päss');
    const out = await unlock(bytesSource(file), 'café-päss', deriveArgon2id);
    expect(out.parts.length).toBeGreaterThan(0);
  });
});

describe('randomness', () => {
  it('locking the same file twice gives different output and seals', async () => {
    const data = rand(5000);
    const a = await seal(data);
    const b = await seal(data);
    expect(a.file).not.toEqual(b.file);
    expect(a.seal).not.toEqual(b.seal);
  });
  it('ciphertext does not contain the file name', async () => {
    const { file } = await seal(rand(10), 'pw-pw-pw-pw', 'secret-plans.pdf');
    expect(Buffer.from(file).includes(Buffer.from('secret-plans'))).toBe(false);
  });
});

describe('attacks are detected', () => {
  it('wrong password', async () => {
    const { file } = await seal(rand(1000));
    expect(await code(unlock(bytesSource(file), 'wrong password', deriveArgon2id))).toBe('wrong-password');
  });

  it('one flipped bit anywhere in the body', async () => {
    const { file } = await seal(rand(3 * 4096));
    for (const pos of [HEADER_LEN, HEADER_LEN + 5000, file.length - 1]) {
      const t = file.slice();
      t[pos] ^= 1;
      expect(await code(unlock(bytesSource(t), 'correct horse battery staple', deriveArgon2id))).toBe('tampered');
    }
  });

  it('changed header fields (salt, nonce prefix, cost)', async () => {
    const { file } = await seal(rand(100));
    for (const pos of [11, 30, 9]) {
      const t = file.slice();
      t[pos] ^= 1;
      expect(await code(unlock(bytesSource(t), 'correct horse battery staple', deriveArgon2id))).not.toBe('ok');
    }
  });

  it('truncation at a chunk boundary', async () => {
    const { file } = await seal(rand(3 * 4096));
    const cut = file.slice(0, HEADER_LEN + 2 * (4096 + 16));
    expect(await code(unlock(bytesSource(cut), 'correct horse battery staple', deriveArgon2id))).toBe('tampered');
  });

  it('appended bytes', async () => {
    const { file } = await seal(rand(500));
    const t = concat([file, new Uint8Array([1, 2, 3])]);
    expect(await code(unlock(bytesSource(t), 'correct horse battery staple', deriveArgon2id))).toBe('tampered');
  });

  it('swapped chunks', async () => {
    const { file } = await seal(rand(3 * 4096));
    const step = 4096 + 16;
    const t = file.slice();
    t.set(file.subarray(HEADER_LEN + step, HEADER_LEN + 2 * step), HEADER_LEN);
    t.set(file.subarray(HEADER_LEN, HEADER_LEN + step), HEADER_LEN + step);
    expect(await code(unlock(bytesSource(t), 'correct horse battery staple', deriveArgon2id))).toBe('tampered');
  });

  it('a chunk moved from another file locked with the same password', async () => {
    const a = await seal(rand(3 * 4096));
    const b = await seal(rand(3 * 4096));
    const t = a.file.slice();
    t.set(b.file.subarray(HEADER_LEN, HEADER_LEN + 4112), HEADER_LEN);
    expect(await code(unlock(bytesSource(t), 'correct horse battery staple', deriveArgon2id))).toBe('tampered');
  });

  it('a hostile header asking for 4 GiB of memory is refused before any work', async () => {
    const { file } = await seal(rand(10));
    const t = file.slice();
    new DataView(t.buffer).setUint32(5, 0xffffffff);
    expect(await code(unlock(bytesSource(t), 'x', deriveArgon2id))).toBe('unsupported');
  });

  it('random junk', async () => {
    expect(await code(unlock(bytesSource(rand(500)), 'x', deriveArgon2id))).toBe('not-locker');
  });
});

describe('armour and names', () => {
  it('armour round trip', async () => {
    const { file } = await seal(rand(9999));
    const text = armor(file, 'file');
    expect(text.split('\n').every(l => l.length <= 64 || l.startsWith('-----'))).toBe(true);
    expect(dearmor('some text before\n' + text)).toEqual(file);
  });
  it('restored names cannot escape a folder', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeName('')).toBe('unlocked-file');
  });
});

describe('Argon2id engines agree', () => {
  it('hash-wasm and @noble/hashes produce the same key', async () => {
    const pw = new TextEncoder().encode('password');
    const salt = new Uint8Array(16).fill(7);
    const a = await deriveArgon2id(pw, salt, FAST);
    const b = await argon2idAsync(pw, salt, { t: 1, m: 8192, p: 1, dkLen: 32 });
    expect(a).toEqual(b);
  });

  it('matches the reference C implementation (known answer)', async () => {
    // Known answer for password "password", salt "somesalt", t=2, m=65536 KiB, p=1 (computed with argon2-cffi, which wraps the reference C code).
    const out = await deriveArgon2id(new TextEncoder().encode('password'), new TextEncoder().encode('somesalt'), {
      m: 65536,
      t: 2,
      p: 1
    });
    expect(Buffer.from(out).toString('hex')).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
  });
});

describe('long names and types (regression)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it('truncates a long multi-byte name without splitting a character, keeping the extension', () => {
    const name = 'संग्रह-'.repeat(40) + '.pdf';
    const t = truncateName(name);
    expect(bytes(t)).toBeLessThanOrEqual(255);
    expect(t.endsWith('.pdf')).toBe(true);
    expect(t).not.toContain('\uFFFD');
  });

  it('a file with a 600-byte name and a multi-byte type still opens', async () => {
    const name = '文件'.repeat(100) + '.txt';
    const type = 'application/x-' + 'ü'.repeat(200);
    const r = await lock(bytesSource(rand(50)), name, type, 'correct horse battery staple', deriveArgon2id, {
      params: FAST,
      chunkLog2: CHUNK
    });
    const out = await unlock(bytesSource(concat(r.parts)), 'correct horse battery staple', deriveArgon2id);
    expect(out.name.endsWith('.txt')).toBe(true);
    expect(bytes(out.name)).toBeLessThanOrEqual(255);
    expect(out.type.startsWith('application/x-ü')).toBe(true);
  });

  it('an empty password is refused before any work', async () => {
    expect(await code(lock(bytesSource(rand(10)), 'a', '', '', deriveArgon2id, { params: FAST }))).toBe('bad-input');
  });
});

describe('streaming and file fingerprint', () => {
  const PW = 'correct horse battery staple';

  it('streamed output equals in-memory output, and fileHash is SHA-256 of the locked file', async () => {
    const data = rand(5 * 4096 + 11);
    const streamed: Uint8Array[] = [];
    const r = await lock(bytesSource(data), 'a.bin', '', PW, deriveArgon2id, {
      params: FAST,
      chunkLog2: CHUNK,
      sink: p => void streamed.push(p.slice())
    });
    expect(r.parts).toHaveLength(0);
    const file = concat(streamed);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file as BufferSource));
    expect(r.fileHash).toEqual(digest);

    const out: Uint8Array[] = [];
    let meta = '';
    const u = await unlock(bytesSource(file), PW, deriveArgon2id, {
      sink: p => void out.push(p.slice()),
      onMeta: n => (meta = n)
    });
    expect(meta).toBe('a.bin');
    expect(concat(out)).toEqual(data);
    expect(u.fileHash).toEqual(digest);
  });

  it('a streamed unlock stops at the damaged chunk and reports tampering', async () => {
    const { file } = await seal(rand(4 * 4096));
    const t = file.slice();
    t[HEADER_LEN + 2 * (4096 + 16) + 9] ^= 1; // damage the third chunk
    const out: Uint8Array[] = [];
    const result = await code(unlock(bytesSource(t), PW, deriveArgon2id, { sink: p => void out.push(p) }));
    expect(result).toBe('tampered');
    expect(out.length).toBe(2); // the caller must discard these: File System Access only commits on close
  });
});
