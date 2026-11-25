import { sandboxed } from '../ui/save';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Memory budget. Without streaming, the whole result is held in memory, so
 * files are limited to 1 GB (512 MB on devices reporting 4 GB of RAM or less).
 * Where the browser can write straight to disk (File System Access API:
 * Chrome, Edge and Opera on desktop), files above STREAM_FROM are streamed and
 * the limit rises to 64 GB.
 */
// End-to-end tests lower this threshold (window.__ARGONVAULT_TEST__) so streaming can be tested with small files.
const testHooks = (globalThis as { __ARGONVAULT_TEST__?: { streamFrom?: number } }).__ARGONVAULT_TEST__;
export const STREAM_FROM = testHooks?.streamFrom ?? 200 * MB;
export const STREAM_LIMIT = 64 * GB;
/** Locked files larger than this aren't kept in the session list for saving again. */
export const KEEP_LIMIT = 64 * MB;

export function memoryLimit(): number {
  const ram = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return ram !== undefined && ram <= 4 ? 512 * MB : 1 * GB;
}

type SavePicker = (opts: { suggestedName?: string; id?: string }) => Promise<FileSystemFileHandle>;

/** Whether this browser can stream results to a file the user picks. */
export function canStream(): boolean {
  return (
    !sandboxed() && typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === 'function'
  );
}

export function shouldStream(size: number): boolean {
  return size > STREAM_FROM && canStream();
}

export function sizeLimit(): number {
  return canStream() ? STREAM_LIMIT : memoryLimit();
}

/**
 * Asks where to save. Must run straight from a click or key press. Returns
 * null if the user closed the dialog.
 */
export async function pickSaveTarget(suggestedName: string): Promise<FileSystemFileHandle | null> {
  const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
  try {
    return await picker({ suggestedName, id: 'argonvault' });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null;
    throw e;
  }
}

/** "photo.jpg.argonvault" → "photo.jpg"; the best guess at the original name before decrypting. */
export function originalNameGuess(locked: string): string {
  return locked.replace(/\.argonvault(\.txt)?$/i, '').replace(/\.txt$/i, '') || 'unlocked-file';
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 2);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
