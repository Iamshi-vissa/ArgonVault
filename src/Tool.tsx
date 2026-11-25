import { useEffect, useMemo, useRef, useState } from 'react';
import RubberSegment from './rb/RubberSegment';
import HoldButton from './rb/HoldButton';
import StatusMark from './rb/StatusMark';
import DecryptedText from './rb/DecryptedText';
import Seal, { type SealState } from './ui/Seal';
import { run } from './crypto/client';
import { HARDENED, sealCode, STANDARD, type KdfParams } from './crypto/format';
import { MIN_SCORE, passphrase, PASSPHRASE_BITS, strength } from './crypto/password';
import { lockedName, restoredFile, sandboxed, saveFile } from './ui/save';
import AnimatedContent from './rb/AnimatedContent';
import Session, { type SessionEntry } from './ui/Session';
import { useTheme } from './ui/useTheme';
import type { SessionStore } from './ui/useSession';

export type Mode = 'lock' | 'unlock';
type Kind = 'file' | 'note';
type Job =
  | { status: 'idle' }
  | { status: 'working'; phase: 'kdf' | 'crypt'; fraction: number }
  | { status: 'failed'; code: string; message: string }
  | { status: 'done' };

export type Result =
  | { mode: 'lock'; seal: Uint8Array; name: string; blob?: Blob; text?: string; kind: Kind }
  | { mode: 'unlock'; seal: Uint8Array; name: string; type: string; blob?: Blob; note?: string; params: KdfParams };

const MAX_SIZE = 2 * 1024 ** 3;

const ERRORS: Record<string, string> = {
  'wrong-password': 'That password doesn’t open this file. Check it for typos and try again.',
  tampered: 'This file was changed or damaged after it was locked, so ArgonVault won’t open it. Nothing was saved.',
  'not-locker': 'This isn’t an ArgonVault file or locked text.'
};

function size(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 2);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

const mib = (p: KdfParams) => `${p.m / 1024} MiB`;

