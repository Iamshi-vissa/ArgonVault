# Code walkthrough

A guided tour of the security-relevant code, in the order data flows through it. For each file: what it does, the lines that matter, and the question an examiner is likely to ask.

## `src/crypto/format.ts`: the file format

The heart of the project. Pure functions, no UI, tested directly by `test/format.test.ts`.

- **`lock()`**
  1. Builds the 67-byte header: magic, version, Argon2 parameters, a fresh 16-byte salt, chunk size and a 7-byte nonce prefix.
  2. Derives the master key with Argon2id (`derive`), then two keys with HKDF (`deriveKeys`).
  3. Writes the key commitment, `HMAC(commit key, header[0..35))`, into the header.
  4. Encrypts the metadata (name, type) plus the file in 1 MiB chunks with AES-GCM. The nonce is `prefix ‖ counter ‖ lastFlag`, and the associated data is the whole header.
  5. Hashes everything it outputs with SHA-256 (`fileHash`, used for blockchain timestamps).
  6. Output goes to a `sink` (straight to disk) or into memory.
- **`unlock()`** is the mirror image:
  1. Reads and bounds-checks the header (`readHeader` refuses hostile Argon2 settings before any work).
  2. Derives the keys and verifies the commitment. A failure here means a wrong password.
  3. Decrypts each chunk. Any GCM failure means the file was tampered with.
  4. Parses the metadata from chunk 0 (`parseMeta`).
- **`nonce()`**: why can't nonces repeat? Every file has its own salt, so its own key, and within a file the counter is unique.
- **`sanitizeName()`**: a restored name can never contain a path (`../../etc/passwd` becomes `_.._etc_passwd`).
- **`truncateName()` / `fitUtf8()`**: names are capped at 255 bytes without cutting a UTF-8 character in half.

**Likely question:** _What stops someone deleting the last chunk?_ The last chunk is encrypted with the last-flag byte set to 1. If it's removed, the new final chunk was encrypted with flag 0 but is decrypted with flag 1, so GCM rejects it.

## `src/crypto/kdf.ts`: Argon2id

- Uses `hash-wasm` (WebAssembly) when the page may run WebAssembly (`wasm.ts` checks by compiling an empty module), and otherwise `@noble/hashes` (pure JavaScript). Both give identical output; the test `hash-wasm and @noble/hashes produce the same key` proves it.
- It does **not** silently retry on the slow engine after an out-of-memory error. That would freeze the tab.

**Likely question:** _Why Argon2id and not PBKDF2?_ PBKDF2 costs time but no memory, so GPUs run millions of guesses in parallel. Argon2id needs 64 MiB per guess, which caps parallelism; see `docs/BENCHMARKS.md` for the numbers.

## `src/crypto/hash.ts`: SHA-256 fingerprint

Incremental SHA-256 (WebAssembly when allowed). Only used for the blockchain fingerprint; integrity of the file itself comes from GCM.

## `src/crypto/worker.ts`: the background worker

All of the above runs here, not on the page's main thread.

- Receives a request, calls `lock` or `unlock`, and posts back progress and the result.
- **`diskSink()`**: when the user picked a save location (large files), writes stream to `FileSystemWritableFileStream`. That writes to a temporary file which only replaces the target on `close()`. On any error, `abort()` discards it, so a tampered file leaves nothing on disk.
- **`fail()`**: turns errors into user-facing codes (`wrong-password`, `tampered`, `memory`, `disk`, …).

## `src/crypto/password.ts`: strength and passphrases

- zxcvbn estimates how many guesses a password would take. Locking needs a score of at least 3 ("strong").
- `passphrase()` picks six words from the EFF list using `crypto.getRandomValues` with **rejection sampling** (`randomIndex`), so every word is exactly equally likely: log₂(7776⁶) ≈ 77.5 bits.

**Likely question:** _Why not `Math.random()`, or `% 7776`?_ `Math.random` isn't cryptographically secure, and taking a 32-bit value modulo 7776 slightly favours the first words. Rejection sampling removes that bias.

## `src/tool/useCryptoJob.ts`: the job state machine

`idle → working → done | failed`, with a ticket per job. Progress and results carry their ticket, and the reducer ignores any that don't match. So a result from a job the user abandoned can't appear on screen. `test/job.test.ts` checks every transition.

## `contracts/ArgonVaultTimestamps.sol`: the smart contract

- `stamp(bytes32 fileHash)` stores `{time, blockNumber, by}` the first time a hash is seen and emits `Stamped`. It reverts with `AlreadyStamped` after that, so the earliest time stands.
- `stampOf(bytes32)` reads it back.
- Existence is tested with `by != address(0)`, since `msg.sender` is never zero.

**Likely question:** _Can someone steal your timestamp?_ They can stamp the same hash first if they see it, for example by copying the transaction from the mempool (front-running). But the time is still a true lower bound on when the file existed. The contract makes no ownership claim.

## `src/chain/stamp.ts`: talking to the chain

- Hand-written ABI encoding: the function selector is the first 4 bytes of `keccak256("stamp(bytes32)")`, followed by the 32-byte argument. `test/contract.test.ts` runs these exact encoders against the compiled contract in an in-process EVM.
- Uses only the user's wallet (`window.ethereum`, EIP-1193): `eth_requestAccounts`, `wallet_switchEthereumChain` (Sepolia, chain ID `0xaa36a7`), `eth_call` to read, `eth_sendTransaction` to stamp, `eth_getTransactionReceipt` to wait.
- Before sending, it checks for an earlier stamp, so it never pays to send a transaction that would revert.

## How to check you understand it

Without notes, explain:

1. What's in the 67-byte header, and why each field is there.
2. Why HKDF derives two keys instead of using the Argon2 output directly.
3. What key commitment prevents.
4. How truncation, reordering and splicing are each detected.
5. What a blockchain timestamp proves, and what it doesn't.
6. Why the page's security policy blocks all network connections, and how timestamps still work.
