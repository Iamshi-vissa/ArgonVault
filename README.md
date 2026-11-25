# ArgonVault

Lock files and notes with a password, entirely in the browser. Nothing is uploaded: there's no server, no account, and no recovery.

- **Argon2id** password stretching (64 MiB / 3 passes, or 256 MiB / 4 passes "hardened")
- **AES-256-GCM** in 1 MiB authenticated chunks (STREAM-style), with keys split by **HKDF-SHA256**
- **Key commitment** (HMAC-SHA256), so a wrong password is reported as such, distinct from tampering
- Detects any flipped bit, truncation, appended data, reordered chunks, or chunks spliced in from another file
- The original **file name and type are encrypted** too
- A **guilloché seal** drawn from each file's key commitment: same file + same password = same seal
- Olive and beige interface (light and dark), with a particle wordmark, WebGPU glass shards, and a **session list** of what you locked or opened (locked items can be saved again; opened contents aren't kept)
- Password strength checking (zxcvbn) and a 6-word **EFF Diceware** passphrase generator (≈77.5 bits)
- All cryptography runs in a **Web Worker**; the standalone build has a CSP that forbids every network connection

## Run it

```bash
npm install
npm run dev          # development server
npm test             # 26 tests: round trips, attack cases and regressions
npm run build        # dist/index.html: one self-contained file that works offline
```

`dist/index.html` can be opened straight from disk. Its Content Security Policy sets `connect-src 'none'`, so the page cannot send anything anywhere, even if a dependency tried.

`npm run build:artifact` makes the variant published as a Claude artifact. There, the host only lets pages save common file types, so locked files are saved as ASCII-armoured `.txt` and restored files with unusual extensions come inside a `.zip`. Both builds read both formats.

## How it works

```
password ──NFC──▶ Argon2id(salt, m, t, p) ──▶ master key (32 bytes)
master ──HKDF-SHA256 "argonvault/v1/enc"────▶ AES-256-GCM key (non-extractable)
master ──HKDF-SHA256 "argonvault/v1/commit"─▶ HMAC-SHA256 key ──▶ commitment over the header
```

### File format (v1)

| Offset | Size | Field |
|---:|---:|---|
| 0 | 3 | magic `AGV` |
| 3 | 1 | version = 1 |
| 4 | 1 | KDF id = 1 (Argon2id) |
| 5 | 4 | Argon2 memory, KiB (big-endian) |
| 9 | 1 | Argon2 iterations *t* |
| 10 | 1 | Argon2 parallelism *p* |
| 11 | 16 | random salt |
| 27 | 1 | log2(chunk size) = 20 |
| 28 | 7 | random nonce prefix |
| 35 | 32 | key commitment = HMAC(commit key, bytes 0–34) |
| 67 | … | chunks: ciphertext ‖ 16-byte GCM tag |

- **Nonce** for chunk *i*: `prefix (7) ‖ i (u32) ‖ last-flag (1)`. Since every file has a fresh salt, it has a fresh key, so nonces never repeat under one key.
- **Associated data** for every chunk is the full 67-byte header. Changing any header field, including the Argon2 cost, breaks every chunk.
- **The counter** stops reordering. **The last-flag** stops truncation at a chunk boundary and appending.
- **Plaintext** starts with metadata: `nameLen (u16) ‖ name ‖ typeLen (u8) ‖ type`, then the file bytes.
- **When opening**, Argon2 parameters outside safe limits (8 MiB–1 GiB, t ≤ 16, p ≤ 16) are refused before any work, so a hostile file can't exhaust memory.
- **Restored names** are stripped of path characters.

### Why each piece

| Choice | Reason |
|---|---|
| Argon2id, not PBKDF2 | Memory-hard: GPUs and ASICs gain little, because every guess needs 64 MiB of RAM (RFC 9106, §4). |
| HKDF key separation | One password-derived secret should never be used directly for two jobs. |
| Key commitment | AES-GCM alone isn't key-committing. The HMAC lets the app say "wrong password" with certainty, and binds the ciphertext to one key. |
| Chunked AEAD | Big files never need to be decrypted in one piece, and any damage is found before anything is saved. |
| NFC normalisation | "é" typed as one or two code points gives the same key. |
| Minimum strength (zxcvbn ≥ 3) | The password is the weakest link. Argon2 slows guessing but can't save "password123". |

## Threat model and limits

Protects against someone who gets the locked file (a stolen laptop, a cloud leak, a lost USB stick) but not the password.

It does **not** protect against:

- a weak password
- malware or a malicious browser extension on the device while you type
- someone watching your screen

Other limits, stated honestly:

- **Size leaks:** the locked file's size reveals the original's approximate size.
- **Memory wiping is best effort:** JavaScript can't guarantee secret bytes are wiped from memory. The app zeroes buffers it controls and keeps keys non-extractable.
- **Files must fit in memory:** files over about 2 GB are refused.

## Tests

`test/format.test.ts` covers:

- round trips at chunk-boundary sizes (0 B to 200 KB), plus Unicode password normalisation
- fresh randomness on every lock, and the file name not appearing in the output
- wrong password, a flipped bit in the header or body, truncation, appended bytes, swapped chunks, a chunk spliced from another file, a hostile Argon2 cost, random junk
- ASCII-armour round trip and path sanitising
- Argon2id output checked against the reference C implementation (known answer), with the WebAssembly and pure-JS engines agreeing

## Project layout

```
src/crypto/format.ts    container format: lock, unlock, armour (pure, testable)
src/crypto/kdf.ts       Argon2id (hash-wasm, with a pure-JS fallback)
src/crypto/worker.ts    runs all crypto off the main thread
src/crypto/password.ts  strength meter and Diceware passphrases
src/ui/Seal.tsx         guilloché seal generated from the key commitment
src/ui/save.ts          saving files (browser download or artifact host)
src/ui/Hero.tsx         particle wordmark and WebGPU shard background
src/ui/Session.tsx      list of what was locked or opened this session
src/rb/                 React Bits components
src/App.tsx             two pages, routed on #lock / #unlock
src/Landing.tsx         landing page: about, how to use, details
src/Tool.tsx            lock and unlock page
```

## Credits

- UI components from [React Bits](https://reactbits.dev) by David Haz: AeroShards, ParticleText, AnimatedContent, AnimatedList, HoldButton, RubberSegment, StatusMark, DecryptedText (MIT + Commons Clause, used as part of this application).
- AeroShards needs WebGPU (current Chrome, Edge and Safari). Without it, the page simply leaves the shards out.
- [EFF Large Wordlist](https://www.eff.org/dice) (CC BY 3.0 US).
- [hash-wasm](https://github.com/Daninet/hash-wasm), [GSAP](https://gsap.com), [Hugeicons](https://hugeicons.com), [vgpu](https://github.com/vercel-labs/vgpu), [@noble/hashes](https://github.com/paulmillr/noble-hashes), [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn), [fflate](https://github.com/101arrowz/fflate).
- AES-GCM, HKDF and HMAC come from the browser's built-in Web Crypto API.
