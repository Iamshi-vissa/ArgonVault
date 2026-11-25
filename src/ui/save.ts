import { zipSync } from 'fflate';

/**
 * Saving files. Run standalone, the app uses a normal browser download.
 * Inside a Claude artifact, the page is sandboxed: files are offered through
 * the host's `downloads` capability, which only accepts common file types.
 */

type Downloads = { save(r: { filename: string; data: Blob | string | Uint8Array }): Promise<{ status: string }> };
declare global {
  interface Window {
    claude?: { use(name: string): Promise<unknown> };
  }
}

const HOST_TYPES = new Set(
  'gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip'.split(' ')
);

/** True inside a Claude artifact, where only certain file types can be saved. */
export const sandboxed = () => typeof window.claude?.use === 'function';

async function hostDownloads(): Promise<Downloads | null> {
  if (!sandboxed()) return null;
  try {
    return (await window.claude!.use('downloads')) as Downloads | null;
  } catch {
    return null;
  }
}

type SaveOutcome = 'saved' | 'declined' | 'unavailable';

export async function saveFile(filename: string, data: Blob | string): Promise<SaveOutcome> {
  const dl = await hostDownloads();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      return code === 'declined' || code === 'rate_limited' ? 'declined' : 'unavailable';
    }
  }
  if (sandboxed()) return 'unavailable';
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

/** Name and payload for a restored file, wrapped in a zip if the host can't save its type. */
export async function restoredFile(name: string, blob: Blob): Promise<{ filename: string; data: Blob }> {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!sandboxed() || HOST_TYPES.has(ext)) return { filename: name, data: blob };
  const zipped = zipSync({ [name]: [new Uint8Array(await blob.arrayBuffer()), { level: 0 }] });
  return { filename: name + '.zip', data: new Blob([zipped as BlobPart], { type: 'application/zip' }) };
}

export const lockedName = (name: string, armored: boolean) => `${name || 'note'}.argonvault${armored ? '.txt' : ''}`;
