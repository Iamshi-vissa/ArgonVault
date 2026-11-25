import { useEffect, useMemo, useState, type RefObject } from 'react';
import type * as PasswordModule from '../crypto/password';
import type { Strength } from '../crypto/password';
import type { Mode } from './types';

type Tools = typeof PasswordModule;

/**
 * The strength checker and passphrase list are about a megabyte of
 * dictionaries, so they load only when the lock page is opened.
 */
export function usePasswordTools(enabled: boolean) {
  const [tools, setTools] = useState<Tools | null>(null);
  useEffect(() => {
    if (!enabled || tools) return;
    let live = true;
    import('../crypto/password').then(m => live && setTools(m));
    return () => {
      live = false;
    };
  }, [enabled, tools]);
  return tools;
}

export function useStrength(tools: Tools | null, password: string): Strength | null {
  return useMemo(() => (tools && password ? tools.strength(password) : null), [tools, password]);
}

/** Password (and, when locking, confirmation and strength). Remount with a new key to clear it. */
export default function PasswordFields({
  mode,
  tools,
  strength,
  pw,
  pw2,
  setPw,
  setPw2,
  busy,
  inputRef,
  onEdit
}: {
  mode: Mode;
  tools: Tools | null;
  strength: Strength | null;
  pw: string;
  pw2: string;
  setPw: (v: string) => void;
  setPw2: (v: string) => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onEdit: () => void;
}) {
  const [show, setShow] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const matches = pw.length > 0 && pw === pw2;
  const meter = strength ? Math.max(1, strength.score) : 0;

  function suggest() {
    if (!tools) return;
    const p = tools.passphrase();
    setPw(p);
    setPw2(p);
    setShow(true);
    setSuggested(true);
  }

  return (
    <>
      <div className="field">
        <div className="lbl-row">
          <label className="lbl" htmlFor="pw">
            Password
          </label>
          {mode === 'lock' && (
            <button type="button" className="link" onClick={suggest} disabled={busy || !tools}>
              Suggest a passphrase
            </button>
          )}
        </div>
        <div className="pw">
          <input
            id="pw"
            ref={inputRef}
            type={show ? 'text' : 'password'}
            value={pw}
            onChange={e => {
              setPw(e.target.value);
              setSuggested(false);
              onEdit();
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
            <div className={`bars s${strength?.score ?? 0}`} aria-hidden="true">
              {[1, 2, 3, 4].map(i => (
                <i key={i} className={i <= meter ? 'on' : ''} />
              ))}
            </div>
            <p>
              {suggested && tools
                ? `Six random words, about ${tools.PASSPHRASE_BITS()} bits. Write it down: a lost password can’t be recovered.`
                : !tools && pw
                  ? 'Checking strength…'
                  : strength
                    ? `${strength.label}. ${strength.detail}`
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
    </>
  );
}
