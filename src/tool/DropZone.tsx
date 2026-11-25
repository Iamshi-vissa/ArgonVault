import { useEffect, useState } from 'react';
import { formatSize } from './limits';

/** A file picker that also takes drag-and-drop. */
export default function DropZone({
  file,
  onPick,
  disabled,
  emptyTitle
}: {
  file: File | null;
  onPick: (f: File) => void;
  disabled: boolean;
  emptyTitle: string;
}) {
  const [over, setOver] = useState(false);

  // A file dropped outside the zone would otherwise make the browser navigate away to it.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  return (
    <label
      className={`drop${over ? ' over' : ''}${file ? ' has' : ''}`}
      onDragEnter={() => setOver(true)}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onPick(f);
      }}
    >
      <input
        type="file"
        disabled={disabled}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = ''; // so choosing the same file again still fires
        }}
      />
      {file ? (
        <span className="file">
          <span className="fname">{file.name}</span>
          <span className="fsize">{formatSize(file.size)}</span>
          <span className="change">Choose a different file</span>
        </span>
      ) : (
        <span className="empty">
          <span className="big">{emptyTitle}</span>
          <span>or choose one from this device</span>
        </span>
      )}
    </label>
  );
}
