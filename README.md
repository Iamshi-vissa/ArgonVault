# ArgonVault

Lock files and notes with a password, entirely in the browser. Nothing is uploaded: there's no server, no account, and no recovery. Optionally, prove when a locked file existed with a timestamp on the Ethereum Sepolia test network.

- **Argon2id** password stretching (64 MiB / 3 passes, or 256 MiB / 4 passes "hardened")
- **AES-256-GCM** in 1 MiB authenticated chunks (STREAM construction), with keys split by **HKDF-SHA256**
- **Key commitment** (HMAC-SHA256), so a wrong password is reported as such, distinct from tampering
- Detects any flipped bit, truncation, appended data, reordered chunks, or chunks spliced in from another file
- The original **file name and type are encrypted** too
- **Large files stream straight to disk** (File System Access API) instead of being held in memory
- **Blockchain timestamps**: a Solidity contract records the SHA-256 of the locked file (never the contents)
- A **guilloché seal** drawn from each file's key commitment: same file + same password = same seal
- Password strength checking (zxcvbn) and a six-word **EFF Diceware** passphrase generator (≈77.5 bits)
- A built-in **benchmark** that measures Argon2id and AES-GCM on the device you're using
- All cryptography runs in a **Web Worker**; the deployed site's Content Security Policy forbids every network connection and every inline script
- An olive and beige interface (light and dark) built with React Bits components. The landing page loads in about 130 KB (compressed), and its animations pause while you scroll

**Live site:** https://argonvault.vercel.app

**Documents:** [design and threat model](docs/DESIGN.md) · [measurements and attack estimates](docs/BENCHMARKS.md) · [code walkthrough](docs/WALKTHROUGH.md)

## Run it

```bash
npm install
npm run dev              # development server
npm test                 # unit + contract tests (Vitest)
npm run build            # dist/: the multi-file site that Vercel serves
npm run test:e2e         # end-to-end tests on the built site (Playwright)
npm run lint             # oxlint
npm run format:check     # Prettier
npm run deadcode         # knip: unused files, exports and dependencies
npm run typecheck        # TypeScript
npm run build:standalone # dist-standalone/index.html: one file that works offline, even from disk
npm run compile:contract # recompile contracts/ArgonVaultTimestamps.sol into src/chain/artifact.json
```

For end-to-end tests, run `npx playwright install chromium` once, or set `CHROME_PATH` to an installed Chrome.

`npm run build:artifact` makes the single-file variant published as a Claude artifact. There, the host only lets pages save common file types, so locked files are saved as ASCII-armoured `.txt` and restored files with unusual extensions come inside a `.zip`. Every build reads every format.

Requires Node.js 20 or newer.

## Blockchain timestamps: one-time setup

The site needs the address of a deployed `ArgonVaultTimestamps` contract on Sepolia.

1. Install MetaMask (or another wallet) and get a little free Sepolia test ETH from a faucet.
2. Open the site at **`/#setup`** and choose **Deploy with my wallet**. Approve the transaction.
3. Copy the contract address it shows. In Vercel, open the project's **Settings → Environment Variables**, add `VITE_STAMP_CONTRACT` = that address, and redeploy.

Until then, the timestamp panel explains that timestamps aren't set up. The setup page also lets one browser use an existing contract without redeploying.

## How it works

```
password ──NFC──▶ Argon2id(salt, m, t, p) ──▶ master key (32 bytes)
master ──HKDF-SHA256 "argonvault/v1/enc"────▶ AES-256-GCM key (non-extractable)
master ──HKDF-SHA256 "argonvault/v1/commit"─▶ HMAC-SHA256 key ──▶ commitment over the header
```

### File format (v1)

| Offset | Size | Field                                         |
| -----: | ---: | --------------------------------------------- |
|      0 |    3 | magic `AGV`                                   |
|      3 |    1 | version = 1                                   |
|      4 |    1 | KDF id = 1 (Argon2id)                         |
|      5 |    4 | Argon2 memory, KiB (big-endian)               |
|      9 |    1 | Argon2 iterations _t_                         |
|     10 |    1 | Argon2 parallelism _p_                        |
|     11 |   16 | random salt                                   |
|     27 |    1 | log2(chunk size) = 20                         |
|     28 |    7 | random nonce prefix                           |
|     35 |   32 | key commitment = HMAC(commit key, bytes 0–34) |
|     67 |    … | chunks: ciphertext ‖ 16-byte GCM tag          |

- **Nonce** for chunk _i_: `prefix (7) ‖ i (u32) ‖ last-flag (1)`. Since every file has a fresh salt, it has a fresh key, so nonces never repeat under one key.
- **Associated data** for every chunk is the full 67-byte header. Changing any header field, including the Argon2 cost, breaks every chunk.
- **The counter** stops reordering. **The last-flag** stops truncation at a chunk boundary and appending.
- **Plaintext** starts with metadata: `nameLen (u16) ‖ name ‖ typeLen (u8) ‖ type`, then the file bytes.
- **When opening**, Argon2 parameters outside safe limits (8 MiB–1 GiB, t ≤ 16, p ≤ 16) are refused before any work, so a hostile file can't exhaust memory.
- **Restored names** are stripped of path characters.

### Why each piece

