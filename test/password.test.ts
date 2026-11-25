import { expect, it } from 'vitest';
import { passphrase, strength, MIN_SCORE, PASSPHRASE_BITS } from '../src/crypto/password';

it('rejects common passwords and accepts generated passphrases', () => {
  expect(strength('password123')!.score).toBeLessThan(MIN_SCORE);
  const p = passphrase();
  expect(p.split('-')).toHaveLength(6);
  expect(strength(p)!.score).toBeGreaterThanOrEqual(MIN_SCORE);
  expect(PASSPHRASE_BITS()).toBeCloseTo(77.5, 1);
});
