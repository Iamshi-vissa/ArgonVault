# Measurements

## How to measure

Open the site, scroll to **How your file is protected**, and choose **Measure this device**. It runs the app's own Argon2id, AES-256-GCM and SHA-256 code in the background worker and shows the results. **Copy results** puts them on the clipboard. Run it on each device you want in your report.

## Measured

Each row is the median of three runs.

| Device                                    | Browser           | Argon2id Standard (64 MiB, t 3) | Argon2id Hardened (256 MiB, t 4) | AES-256-GCM encrypt | AES-256-GCM decrypt | SHA-256  |
| ----------------------------------------- | ----------------- | ------------------------------- | -------------------------------- | ------------------- | ------------------- | -------- |
| Cloud VM, 2 vCPU Intel Xeon 2.1 GHz, 7 GB | Chrome (headless) | 0.34 s                          | 1.84 s                           | 680 MB/s            | 599 MB/s            | 219 MB/s |
| _Your laptop_                             |                   |                                 |                                  |                     |                     |          |
| _Your phone_                              |                   |                                 |                                  |                     |                     |          |

Notes:

- Argon2id here is the WebAssembly build (`hash-wasm`), single-threaded. Where WebAssembly is blocked, the pure-JavaScript fallback is several times slower.
- AES-GCM is the browser's native implementation (hardware AES instructions where available), measured on 64 × 1 MiB chunks.
- SHA-256 is the WebAssembly build, used for the blockchain fingerprint.
- Locking time ≈ one Argon2id run + file size ÷ AES speed + file size ÷ SHA-256 speed (both run in the same worker thread). A 100 MB file on the VM: about 0.34 + 0.15 + 0.46 ≈ 0.95 s.

## What an attacker can do

An attacker with the locked file tries passwords offline. Every guess costs one full Argon2id run, including its memory.

**Measured GPU rate for exactly the Standard setting.** A public hashcat benchmark on an NVIDIA L40S (48 GB) data-centre GPU lists Argon2id with m = 64 MiB, t = 3, p = 4 at **1,256 guesses per second**, against 17.2/s on an Intel Core i5-1135G7 laptop CPU. Source: hashcat benchmark comparison by mimi89999 (GitHub Gist "c4230180104de3de4c441953fee22ea3").

For comparison, an 8 × RTX 5090 rig computes about **221 billion SHA-256 hashes per second** (Specops Software, "Does Argon2 mean a password is uncrackable?"). That is about 27 billion per GPU, so a design that hashed the password once with SHA-256 would be on the order of ten million times easier to attack per GPU (different GPU models, so treat this as an order of magnitude).

**Time to find the password**, on average (half the search space), at 1,256 guesses/s per GPU:

| Password                                        | Guesses (average) | 1 GPU              | 1,000 GPUs        |
| ----------------------------------------------- | ----------------- | ------------------ | ----------------- |
| 8 random lowercase letters (26⁸)                | 1.0 × 10¹¹        | ≈ 2.6 years        | ≈ 23 hours        |
| zxcvbn "strong" minimum (≈ 10¹⁰ guesses)        | 5 × 10⁹           | ≈ 46 days          | ≈ 1.1 hours       |
| 4 EFF words (7,776⁴ ≈ 2⁵¹·⁷)                    | 1.8 × 10¹⁵        | ≈ 46,000 years     | ≈ 46 years        |
| 6 EFF words, the suggested passphrase (≈ 2⁷⁷·⁵) | 1.1 × 10²³        | ≈ 2.8 × 10¹² years | ≈ 2.8 × 10⁹ years |

Takeaways for the report:

1. Argon2id makes each guess around ten million times more expensive than a fast hash, but the **password is still the deciding factor**. The minimum "strong" rating holds off a single GPU for weeks, not forever; the suggested six-word passphrase is out of reach of any realistic attacker.
2. Hardened (256 MiB, t = 4) costs about 5× more per guess on the measured VM; on GPUs the gap is larger, because fewer guesses fit in GPU memory at once.
3. These figures assume the attacker already has the locked file. Without it, there is nothing to attack: nothing leaves the browser.
