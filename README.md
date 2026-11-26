# ArgonVault

ArgonVault locks files and short notes with a password, entirely in your browser. Nothing is uploaded, there is no account, and a forgotten password can't be recovered. You can also record a locked file's fingerprint on the Ethereum Sepolia test network to prove when it existed.

Live site: https://argonvault.vercel.app

## What it does

- Stretches the password with Argon2id: 64 MiB and 3 passes by default, or 256 MiB and 4 passes on the Hardened setting.
- Encrypts with AES-256-GCM in 1 MiB authenticated chunks. HKDF-SHA256 derives separate keys for encryption and key commitment.
- Tells a wrong password apart from a damaged or edited file, using an HMAC-SHA256 key commitment.
- Refuses files with a flipped bit, a missing end, extra bytes, reordered chunks or chunks taken from another file.
- Encrypts the original file name and type along with the contents.
- Streams files over 200 MB straight to disk in Chrome and Edge, up to 64 GB.
- Records the SHA-256 of a locked file on Sepolia through your own wallet. The contents never leave the browser.
- Checks password strength with zxcvbn and suggests six-word passphrases from the EFF wordlist (about 77.5 bits).
- Measures how long Argon2id and AES-GCM take on your device.

All cryptography runs in a Web Worker. The site's Content Security Policy sets `connect-src 'none'`, so the browser blocks every network request the page could make.

## Using it

1. Open the site and choose **Lock**.
2. Drop in a file, or switch to **A note** and type some text.
3. Enter a strong password or use **Suggest a passphrase**, then hold **Hold to lock**.
4. Save the `.argonvault` file. The pattern shown with it, the seal, appears again when you unlock this file.
5. To open it, choose **Unlock**, drop in the locked file and enter the password.

### Blockchain timestamps

