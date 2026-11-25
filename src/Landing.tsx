import AnimatedContent from './rb/AnimatedContent';
import Hero from './ui/Hero';

const LOCK_STEPS = [
  ['Pick what to lock', 'Choose Lock, then drop in a file or write a short note.'],
  [
    'Set a passphrase',
    'Type your own, or let ArgonVault suggest six random words. Write it down: it can’t be recovered.'
  ],
  ['Hold to lock', 'Hold the button until it fills. Your password is stretched, then the file is encrypted.'],
  ['Save it and note the seal', 'Save the .argonvault file. The seal code under the pattern identifies this file and password.']
];

const OPEN_STEPS = [
  ['Pick the locked file', 'Choose Unlock, then drop in the .argonvault file, or paste locked text.'],
  ['Enter the password', 'A wrong password is reported straight away, before anything is decrypted.'],
  ['Check the seal', 'The seal code should match the one you saw when it was locked.'],
  ['Save the original', 'You get the file back with its original name. A changed or damaged file won’t open at all.']
];

const DETAILS = [
  [
    'Password stretching',
    'Argon2id with 64 MiB of memory and 3 passes, a setting RFC 9106 recommends, or 256 MiB when hardened. Every guess costs an attacker that much work, so long passphrases stay out of reach.'
  ],
  [
    'Encryption',
    'AES-256-GCM in 1 MiB chunks, with a key derived from your password through HKDF-SHA256. Each file gets a fresh random salt, so the same file never locks the same way twice.'
  ],
  [
    'Tamper evidence',
    'Each chunk is authenticated and numbered, and the last one is marked. A changed byte, a cut-off end or reordered chunks stop the file from opening.'
  ],
  [
    'Password check',
    'A key commitment (HMAC-SHA256) lets ArgonVault tell a wrong password apart from a damaged file, and ties the file to one key.'
  ],
  ['Hidden details', 'The original file name and type are encrypted along with the contents.'],
  [
    'Nothing leaves this tab',
    'All of it runs in your browser, in a background worker. The page is set up to block every network connection, so files and passwords can’t be sent anywhere.'
  ]
];

const LIMITS = [
  'A weak password. Argon2id slows guessing down, but it can’t save “password123”, which is why ArgonVault asks for a strong one.',
  'Malware or a malicious browser extension on this device while you type.',
  'Someone watching your screen, or a lost password. There’s no recovery.',
  'The size of the file. The locked file is about the same size as the original.'
];

export default function Landing() {
  return (
    <div className="page landing">
      <Hero>
        <nav className="hero-nav" aria-label="On this page">
          <a href="#about">About</a>
          <a href="#how">How to use</a>
          <a href="#details">Details</a>
        </nav>
        <p className="lede big">
          Lock files and notes with a password. Everything happens on this device: nothing is uploaded and there’s no
          account.
        </p>
        <div className="choices">
          <a className="choice lock" href="#lock">
            <span className="choice-title">Lock</span>
            <span className="choice-text">Encrypt a file or note before you store or send it.</span>
          </a>
          <a className="choice unlock" href="#unlock">
            <span className="choice-title">Unlock</span>
            <span className="choice-text">Open a locked file with its password and get the original back.</span>
          </a>
        </div>
      </Hero>

      <main>
        <section id="about" className="band about" aria-labelledby="about-title">
          <AnimatedContent trigger="scroll" distance={30} duration={0.8} threshold={0.12}>
            <h2 id="about-title">About ArgonVault</h2>
            <div className="about-cols">
              <p>
                ArgonVault turns any file, or a short note, into a locked file that only your password can open. It’s
                for things you want to keep somewhere you don’t fully trust: a cloud drive, a USB stick, an email
                attachment.
              </p>
              <p>
                It uses the methods security engineers rely on. Argon2id makes every password guess slow and
                memory-hungry, AES-256-GCM encrypts the file, and any change to the locked file, even one bit, is caught
                before anything is saved.
              </p>
            </div>
          </AnimatedContent>
        </section>

        <section id="how" className="band how" aria-labelledby="how-title">
          <AnimatedContent trigger="scroll" distance={30} duration={0.8} threshold={0.12}>
            <h2 id="how-title">How to use it</h2>
            <div className="how-cols">
              {[
                ['To lock something', LOCK_STEPS, '#lock', 'Start locking'],
                ['To open something locked', OPEN_STEPS, '#unlock', 'Start unlocking']
              ].map(([title, steps, href, cta]) => (
                <div className="how-col" key={title as string}>
                  <h3>{title as string}</h3>
                  <ol className="steps">
                    {(steps as string[][]).map(([h, t]) => (
                      <li key={h}>
                        <strong>{h}</strong>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ol>
                  <a className="secondary as-button" href={href as string}>
                    {cta as string}
                  </a>
                </div>
              ))}
            </div>
          </AnimatedContent>
        </section>

        <section id="details" className="band details" aria-labelledby="details-title">
          <AnimatedContent trigger="scroll" distance={30} duration={0.8} threshold={0.12}>
            <h2 id="details-title">How your file is protected</h2>
            <dl className="spec-grid">
              {DETAILS.map(([t, d]) => (
                <div key={t}>
                  <dt>{t}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
            <div className="limits">
              <h3>What it can’t protect against</h3>
              <ul>
                {LIMITS.map(l => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          </AnimatedContent>
        </section>
      </main>

      <footer className="foot">
        <p>ArgonVault runs entirely in your browser.</p>
        <a className="link" href="https://github.com/Iamshi-vissa/ArgonVault">
          Source code on GitHub
        </a>
      </footer>
    </div>
  );
}