export default function Tool({
  mode,
  onMode,
  session
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  session: SessionStore<Result>;
}) {
  const [kind, setKind] = useState<Kind>('file');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [pasted, setPasted] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [preset, setPreset] = useState<'standard' | 'hardened'>('standard');
  const [job, setJob] = useState<Job>({ status: 'idle' });
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLElement>(null);
  const theme = useTheme();
  const reopening = useRef(false);

  function remember(r: Result, what: Kind, size: number) {
    session.add(
      { action: r.mode === 'lock' ? 'locked' : 'unlocked', what, name: r.name || 'note', size, seal: sealCode(r.seal) },
      r.mode === 'lock' ? r : undefined
    );
  }

  function reopen(e: SessionEntry) {
    const r = session.get(e.id);
    if (!r || busy) return;
    if (mode !== 'lock') {
      reopening.current = true;
      onMode('lock');
    }
    setKind(e.what);
    setResult(r);
    setNotice('');
    setJob({ status: 'done' });
    docRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const params = preset === 'hardened' ? HARDENED : STANDARD;
  const busy = job.status === 'working';
  const st = useMemo(() => (mode === 'lock' ? strength(pw) : null), [pw, mode]);
  const matches = pw.length > 0 && pw === pw2;
  const hasInput = mode === 'lock' ? (kind === 'file' ? !!file : note.trim().length > 0) : kind === 'file' ? !!file : pasted.trim().length > 0;
  const tooBig = !!file && file.size > MAX_SIZE;
  const canLock = hasInput && !tooBig && !!st && st.score >= MIN_SCORE && matches && !busy;
  const canUnlock = hasInput && pw.length > 0 && !busy;

  const reset = (keepMode = true) => {
    setFile(null);
    setNote('');
    setPasted('');
    setPw('');
    setPw2('');
    setShow(false);
    setSuggested(false);
    setJob({ status: 'idle' });
    setResult(null);
    setNotice('');
    if (!keepMode) setKind('file');
  };

  const switchMode = (m: string) => {
    if (busy) return;
    onMode(m as Mode);
  };

  // A new mode (from the switch or the address) starts with a clean form.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    if (reopening.current) {
      reopening.current = false;
      return;
    }
    reset(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const progress = (phase: 'kdf' | 'crypt', fraction: number) => setJob({ status: 'working', phase, fraction });

  async function doLock() {
    if (!canLock) return;
    setNotice('');
    setJob({ status: 'working', phase: 'kdf', fraction: 0 });
    const armored = sandboxed();
    const r =
      kind === 'file'
        ? await run({ op: 'lock', data: file!, name: file!.name, type: file!.type, password: pw, params, armored }, progress)
        : await run({ op: 'lockNote', text: note, password: pw, params }, progress);
    if (r.kind === 'error') return setJob({ status: 'failed', code: r.code, message: r.message });
    if (r.kind !== 'locked') return;
    setPw('');
    setPw2('');
    setNote('');
    const locked: Result = { mode: 'lock', seal: r.seal, name: kind === 'file' ? file!.name : '', blob: r.blob, text: r.text, kind };
    setResult(locked);
    remember(locked, kind, r.blob?.size ?? r.text?.length ?? 0);
    setJob({ status: 'done' });
  }

  async function doUnlock() {
    if (!canUnlock) return;
    setNotice('');
    setJob({ status: 'working', phase: 'kdf', fraction: 0 });
    const data = kind === 'file' ? file! : new Blob([pasted], { type: 'text/plain' });
    const r = await run({ op: 'unlock', data, password: pw }, progress);
    if (r.kind === 'error') {
      setJob({ status: 'failed', code: r.code, message: ERRORS[r.code] ?? r.message });
      if (r.code === 'wrong-password') setTimeout(() => pwRef.current?.select(), 0);
      return;
    }
    if (r.kind !== 'unlocked') return;
    setPw('');
    const opened: Result = { mode: 'unlock', seal: r.seal, name: r.name, type: r.type, blob: r.blob, note: r.note, params: r.params };
    setResult(opened);
    remember(opened, r.note !== undefined ? 'note' : 'file', r.blob?.size ?? new TextEncoder().encode(r.note ?? '').length);
    setJob({ status: 'done' });
  }

  async function save() {
    if (!result) return;
    let outcome;
    if (result.mode === 'lock') {
      const name = lockedName(result.kind === 'file' ? result.name : 'note', !!result.text);
      outcome = await saveFile(name, result.text ?? result.blob!);
    } else {
      const f = await restoredFile(result.name, result.blob!);
      outcome = await saveFile(f.filename, f.data);
    }
    setNotice(
      outcome === 'saved' ? 'Saved to your downloads.' : outcome === 'declined' ? 'Not saved. Choose Save again when you’re ready.' : 'Saving isn’t available here. Open the app in a browser to save files.'
    );
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied. Paste it anywhere; only the password opens it.');
    } catch {
      setNotice('Copy isn’t allowed here. Select the text and copy it yourself.');
    }
  }

  function suggest() {
    const p = passphrase();
    setPw(p);
    setPw2(p);
    setShow(true);
    setSuggested(true);
  }

  function pick(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setJob({ status: 'idle' });
    setResult(null);
  }

  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const sealState: SealState = job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : busy ? 'working' : 'idle';
  const code = result ? sealCode(result.seal) : '';

  const statusText = (() => {
    if (job.status === 'working') {
      if (job.phase === 'kdf')
        return mode === 'lock'
          ? `Stretching your password with Argon2id, ${mib(params)}`
          : 'Checking the password';
      return `${mode === 'lock' ? 'Encrypting' : 'Decrypting'}, ${Math.round(job.fraction * 100)}%`;
    }
    if (job.status === 'failed') return mode === 'lock' ? 'Not locked' : 'Not opened';
    if (job.status === 'done') return mode === 'lock' ? 'Locked' : 'Unlocked';
    return '';
  })();

  const meter = st ? Math.max(1, st.score) : 0;

  return (
    <div className="page">
      <header className="bar">
        <div className="bar-inner">
          <a className="brand-link" href="#" aria-label="ArgonVault home">
            ArgonVault
          </a>
          <RubberSegment
            aria-label="Choose lock or unlock"
            items={[
              { value: 'lock', label: 'Lock' },
              { value: 'unlock', label: 'Unlock' }
            ]}
            value={mode}
            onChange={switchMode}
            size="md"
            disabled={busy}
            trackColor="var(--well)"
            thumbColor="var(--ink)"
            textColor="var(--muted)"
            activeTextColor="var(--bg)"
            radius={999}
            className="modes"
          />
        </div>
      </header>

      <main className="band">
        <AnimatedContent trigger="mount" distance={24} duration={0.7} delay={0.05} blur={4}>
        <section className="doc" aria-labelledby="doc-title" ref={docRef}>
          <div className="seal-col">
            <Seal seed={result?.seal ?? null} state={sealState} code={code} />
            <div className="seal-meta" aria-live="polite">
              {result ? (
                <>
                  <p className="seal-code">
                    <DecryptedText text={code} animateOn="view" speed={45} maxIterations={14} sequential revealDirection="start" characters="0123456789ABCDEF" />
                  </p>
                  <p className="hint">
                    {result.mode === 'lock'
                      ? 'This seal belongs to this file and password. The same seal appears when the right password opens it.'
                      : 'This is the file’s seal. It should match the one shown when the file was locked.'}
                  </p>
                </>
              ) : (
                <p className="hint">
                  {mode === 'lock'
                    ? 'Every locked file gets its own seal, drawn from its key.'
                    : 'When the right password opens a file, its seal is drawn here.'}
                </p>
              )}
            </div>
          </div>

          <div className="form-col">
            <h2 id="doc-title">{mode === 'lock' ? 'Lock something' : 'Open something locked'}</h2>

            {job.status === 'done' && result ? (
              <Outcome
                result={result}
                onSave={save}
                onCopy={copy}
                onReset={() => reset()}
                notice={notice}
              />
            ) : (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  if (mode === 'unlock') doUnlock();
                }}
                className="form"
              >
                <RubberSegment
                  aria-label={mode === 'lock' ? 'What to lock' : 'What to open'}
                  items={
                    mode === 'lock'
                      ? [
                          { value: 'file', label: 'A file' },
                          { value: 'note', label: 'A note' }
                        ]
                      : [
                          { value: 'file', label: 'A locked file' },
                          { value: 'note', label: 'Pasted text' }
                        ]
                  }
                  value={kind}
                  onChange={v => !busy && setKind(v as Kind)}
                  size="md"
                  disabled={busy}
                  trackColor="var(--well)"
                  thumbColor="var(--panel-hi)"
                  textColor="var(--muted)"
                  activeTextColor="var(--ink)"
                  radius={999}
                />

                {kind === 'file' ? (
                  <label
                    className={`drop${drag ? ' over' : ''}${file ? ' has' : ''}`}
                    onDragEnter={() => setDrag(true)}
                    onDragLeave={() => setDrag(false)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      setDrag(false);
                      pick(e.dataTransfer.files?.[0]);
                    }}
                  >
                    <input
                      type="file"
                      disabled={busy}
                      onChange={e => pick(e.target.files?.[0])}
                      accept={mode === 'unlock' ? '.argonvault,.txt,application/octet-stream,text/plain' : undefined}
                    />
                    {file ? (
                      <span className="file">
                        <span className="fname">{file.name}</span>
                        <span className="fsize">{size(file.size)}</span>
                        <span className="change">Choose a different file</span>
                      </span>
                    ) : (
                      <span className="empty">
                        <span className="big">{mode === 'lock' ? 'Drop a file to lock' : 'Drop a .argonvault file'}</span>
                        <span>or choose one from this device</span>
                      </span>
                    )}
                  </label>
                ) : mode === 'lock' ? (
                  <label className="field">
                    <span className="lbl">Note</span>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      rows={5}
                      disabled={busy}
                      placeholder="Wi-Fi passwords, a recovery code, a letter…"
                    />
                  </label>
                ) : (
                  <label className="field">
                    <span className="lbl">Locked text</span>
                    <textarea
                      value={pasted}
                      onChange={e => setPasted(e.target.value)}
                      rows={5}
                      disabled={busy}
                      className="mono"
                      spellCheck={false}
                      placeholder="-----BEGIN ARGONVAULT LOCKED NOTE-----"
                    />
                  </label>
                )}
                {tooBig && <p className="warn">Files over 2 GB are too large to lock in a browser.</p>}

                <div className="field">
                  <div className="lbl-row">
                    <label className="lbl" htmlFor="pw">
                      Password
                    </label>
                    {mode === 'lock' && (
                      <button type="button" className="link" onClick={suggest} disabled={busy}>
                        Suggest a passphrase
                      </button>
                    )}
                  </div>
                  <div className="pw">
                    <input
                      id="pw"
                      ref={pwRef}
                      type={show ? 'text' : 'password'}
                      value={pw}
                      onChange={e => {
                        setPw(e.target.value);
                        setSuggested(false);
                        if (job.status === 'failed') setJob({ status: 'idle' });
                      }}
                      autoComplete={mode === 'lock' ? 'new-password' : 'current-password'}
                      spellCheck={false}
                      disabled={busy}
                    />
                    <button type="button" className="peek" onClick={() => setShow(s => !s)} aria-pressed={show}>
                      {show ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {mode === 'lock' && (
                    <div className="meter" aria-live="polite">
                      <div className={`bars s${st?.score ?? 0}`} aria-hidden="true">
                        {[1, 2, 3, 4].map(i => (
                          <i key={i} className={i <= meter ? 'on' : ''} />
                        ))}
                      </div>
                      <p>
                        {suggested
                          ? `Six random words, about ${PASSPHRASE_BITS()} bits. Write it down: a lost password can’t be recovered.`
                          : st
                            ? `${st.label}. ${st.detail}`
                            : 'Use a long passphrase. ArgonVault asks for one rated strong or better.'}
                      </p>
                    </div>
                  )}
                </div>

                {mode === 'lock' && (
                  <label className="field">
                    <span className="lbl">Type it again</span>
                    <input
                      type={show ? 'text' : 'password'}
                      value={pw2}
                      onChange={e => setPw2(e.target.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                      disabled={busy}
                      aria-invalid={pw2.length > 0 && !matches}
                    />
                    {pw2.length > 0 && !matches && <span className="sub bad">Doesn’t match yet</span>}
                  </label>
                )}

                {mode === 'lock' && (
                  <div className="field">
                    <span className="lbl" id="cost-lbl">
                      Key strength
                    </span>
                    <RubberSegment
                      aria-label="Key strength"
                      items={[
                        { value: 'standard', label: 'Standard, 64 MiB' },
                        { value: 'hardened', label: 'Hardened, 256 MiB' }
                      ]}
                      value={preset}
                      onChange={v => setPreset(v as 'standard' | 'hardened')}
                      size="sm"
                      disabled={busy}
                      trackColor="var(--well)"
                      thumbColor="var(--panel-hi)"
                      textColor="var(--muted)"
                      activeTextColor="var(--ink)"
                      radius={999}
                    />
                    <span className="sub">
                      {preset === 'standard'
                        ? 'Each password guess costs an attacker 64 MiB of memory and 3 passes.'
                        : 'Four times the memory per guess. Takes a few seconds longer to lock and open.'}
                    </span>
                  </div>
                )}

                <div className="act">
                  {mode === 'lock' ? (
                    <HoldButton
                      onHold={doLock}
                      disabled={!canLock}
                      holdTime={1100}
                      resetAfter={600}
                      size="lg"
                      radius={999}
                      backgroundColor="var(--accent-dim)"
                      fillColor="var(--accent)"
                      textColor="var(--on-accent-dim)"
                      fillTextColor="var(--on-accent)"
                      doneLabel="Locking"
                      className="hold"
                    >
                      Hold to lock
                    </HoldButton>
                  ) : (
                    <button type="submit" className="primary" disabled={!canUnlock}>
                      Unlock
                    </button>
                  )}
                  {job.status !== 'idle' && (
                    <StatusMark strike={false} className="mark"
                      status={job.status === 'working' ? 'running' : job.status === 'failed' ? 'failed' : 'done'}
                      progress={job.status === 'working' && job.phase === 'crypt' ? job.fraction : undefined}
                      label={statusText}
                      color="var(--ink)"
                      doneColor="var(--gold)"
                      errorColor="var(--accent)"
                      size={22}
                      fontSize={15}
                    />
                  )}
                </div>
                {mode === 'lock' && !canLock && !busy && hasInput && (
                  <p className="sub">
                    {!st || st.score < MIN_SCORE
                      ? 'Choose a stronger password to lock.'
                      : !matches
                        ? 'Type the password again to confirm it.'
                        : ''}
                  </p>
                )}
                {job.status === 'failed' && (
                  <p className="err" role="alert">
                    {job.message}
                  </p>
                )}
              </form>
            )}
          </div>
        </section>

        </AnimatedContent>

        <div className="lower">
          <Session
            entries={session.entries}
            now={session.now}
            theme={theme}
            onSelect={reopen}
            onClear={session.clear}
          />
          <aside className="tips" aria-label="Before you start">
            <h2>Before you start</h2>
            <ul>
              <li>Write the password down somewhere safe. ArgonVault can’t recover it, and neither can anyone else.</li>
              <li>Note the seal code when you lock. When the file is opened, the same code proves it’s the same file and password.</li>
              <li>Keep a copy of important originals until you’ve checked the locked file opens.</li>
            </ul>
            <a className="link" href="#how">
              Read the full guide
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Outcome({
  result,
  onSave,
  onCopy,
  onReset,
  notice
}: {
  result: Result;
  onSave: () => void;
  onCopy: (t: string) => void;
  onReset: () => void;
  notice: string;
}) {
  const host = sandboxed();
  if (result.mode === 'lock') {
    return (
      <div className="outcome">
        <StatusMark strike={false} className="mark" status="done" label={result.kind === 'note' ? 'Note locked' : 'File locked'} doneColor="var(--gold)" color="var(--ink)" size={22} fontSize={15} />
        {result.kind === 'file' ? (
          <p className="out-file">
            <span className="fname">{lockedName(result.name, !!result.text)}</span>
            <span className="fsize">{size(result.blob?.size ?? result.text?.length ?? 0)}</span>
          </p>
        ) : (
          <pre className="armor" tabIndex={0} aria-label="Locked note">{result.text}</pre>
        )}
        <div className="row">
          {result.kind === 'note' && (
            <button type="button" className="primary" onClick={() => onCopy(result.text!)}>
              Copy locked text
            </button>
          )}
          <button type="button" className={result.kind === 'file' ? 'primary' : 'secondary'} onClick={onSave}>
            {result.kind === 'file' ? 'Save locked file' : 'Save as .txt'}
          </button>
          <button type="button" className="secondary" onClick={onReset}>
            Lock something else
          </button>
        </div>
        {notice && <p className="sub" role="status">{notice}</p>}
        {host && result.kind === 'file' && (
          <p className="sub">This preview saves locked files as text, so they open here or in the downloadable app.</p>
        )}
      </div>
    );
  }
  return (
    <div className="outcome">
      <StatusMark strike={false} className="mark" status="done" label={result.note !== undefined ? 'Note unlocked' : 'File unlocked'} doneColor="var(--gold)" color="var(--ink)" size={22} fontSize={15} />
      {result.note !== undefined ? (
        <div className="note-out" tabIndex={0} aria-label="Unlocked note">
          {result.note.length <= 400 ? (
            <DecryptedText text={result.note} animateOn="view" speed={28} maxIterations={8} sequential revealDirection="start" />
          ) : (
            result.note
          )}
        </div>
      ) : (
        <p className="out-file">
          <span className="fname">{result.name}</span>
          <span className="fsize">{size(result.blob!.size)}</span>
        </p>
      )}
      <p className="sub">
        Locked with Argon2id, {result.params.m / 1024} MiB and {result.params.t} passes. Every chunk passed its integrity
        check.
      </p>
      <div className="row">
        {result.note !== undefined ? (
          <button type="button" className="primary" onClick={() => onCopy(result.note!)}>
            Copy note
          </button>
        ) : (
          <button type="button" className="primary" onClick={onSave}>
            Save {result.name}
          </button>
        )}
        <button type="button" className="secondary" onClick={onReset}>
          Open another
        </button>
      </div>
      {notice && <p className="sub" role="status">{notice}</p>}
    </div>
  );
}
