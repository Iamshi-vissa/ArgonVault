import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import { EFF_WORDS } from './effWords';

const checker = new ZxcvbnFactory({
  translations: en.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...en.dictionary }
});

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  detail: string;
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

/** Minimum score required to lock. */
export const MIN_SCORE = 3;

export function strength(password: string): Strength | null {
  if (!password) return null;
  const r = checker.check(password.slice(0, 128));
  const time = r.crackTimes.offlineSlowHashingXPerSecond.display;
  const tip = r.feedback.warning || r.feedback.suggestions[0] || '';
  const detail =
    r.score >= MIN_SCORE
      ? `Guessing it would take ${time}, even offline.`
      : tip || 'Add more words or characters.';
  return { score: r.score as Strength['score'], label: LABELS[r.score], detail };
}

/** Unbiased random index below n, using rejection sampling over 32-bit values. */
function randomIndex(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

/** Six words from the EFF list: log2(7776^6) ≈ 77.5 bits of entropy. */
export function passphrase(words = 6): string {
  return Array.from({ length: words }, () => EFF_WORDS[randomIndex(EFF_WORDS.length)]).join('-');
}

export const PASSPHRASE_BITS = (words = 6) => Math.round(words * Math.log2(EFF_WORDS.length) * 10) / 10;
