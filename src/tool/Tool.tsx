import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import RubberSegment from '../rb/RubberSegment';
import HoldButton from '../rb/HoldButton';
import StatusMark from '../rb/StatusMark';
import DecryptedText from '../rb/DecryptedText';
import AnimatedContent from '../rb/AnimatedContent';
import Seal, { type SealState } from '../ui/Seal';
import Session, { type SessionEntry } from '../ui/Session';
import { useTheme } from '../ui/useTheme';
import type { SessionStore } from '../ui/useSession';
import { lockedName, restoredFile, sandboxed, saveFile } from '../ui/save';
import { run } from '../crypto/client';
import { HARDENED, sealCode, STANDARD, type KdfParams } from '../crypto/format';
import { useCryptoJob, type JobControls, type Outcome as JobOutcome } from './useCryptoJob';
import {
  canStream,
  formatSize,
  KEEP_LIMIT,
  originalNameGuess,
  pickSaveTarget,
  shouldStream,
  sizeLimit
} from './limits';
import DropZone from './DropZone';
import PasswordFields, { usePasswordTools, useStrength } from './PasswordFields';
import Outcome from './Outcome';
import type { Kind, Mode, Result } from './types';

export type { Mode, Result } from './types';

const ERRORS: Record<string, string> = {
  'wrong-password': 'That password doesn’t open this file. Check it for typos and try again.',
  tampered: 'This file was changed or damaged after it was locked, so ArgonVault won’t open it. Nothing was saved.',
  'not-locker': 'This isn’t an ArgonVault file or locked text.',
  memory: 'This device ran out of memory. Try Standard key strength, or a smaller file.'
};

const mib = (p: KdfParams) => `${p.m / 1024} MiB`;

