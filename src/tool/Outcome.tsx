import StatusMark from '../rb/StatusMark';
import DecryptedText from '../rb/DecryptedText';
import { lockedName, sandboxed } from '../ui/save';
import { formatSize } from './limits';
import StampPanel from './StampPanel';
import type { Result } from './types';

const doneMark = (label: string) => (
  <StatusMark
    strike={false}
    className="mark"
    status="done"
    label={label}
    doneColor="var(--gold)"
    color="var(--ink)"
    size={22}
    fontSize={15}
  />
);

/** What the user sees after a successful lock or unlock. */
export default function Outcome({
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
  if (result.mode === 'lock') {
    const isNote = result.kind === 'note';
    return (
      <div className="outcome">
        {doneMark(isNote ? 'Note locked' : 'File locked')}
        {isNote ? (
          <pre className="armor" tabIndex={0} aria-label="Locked note">
            {result.text}
          </pre>
        ) : (
          <p className="out-file">
            <span className="fname">{result.savedAs ?? lockedName(result.name, !!result.text)}</span>
            <span className="fsize">{formatSize(result.size)}</span>
          </p>
        )}
        {result.savedAs ? (
          <p className="sub">Saved straight to the file you chose, without holding it in memory.</p>
        ) : null}
        <div className="row">
          {isNote && (
            <button type="button" className="primary" onClick={() => onCopy(result.text!)}>
              Copy locked text
            </button>
          )}
          {!result.savedAs && (
            <button type="button" className={isNote ? 'secondary' : 'primary'} onClick={onSave}>
              {isNote ? 'Save as .txt' : 'Save locked file'}
            </button>
          )}
          <button type="button" className="secondary" onClick={onReset}>
            Lock something else
          </button>
        </div>
        {notice && (
          <p className="sub" role="status">
            {notice}
          </p>
        )}
        {sandboxed() && !isNote && (
          <p className="sub">This preview saves locked files as text, so they open here or in the downloadable app.</p>
        )}
        <StampPanel fileHash={result.fileHash} mode="lock" />
      </div>
    );
  }

  const isNote = result.note !== undefined;
  return (
    <div className="outcome">
      {doneMark(isNote ? 'Note unlocked' : 'File unlocked')}
      {isNote ? (
        <div className="note-out" tabIndex={0} aria-label="Unlocked note">
          {result.note!.length <= 400 ? (
            <DecryptedText
              text={result.note!}
              animateOn="view"
              speed={28}
              maxIterations={8}
              sequential
              revealDirection="start"
            />
          ) : (
            result.note
          )}
        </div>
      ) : (
        <p className="out-file">
          <span className="fname">{result.savedAs ?? result.name}</span>
          <span className="fsize">{formatSize(result.size)}</span>
        </p>
      )}
      <p className="sub">
        Locked with Argon2id, {result.params.m / 1024} MiB and {result.params.t} passes. Every chunk passed its
        integrity check.
        {result.savedAs ? ' Saved straight to the file you chose.' : ''}
      </p>
      <div className="row">
        {isNote ? (
          <button type="button" className="primary" onClick={() => onCopy(result.note!)}>
            Copy note
          </button>
        ) : (
          !result.savedAs && (
            <button type="button" className="primary" onClick={onSave}>
              Save {result.name}
            </button>
          )
        )}
        <button type="button" className="secondary" onClick={onReset}>
          Open another
        </button>
      </div>
      {notice && (
        <p className="sub" role="status">
          {notice}
        </p>
      )}
      <StampPanel fileHash={result.fileHash} mode="unlock" />
    </div>
  );
}
