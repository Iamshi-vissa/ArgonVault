# ArgonVault: design and threat model

This document explains what ArgonVault protects, against whom, how, and why each design choice was made. The file format itself is specified in the [README](../README.md#file-format-v1).

## 1. Goal

Let a person lock a file or note with a password so that someone who later obtains the locked file learns nothing about it, cannot change it undetected, and cannot open it without the password. Everything happens in the browser; nothing is uploaded.

Optionally, prove _when_ a locked file existed by recording its fingerprint on a public blockchain.

## 2. Threat model

### Assets

- The contents of the file or note.
- The original file name and type.
- The password.

### Adversaries considered

| Adversary                 | Has                                                       | Wants                     | Defence                                                                                      |
| ------------------------- | --------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Offline attacker          | The locked file (stolen laptop, leaked cloud folder, USB) | Contents                  | AES-256-GCM; password stretched with Argon2id so each guess costs 64–256 MiB of memory       |
| Tamperer                  | The locked file, and a way to hand it back                | Undetected changes        | Every chunk authenticated; numbered and last-flagged nonces; header bound as associated data |
| Partition-oracle attacker | Can submit crafted files to someone and watch the result  | Learn the password faster | Key commitment (HMAC) checked before any decryption                                          |
| Malicious file            | A crafted header                                          | Exhaust memory or CPU     | Argon2 parameters and chunk size bounded before any work                                     |
| Network observer / server | The site's traffic                                        | Contents or password      | Nothing is sent: `connect-src 'none'` in the Content Security Policy                         |
| Blockchain observer       | The public chain                                          | Anything about the file   | Only SHA-256 of the _encrypted_ file is recorded                                             |

### Out of scope (stated limits)

- **Weak passwords.** Argon2id multiplies the cost of guessing; it cannot make a guessable password safe. The app refuses passwords zxcvbn rates below "strong" and offers six-word EFF passphrases (≈77.5 bits).
- **A compromised device.** Malware, a malicious browser extension or a screen recorder sees what the user sees.
- **File size.** The locked file is the original size plus 67 bytes, plus 16 bytes per MiB, plus the name. Padding is not used.
- **Memory hygiene.** JavaScript has garbage collection and immutable strings, so secrets can't be reliably wiped. The app zeroes buffers it owns and keeps derived keys non-extractable inside Web Crypto.
- **Authorship.** A blockchain timestamp proves _when_ a locked file existed, not _who_ made it (see §6).

## 3. Key derivation

```
password ──NFC──▶ Argon2id(salt 16 B, m, t, p) ──▶ master (32 B)
master ──HKDF-SHA256 info="argonvault/v1/enc"────▶ AES-256-GCM key (non-extractable)
master ──HKDF-SHA256 info="argonvault/v1/commit"─▶ HMAC-SHA256 key (non-extractable)
```

- **Argon2id** won the Password Hashing Competition and is specified in RFC 9106. It is memory-hard: a GPU can't run many guesses at once because each one needs the full memory. Standard is RFC 9106 §4's second recommended option (64 MiB, t = 3, p = 4); Hardened is 256 MiB, t = 4. See [BENCHMARKS.md](BENCHMARKS.md) for what that costs an attacker.
- **A fresh 16-byte random salt per file** means the same password never produces the same key twice, and precomputed tables are useless.
- **HKDF key separation** (RFC 5869): the Argon2 output is never used directly; two independent keys are derived for two jobs.
- **Unicode NFC** makes "é" typed as one or two code points give the same key.

## 4. Encryption

- **AES-256-GCM** (NIST SP 800-38D) in 1 MiB chunks, via the browser's Web Crypto API (constant-time, hardware-accelerated).
- **Nonce** for chunk _i_ = 7-byte random prefix ‖ _i_ as a 32-bit counter ‖ 1-byte last-chunk flag. The key is unique per file (fresh salt), so a nonce can never repeat under the same key; GCM nonce reuse would be catastrophic.
- **Associated data** for every chunk is the full 67-byte header, so changing any header field (including the Argon2 cost) breaks every chunk.
- **Why chunks?** Large files never need to be decrypted in one piece, and output can stream straight to disk. This is the STREAM construction of Hoang, Reyhanitabar, Rogaway and Vizár (2015): the counter stops reordering, the last-chunk flag stops truncation and appending.
- **The name and type are encrypted** at the start of the first chunk.

## 5. Key commitment

AES-GCM is not _key-committing_: one ciphertext can be crafted to decrypt validly under two different keys. Len, Grubbs and Ristenpart (USENIX Security 2021) showed this enables _partitioning oracle_ attacks that test many passwords per query. ArgonVault stores `HMAC-SHA256(commit key, header[0..35))` in the header and checks it (constant-time, via Web Crypto `verify`) before decrypting anything. This also lets the app say "wrong password" with certainty, distinct from "damaged file".

The **seal** shown in the app is the first 64 bits of this commitment, drawn as a guilloché pattern. It identifies a file + password pair for a human; integrity itself comes from GCM.

## 6. Blockchain timestamps

- **What's recorded:** the SHA-256 of the whole locked file, by the `ArgonVaultTimestamps` contract (`contracts/`) on Ethereum's Sepolia test network. The encrypted file is indistinguishable from random, so its hash reveals nothing.
- **What it proves:** the locked file existed no later than the block's timestamp. Because the locked file contains a random salt and nonces, it also can't have been predicted earlier.
- **First stamp wins:** `stamp()` reverts with `AlreadyStamped` if the hash is known, so nobody can overwrite an earlier time.
- **What it doesn't prove:** who made the file. Anyone holding the locked file can stamp it, and a stamp transaction can be copied from the public mempool and front-run. The contract records `msg.sender` but it carries no ownership meaning.
- **Privacy of the page:** the app never connects to an Ethereum node itself. It uses the user's wallet (`window.ethereum`), which does its own networking and asks the user to approve every transaction.
- **Why a test network:** it's free, and this is a course project. Moving to mainnet or an L2 is a change of chain ID and contract address.

## 7. Implementation choices

- **No home-made cryptography.** AES-GCM, HKDF, HMAC and SHA-256 come from Web Crypto or audited libraries (`hash-wasm`, `@noble/hashes`); Argon2id output is checked against the reference C implementation in the tests.
- **A Web Worker** runs all cryptography off the main thread, so the page stays responsive and secrets never touch the UI code more than needed.
- **Streaming to disk.** Where the browser supports the File System Access API, files over 200 MB are written straight to a file the user picks. Writes go to a temporary file that only replaces the target when it's closed, so a wrong password or tampered chunk leaves nothing behind. Elsewhere, files are held in memory and limited to 1 GB (512 MB on devices reporting ≤ 4 GB RAM).
- **One job at a time, as a state machine** (`src/tool/useCryptoJob.ts`). Results from a job the user has moved on from are ignored by construction.
- **Strict Content Security Policy** on the deployed site: no inline scripts, no network connections, no framing.

## 8. Testing

- **Unit tests (Vitest):** round trips at chunk boundaries; every tampering case (bit flips, truncation, appending, reordering, cross-file splicing, hostile headers); Unicode passwords; long multi-byte names; streaming; the job state machine; Argon2 known answer.
- **Contract tests:** the compiled contract runs in an in-process EVM (EthereumJS), driven by the same ABI encoder the app uses.
- **End-to-end tests (Playwright):** the production build in a real browser: lock/unlock, wrong password, tampering, notes, streaming to disk, navigation, blockchain flow with a mock wallet, and the benchmark.

## References

- RFC 9106, _Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications_, 2021.
- RFC 5869, _HMAC-based Extract-and-Expand Key Derivation Function (HKDF)_, 2010.
- NIST SP 800-38D, _Recommendation for Block Cipher Modes of Operation: GCM and GMAC_, 2007.
- V. T. Hoang, R. Reyhanitabar, P. Rogaway, D. Vizár, _Online Authenticated-Encryption and its Nonce-Reuse Misuse-Resistance_, CRYPTO 2015.
- J. Len, P. Grubbs, T. Ristenpart, _Partitioning Oracle Attacks_, USENIX Security 2021.
- D. L. Wheeler, _zxcvbn: Low-Budget Password Strength Estimation_, USENIX Security 2016.