export default function Tool({
  mode,
  onMode,
  onBack,
  session
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onBack: () => void;
  session: SessionStore<Result>;
}) {
  const theme = useTheme();
  const { state: job, start, reset: resetJob, show } = useCryptoJob<Result>();
  const [kind, setKind] = useState<Kind>('file');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [pasted, setPasted] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [preset, setPreset] = useState<'standard' | 'hardened'>('standard');
  const [notice, setNotice] = useState('');
  const [formKey, setFormKey] = useState(0);
  const pwRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLElement>(null);
  const tools = usePasswordTools(mode === 'lock');
  const strength = useStrength(mode === 'lock' ? tools : null, pw);

  const params = preset === 'hardened' ? HARDENED : STANDARD;
  const busy = job.status === 'working';
  const result = job.status === 'done' ? job.result : null;
  const matches = pw.length > 0 && pw === pw2;
  const hasInput = kind === 'file' ? !!file : mode === 'lock' ? note.trim().length > 0 : pasted.trim().length > 0;
  const limit = sizeLimit();
  const tooBig = kind === 'file' && !!file && file.size > limit;
  const strong = !!strength && strength.score >= (tools?.MIN_SCORE ?? 3);
  const canLock = hasInput && !tooBig && strong && matches && !busy;
  const canUnlock = hasInput && !tooBig && pw.length > 0 && !busy;

  function clearForm(keepKind = true) {
    setFile(null);
    setNote('');
    setPasted('');
    setPw('');
    setPw2('');
    setNotice('');
    setFormKey(k => k + 1);
    if (!keepKind) setKind('file');
  }

  function resetAll(keepKind = true) {
    resetJob();
    clearForm(keepKind);
  }

  // A new mode (from the switch, the address, or Back/Forward) starts with a clean form,
  // except when the session list asked to show a locked item.
  const reopening = useRef(false);
  const shownMode = useRef(mode);
  const resetRef = useRef(resetAll);
  useLayoutEffect(() => {
    resetRef.current = resetAll;
  });
  useEffect(() => {
    if (shownMode.current === mode) return; // first render, or no change
    shownMode.current = mode;
    if (reopening.current) {
      reopening.current = false;
      return;
    }
    resetRef.current(false);
  }, [mode]);

  function remember(r: Result) {
    const keep = r.mode === 'lock' && !r.savedAs && r.size <= KEEP_LIMIT ? r : undefined;
    session.add(
      {
        action: r.mode === 'lock' ? 'locked' : 'unlocked',
        what: r.mode === 'lock' ? r.kind : r.note !== undefined ? 'note' : 'file',
        name: r.name || 'note',
        size: r.size,
        seal: sealCode(r.seal),
        kept: !!keep
      },
      keep
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
    setNotice('');
    show(r);
    docRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const failed = (r: { code: string; message: string }): JobOutcome<Result> => ({
    ok: false,
    code: r.code,
    message: ERRORS[r.code] ?? r.message
  });

  async function doLock() {
    if (!canLock) return;
    setNotice('');
    const what = kind;
    const source = file;
    const name = what === 'file' && source ? source.name : '';

    // Large files go straight to disk, so ask where before starting (this needs the hold gesture).
    let target: FileSystemFileHandle | undefined;
    if (what === 'file' && source && shouldStream(source.size)) {
      const picked = await pickSaveTarget(lockedName(name, false));
      if (typeof picked === 'string') {
        setNotice(
          picked === 'cancelled'
            ? 'Choose where to save the locked file to lock a large file.'
            : 'The browser didn’t open the save dialog. Try holding the button again.'
        );
        return;
      }
      target = picked;
    }

    await start(async (jc: JobControls) => {
      const r =
        what === 'file' && source
          ? await run(
              { op: 'lock', data: source, name, type: source.type, password: pw, params, armored: sandboxed(), target },
              jc.progress
            )
          : await run({ op: 'lockNote', text: note, password: pw, params }, jc.progress);
      if (r.kind === 'error') return failed(r);
      if (r.kind !== 'locked') return failed({ code: 'internal', message: 'Unexpected reply.' });
      const locked: Result = {
        mode: 'lock',
        kind: what,
        name,
        seal: r.seal,
        fileHash: r.fileHash,
        size: r.size,
        blob: r.blob,
        text: r.text,
        savedAs: r.streamed ? target?.name : undefined
      };
      // Kept in the session list even if the user has moved on, so the work isn't lost.
      remember(locked);
      if (jc.current()) {
        setPw('');
        setPw2('');
        setNote('');
      }
      return { ok: true, result: locked };
    });
  }

  async function doUnlock() {
    if (!canUnlock) return;
    setNotice('');
    const data = kind === 'file' && file ? file : new Blob([pasted], { type: 'text/plain' });

    let target: FileSystemFileHandle | undefined;
    if (kind === 'file' && file && shouldStream(file.size)) {
      const picked = await pickSaveTarget(originalNameGuess(file.name));
      if (typeof picked === 'string') {
        setNotice(
          picked === 'cancelled'
            ? 'Choose where to save the opened file to open a large file.'
            : 'The browser didn’t open the save dialog. Choose Unlock again.'
        );
        return;
      }
      target = picked;
    }

    const outcome = await start(async (jc: JobControls) => {
      const r = await run({ op: 'unlock', data, password: pw, target }, jc.progress);
      if (r.kind === 'error') return failed(r);
      if (r.kind !== 'unlocked') return failed({ code: 'internal', message: 'Unexpected reply.' });
      // Opened contents are never kept once the user has moved on.
      if (!jc.current()) return { ok: 'cancelled' };
      const opened: Result = {
        mode: 'unlock',
        name: r.name,
        type: r.type,
        params: r.params,
        seal: r.seal,
        fileHash: r.fileHash,
        size: r.size,
        blob: r.blob,
        note: r.note,
        savedAs: r.streamed ? target?.name : undefined
      };
      remember(opened);
      setPw('');
      return { ok: true, result: opened };
    });
    if (outcome.ok === false && outcome.code === 'wrong-password') setTimeout(() => pwRef.current?.select(), 0);
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
      outcome === 'saved'
        ? 'Saved to your downloads.'
        : outcome === 'declined'
          ? 'Not saved. Choose Save again when you’re ready.'
          : 'Saving isn’t available here. Open the app in a browser to save files.'
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

  function pick(f: File) {
    setFile(f);
    setNotice('');
    if (job.status !== 'idle') resetJob();
  }

  const sealState: SealState =
    job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : busy ? 'working' : 'idle';
  const code = result ? sealCode(result.seal) : '';

  const statusText = (() => {
    if (job.status === 'working') {
      if (job.phase === 'kdf')
        return mode === 'lock' ? `Stretching your password with Argon2id, ${mib(params)}` : 'Checking the password';
      return `${mode === 'lock' ? 'Encrypting' : 'Decrypting'}, ${Math.round(job.fraction * 100)}%`;
    }
    if (job.status === 'failed') return mode === 'lock' ? 'Not locked' : 'Not opened';
    return '';
  })();

  const lockHint = (() => {
    if (mode !== 'lock' || canLock || busy || !hasInput || tooBig) return '';
    if (!tools) return 'Loading the strength checker…';
    if (!strong) return 'Choose a stronger password to lock.';
    if (!matches) return 'Type the password again to confirm it.';
    return '';
  })();

  return (
    <div className="page">
      <header className="bar">
        <div className="bar-inner">
          <div className="bar-start">
            <button type="button" className="back" onClick={onBack} disabled={busy}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
              Back
            </button>
            <a
              className="brand-link"
              href="#"
              aria-label="ArgonVault home"
              aria-disabled={busy}
              onClick={e => busy && e.preventDefault()}
            >
              ArgonVault
            </a>
          </div>
          <RubberSegment
            aria-label="Choose lock or unlock"
            items={[
              { value: 'lock', label: 'Lock' },
              { value: 'unlock', label: 'Unlock' }
            ]}
            value={mode}
            onChange={m => !busy && onMode(m as Mode)}
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
                      <DecryptedText
                        text={code}
                        animateOn="view"
                        speed={45}
                        maxIterations={14}
                        sequential
                        revealDirection="start"
                        characters="0123456789ABCDEF"
                      />
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
              <h1 id="doc-title">{mode === 'lock' ? 'Lock something' : 'Open something locked'}</h1>

              {result ? (
                <Outcome result={result} onSave={save} onCopy={copy} onReset={() => resetAll()} notice={notice} />
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
                    <DropZone
                      file={file}
                      onPick={pick}
                      disabled={busy}
                      emptyTitle={mode === 'lock' ? 'Drop a file to lock' : 'Drop a .argonvault file'}
                    />
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
                  {tooBig && (
                    <p className="warn">
                      This file is {formatSize(file!.size)}. This browser can handle files up to {formatSize(limit)}
                      {canStream() ? '.' : '. Chrome or Edge on a computer can stream larger files straight to disk.'}
                    </p>
                  )}

                  <PasswordFields
                    key={`${mode}:${formKey}`}
                    mode={mode}
                    tools={tools}
                    strength={strength}
                    pw={pw}
                    pw2={pw2}
                    setPw={setPw}
                    setPw2={setPw2}
                    busy={busy}
                    inputRef={pwRef}
                    onEdit={() => job.status === 'failed' && resetJob()}
                  />

                  {mode === 'lock' && (
                    <div className="field">
                      <span className="lbl">Key strength</span>
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
                          : 'Four times the memory per guess. Takes a few seconds longer to lock and open, and may fail on older phones.'}
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
                      <StatusMark
                        strike={false}
                        className="mark"
                        status={busy ? 'running' : 'failed'}
                        progress={job.status === 'working' && job.phase === 'crypt' ? job.fraction : undefined}
                        label={statusText}
                        color="var(--ink)"
                        doneColor="var(--gold)"
                        errorColor="var(--danger)"
                        size={22}
                        fontSize={15}
                      />
                    )}
                  </div>
                  {lockHint && <p className="sub">{lockHint}</p>}
                  {notice && (
                    <p className="sub" role="status">
                      {notice}
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
              <li>
                Note the seal code when you lock. When the file is opened, the same code proves it’s the same file and
                password.
              </li>
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
