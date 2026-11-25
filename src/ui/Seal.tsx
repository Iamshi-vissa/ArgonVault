import { useMemo } from 'react';

/**
 * A guilloché rosette, the engraved pattern printed on banknotes and
 * certificates, drawn from the file's seal. The same file and password always
 * give the same rosette; a different password gives a different one.
 */

const IDLE_SEED = new Uint8Array([0x5e, 0xa1, 0x07, 0x33, 0xc4, 0x18, 0x9b, 0x62]);

function prng(seed: Uint8Array) {
  let s = 0x9e3779b9;
  for (const b of seed) s = Math.imul(s ^ b, 0x85ebca6b) ^ (s >>> 13);
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

type Layer = { paths: string[]; cls: string };

function curve(r: (t: number) => number, rot: number, steps: number): string {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rr = r(t);
    const x = 200 + rr * Math.cos(t + rot);
    const y = 200 + rr * Math.sin(t + rot);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d + 'Z';
}

function build(seed: Uint8Array): Layer[] {
  const rnd = prng(seed);
  const pick = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

  // Outer band: a tight wave, repeated with small rotations so the copies weave.
  const k1 = pick(22, 34);
  const c1 = pick(5, 8);
  const amp1 = 6 + rnd() * 5;
  const outer = Array.from({ length: c1 }, (_, i) =>
    curve(t => 172 + amp1 * Math.sin(k1 * t), (i * 2 * Math.PI) / (k1 * c1), 900)
  );

  // Main rosette: petals modulated by a slower wave.
  const k2 = pick(6, 11);
  const k3 = pick(2, 5);
  const c2 = pick(12, 20);
  const ph = rnd() * Math.PI;
  const amp2 = 26 + rnd() * 14;
  const main = Array.from({ length: c2 }, (_, i) =>
    curve(
      t => 118 + amp2 * Math.sin(k2 * t + ph) * (0.65 + 0.35 * Math.cos(k3 * t)),
      (i * 2 * Math.PI) / (k2 * c2),
      720
    )
  );

  // Inner rosette, counter-phased.
  const k4 = pick(9, 16);
  const c3 = pick(10, 16);
  const amp3 = 12 + rnd() * 8;
  const inner = Array.from({ length: c3 }, (_, i) =>
    curve(t => 56 + amp3 * Math.sin(k4 * t + Math.PI / 2), (i * 2 * Math.PI) / (k4 * c3), 540)
  );

  return [
    { paths: outer, cls: 'g-outer' },
    { paths: main, cls: 'g-main' },
    { paths: inner, cls: 'g-inner' }
  ];
}

export type SealState = 'idle' | 'working' | 'done' | 'failed';

export default function Seal({ seed, state, code }: { seed: Uint8Array | null; state: SealState; code?: string }) {
  const key = seed ? Array.from(seed).join('.') : 'idle';
  const layers = useMemo(() => build(seed ?? IDLE_SEED), [seed]);
  return (
    <figure className={`seal seal-${state}`} aria-label={code ? `Seal ${code}` : 'Seal appears after locking'}>
      <svg viewBox="0 0 400 400" role="img" aria-hidden="true" key={key}>
        <circle cx="200" cy="200" r="190" className="g-ring" />
        <circle cx="200" cy="200" r="185" className="g-ring thin" />
        {layers.map((l, li) => (
          <g key={li} className={`g-layer ${l.cls}`} style={{ ['--d' as string]: `${li * 260}ms` }}>
            {l.paths.map((d, i) => (
              <path key={i} d={d} pathLength={1} />
            ))}
          </g>
        ))}
        <circle cx="200" cy="200" r="26" className="g-boss" />
        <circle cx="200" cy="200" r="21" className="g-ring thin" />
      </svg>
    </figure>
  );
}