The site uses the `ArgonVaultTimestamps` contract at [`0x8e372ef953032a1e41187bc5c51e14602edae7a8`](https://sepolia.etherscan.io/address/0x8e372ef953032a1e41187bc5c51e14602edae7a8) on Sepolia. You need MetaMask or another wallet with a little free Sepolia ETH.

- After locking, choose **Timestamp with my wallet** and approve the transaction.
- To verify, unlock the same file and choose **Check the timestamp**.

A stamp belongs to one exact locked file. Locking the same original again produces different bytes (new salt and nonces), so the new file has no stamp.

A timestamp proves the locked file existed by that block. It doesn't prove who wrote the contents.

## How it works

```
password ─NFC─▶ Argon2id(salt, m, t, p) ─▶ master key (32 bytes)
master ─HKDF-SHA256 "argonvault/v1/enc"──▶ AES-256-GCM key
master ─HKDF-SHA256 "argonvault/v1/commit"─▶ HMAC-SHA256 key ─▶ commitment over the header
```

Unlocking reverses this. ArgonVault reads the header, runs Argon2id with the stored salt and settings, and checks the commitment. A mismatch means the password is wrong, and nothing is decrypted. It then decrypts each chunk and checks its tag. A failed tag means the file was changed, and nothing is saved.

### File format (version 1)

| Offset | Size | Field                                         |
| -----: | ---: | --------------------------------------------- |
|      0 |    3 | Magic `AGV`                                   |
|      3 |    1 | Version = 1                                   |
|      4 |    1 | KDF id = 1 (Argon2id)                         |
|      5 |    4 | Argon2 memory in KiB (big-endian)             |
|      9 |    1 | Argon2 iterations _t_                         |
|     10 |    1 | Argon2 parallelism _p_                        |
|     11 |   16 | Random salt                                   |
|     27 |    1 | log2 of the chunk size (20 = 1 MiB)           |
|     28 |    7 | Random nonce prefix                           |
|     35 |   32 | Key commitment = HMAC(commit key, bytes 0–34) |
|     67 |    … | Chunks: ciphertext followed by a 16-byte tag  |

- The nonce for chunk _i_ is `prefix (7 bytes) ‖ i (u32) ‖ last-chunk flag (1 byte)`. Every file has a new salt and therefore a new key, so a nonce never repeats under the same key.
- Every chunk uses the full 67-byte header as associated data. Changing any header field, including the Argon2 cost, makes every chunk fail.
- The counter prevents reordering. The last-chunk flag prevents truncation and appended data.
- The plaintext starts with `nameLen (u16) ‖ name ‖ typeLen (u8) ‖ type`, followed by the file.
- When opening a file, Argon2 settings outside 8 MiB–1 GiB, _t_ ≤ 16 and _p_ ≤ 16 are refused before any work starts, so a hostile header can't exhaust memory.
- Restored file names are stripped of path characters.
- The seal is the first 8 bytes of the commitment, drawn as a guilloché pattern. It's a visual check that you're holding the file you locked; integrity comes from the GCM tags.

### Design choices

| Choice                     | Reason                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Argon2id instead of PBKDF2 | Each guess needs 64 MiB of memory, which removes most of the advantage of GPUs and ASICs (RFC 9106, §4).          |
| HKDF key separation        | A key derived from the password is never used for two different jobs.                                             |
| Key commitment             | AES-GCM isn't key-committing. The HMAC identifies a wrong password with certainty and binds each file to one key. |
| Chunked encryption         | Large files never have to fit in memory, and damage is found before anything is saved.                            |
| NFC normalisation          | An accented letter typed as one or two code points gives the same key.                                            |
| Minimum zxcvbn score of 3  | The password is the weakest link. Argon2id slows guessing but can't rescue a common password.                     |

## Security limits

ArgonVault protects a locked file from someone who has the file but not the password, for example from a stolen laptop, a leaked cloud folder or a lost USB stick.

It doesn't protect against:

- a weak password;
- malware or a malicious browser extension on the device while you type;
- someone watching your screen;
- a compromised host serving different code. The standalone build (below) can be run offline instead.

Other limits:

- The locked file's size reveals the original's approximate size.
- JavaScript can't guarantee that secrets are erased from memory. The app zeroes the buffers it controls and keeps Web Crypto keys non-extractable.
- Where the browser can't stream to disk, files must fit in memory: up to 1 GB, or 512 MB on devices that report 4 GB of RAM or less.

The full threat model is in [docs/DESIGN.md](docs/DESIGN.md).

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev               # development server
npm test                  # unit and contract tests (Vitest)
npm run build             # dist/: the site Vercel serves
npm run preview           # serve dist/ on port 4173
npm run test:e2e          # end-to-end tests on the built site (Playwright)
npm run lint              # oxlint
npm run format:check      # Prettier
npm run deadcode          # knip: unused files, exports and dependencies
npm run typecheck         # TypeScript
npm run build:standalone  # dist-standalone/index.html: one file that works offline
npm run compile:contract  # rebuild src/chain/artifact.json from the Solidity source
```

For the end-to-end tests, run `npx playwright install chromium` once, or set `CHROME_PATH` to an installed Chrome.

`npm run build:artifact` builds another single-file variant for sandboxed hosts that only allow saving common file types. There, locked files are saved as ASCII-armoured `.txt`, and restored files with unusual extensions are wrapped in a `.zip`. Every build can open files from every other build.

### Deploying your own timestamp contract

1. Open the site at `/#setup` with a wallet that holds some Sepolia ETH.
2. Choose **Deploy with my wallet** and approve the transaction.
3. In Vercel, set the environment variable `VITE_STAMP_CONTRACT` to the address shown, then redeploy.

The setup page can also point a single browser at an existing contract without redeploying.

### Tests

There are 37 unit and contract tests (Vitest) and 9 end-to-end tests (Playwright).

- `test/format.test.ts` covers:
  - round trips at chunk-boundary sizes and with Unicode passwords;
  - fresh randomness on every lock;
  - every tampering case listed above, plus a hostile Argon2 cost and random junk;
  - long multi-byte names and streaming output;
  - a known-answer test against the reference Argon2 C implementation.
- `test/password.test.ts` checks that common passwords are rejected and generated passphrases are accepted.
- `test/job.test.ts` covers the lock and unlock state machine, including ignoring results from a job the user has moved on from.
- `test/contract.test.ts` runs the compiled contract in an in-process EVM (EthereumJS), using the app's own ABI encoder.
- `e2e/app.spec.ts` drives the production build in Chrome. It covers:
  - navigation;
  - lock and unlock, including a wrong password and a tampered file;
  - notes and streaming;
  - the timestamp flow with a mock wallet;
  - the benchmark;
  - a guard that scrolling the landing page doesn't trigger layout work on every frame.

GitHub Actions runs lint, formatting, the dead-code check, type checking, a check that the contract artifact matches its source, all tests, the build and the end-to-end tests on every push.

### Project layout

```
contracts/ArgonVaultTimestamps.sol  timestamp contract (Solidity)
scripts/compile-contract.mjs        compiles it with solc-js into src/chain/artifact.json
src/crypto/format.ts                file format: lock, unlock, armour
src/crypto/kdf.ts                   Argon2id (hash-wasm, with a JavaScript fallback)
src/crypto/hash.ts                  streaming SHA-256 for the file fingerprint
src/crypto/worker.ts                runs the cryptography off the main thread; streams to disk
src/crypto/password.ts              strength meter and passphrases (loaded on demand)
src/crypto/bench.ts                 on-device benchmark
src/chain/stamp.ts                  wallet access, ABI encoding, stamp and look-up
src/tool/                           lock and unlock page
src/Landing.tsx                     landing page
src/Setup.tsx                       contract deployment page (#setup)
src/App.tsx                         routing for #lock, #unlock and #setup
src/ui/                             seal, hero, session list, theme, saving files
src/rb/                             React Bits components (see src/rb/README.md)
docs/                               design, measurements and a code walkthrough
```

More detail: [design and threat model](docs/DESIGN.md), [measurements and attack estimates](docs/BENCHMARKS.md), [code walkthrough](docs/WALKTHROUGH.md).

## Credits

- Interface components from [React Bits](https://reactbits.dev) by David Haz, under its MIT + Commons Clause licence. The components used and the local changes are listed in [src/rb/README.md](src/rb/README.md). The landing-page background needs WebGPU and is left out in browsers that don't support it.
- [EFF Large Wordlist](https://www.eff.org/dice) (CC BY 3.0 US).
- Libraries: [hash-wasm](https://github.com/Daninet/hash-wasm), [@noble/hashes](https://github.com/paulmillr/noble-hashes), [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn), [fflate](https://github.com/101arrowz/fflate), [GSAP](https://gsap.com), [Motion](https://motion.dev), [vgpu](https://github.com/vercel-labs/vgpu) and [Hugeicons](https://hugeicons.com).
- AES-GCM, HKDF, HMAC and SHA-256 come from the browser's Web Crypto API.

## License

[MIT](LICENSE). The React Bits components in `src/rb/` keep their own MIT + Commons Clause licence, and the EFF wordlist is CC BY 3.0 US.