| Choice                        | Reason                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Argon2id, not PBKDF2          | Memory-hard: GPUs and ASICs gain little, because every guess needs 64 MiB of RAM (RFC 9106, §4).                                    |
| HKDF key separation           | One password-derived secret should never be used directly for two jobs.                                                             |
| Key commitment                | AES-GCM alone isn't key-committing. The HMAC lets the app say "wrong password" with certainty, and binds the ciphertext to one key. |
| Chunked AEAD                  | Big files never need to be decrypted in one piece, and any damage is found before anything is saved.                                |
| NFC normalisation             | "é" typed as one or two code points gives the same key.                                                                             |
| Minimum strength (zxcvbn ≥ 3) | The password is the weakest link. Argon2 slows guessing but can't save "password123".                                               |

## Threat model and limits

Protects against someone who gets the locked file (a stolen laptop, a cloud leak, a lost USB stick) but not the password.

It does **not** protect against:

- a weak password
- malware or a malicious browser extension on the device while you type
- someone watching your screen

Other limits, stated honestly:

- **Size leaks:** the locked file's size reveals the original's approximate size.
- **Memory wiping is best effort:** JavaScript can't guarantee secret bytes are wiped from memory. The app zeroes buffers it controls and keeps keys non-extractable.
- **Memory:** where the browser can't stream to disk, files must fit in memory and are limited to 1 GB (512 MB on devices reporting 4 GB of RAM or less). Chrome and Edge on a computer stream files over 200 MB straight to disk, up to 64 GB.
- **Timestamps prove when, not who:** see [DESIGN.md §6](docs/DESIGN.md#6-blockchain-timestamps).

The full threat model is in [docs/DESIGN.md](docs/DESIGN.md).

## Tests

37 unit and contract tests (Vitest) and 9 end-to-end tests (Playwright).

- **Unit tests** (`test/format.test.ts`):
  - Round trips at chunk-boundary sizes and with Unicode passwords.
  - Fresh randomness on every lock.
  - Every tampering case: bit flips in the header and body, truncation, appending, swapped chunks, splicing from another file, hostile Argon2 cost, random junk.
  - Long multi-byte names and types.
  - Streaming output and the SHA-256 fingerprint, and that a streamed unlock stops at a damaged chunk.
  - Argon2id checked against the reference C implementation (known answer); WebAssembly and JavaScript engines agree.
- **State machine** (`test/job.test.ts`): every transition of the lock/unlock job, including ignoring stale results.
- **Smart contract** (`test/contract.test.ts`): the compiled contract runs in an in-process EVM (EthereumJS), driven by the app's own ABI encoder: stamp, read back, refuse a second stamp, refuse the zero hash.
- **End-to-end** (`e2e/app.spec.ts`, Playwright on the production build):
  - The landing page and navigation.
  - Lock, then unlock to the identical bytes. A wrong password and a tampered file are both refused.
  - Notes as pasted text.
  - Streaming large files to disk and back.
  - The blockchain flow with a mock wallet, checking the exact transaction data, and the message for a wrong contract address.
  - The benchmark.
  - A performance guard: scrolling the landing page must not trigger layout work every frame.

GitHub Actions runs lint, formatting, a dead-code check, types, a check that the contract artifact is current, all tests, the build and the end-to-end tests on every push.

## Project layout

```
contracts/ArgonVaultTimestamps.sol   timestamp contract (Solidity)
scripts/compile-contract.mjs         compiles it with solc-js into src/chain/artifact.json
src/crypto/format.ts                 container format: lock, unlock, armour (pure, tested)
src/crypto/kdf.ts                    Argon2id (hash-wasm, with a pure-JS fallback)
src/crypto/hash.ts                   streaming SHA-256 for the file fingerprint
src/crypto/worker.ts                 runs all crypto off the main thread; streams to disk
src/crypto/password.ts               strength meter and Diceware passphrases (loaded on demand)
src/crypto/bench.ts                  the on-device benchmark
src/chain/stamp.ts                   wallet access, ABI encoding, stamp and look-up
src/tool/                            lock/unlock page: useCryptoJob state machine, form parts, outcome, stamp panel
src/Landing.tsx                      landing page: about, how to use, details, benchmark
src/Setup.tsx                        one-time contract deployment (#setup)
src/App.tsx                          routing on #lock, #unlock, #setup; pages load on demand
src/ui/                              seal, hero, session list, theme, saving files
src/rb/                              React Bits components (see src/rb/README.md)
docs/                                design, measurements, walkthrough
```

## Credits

- UI components from [React Bits](https://reactbits.dev) by David Haz: AeroShards, ParticleText, VariableProximity, AnimatedContent, AnimatedList, HoldButton, RubberSegment, StatusMark, DecryptedText (MIT + Commons Clause, used as part of this application). The list and local changes are in `src/rb/README.md`.
- VariableProximity is changed to use the app's self-hosted variable fonts (Bodoni Moda, Hanken Grotesk) instead of loading Roboto Flex from Google, which the security policy would block.
- AeroShards needs WebGPU (current Chrome, Edge and Safari). Without it, the page simply leaves the shards out.
- [EFF Large Wordlist](https://www.eff.org/dice) (CC BY 3.0 US).
- [hash-wasm](https://github.com/Daninet/hash-wasm), [GSAP](https://gsap.com), [Hugeicons](https://hugeicons.com), [vgpu](https://github.com/vercel-labs/vgpu), [@noble/hashes](https://github.com/paulmillr/noble-hashes), [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn), [fflate](https://github.com/101arrowz/fflate).
- AES-GCM, HKDF and HMAC come from the browser's built-in Web Crypto API.
