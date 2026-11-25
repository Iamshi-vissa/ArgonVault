import type { KdfParams } from '../crypto/format';

export type Mode = 'lock' | 'unlock';
export type Kind = 'file' | 'note';

interface Common {
  seal: Uint8Array;
  /** SHA-256 of the locked file: what blockchain timestamps record. */
  fileHash: Uint8Array;
  /** Size of the output in bytes. */
  size: number;
  /** Set when the output was streamed straight to a file on disk (its name). */
  savedAs?: string;
}

export type Result =
  | (Common & { mode: 'lock'; kind: Kind; name: string; blob?: Blob; text?: string })
  | (Common & { mode: 'unlock'; name: string; type: string; params: KdfParams; blob?: Blob; note?: string });
