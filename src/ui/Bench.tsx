import { useState } from 'react';
import type { BenchResult } from '../crypto/bench';

/** Runs the benchmark in the crypto worker and shows this device's numbers. */
export default function Bench() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [r, setR] = useState<BenchResult | null>(null);
  const [copied, setCopied] = useState('');

  async function measure() {
    setState('running');
    try {
      const { run } = await import('../crypto/client');
      const reply = await run({ op: 'bench' });
      if (reply.kind !== 'bench') throw new Error();
      setR(reply.result);
      setState('done');
    } catch {
      setState('error');
    }
  }

  const sec = (ms: number | null) => (ms === null ? 'Not enough memory' : `${(ms / 1000).toFixed(2)} s`);
  const perSecond = (ms: number | null) => (ms === null ? 'n/a' : (1000 / ms).toFixed(1));
  const device = r
    ? [r.cores ? `${r.cores} cores` : null, r.memoryGB ? `${r.memoryGB} GB memory reported` : null]
        .filter(Boolean)
        .join(', ')
    : '';
  const rows: [string, string][] = r
    ? [
        ['Argon2id, Standard (64 MiB, 3 passes)', sec(r.argonStandardMs)],
        ['Argon2id, Hardened (256 MiB, 4 passes)', sec(r.argonHardenedMs)],
        ['Password guesses per second here (Standard)', perSecond(r.argonStandardMs)],
        ['AES-256-GCM encryption', `${r.encryptMBs} MB/s`],
        ['AES-256-GCM decryption', `${r.decryptMBs} MB/s`],
        ['SHA-256 fingerprint', `${r.hashMBs} MB/s`],
        ['Argon2 engine', r.engine === 'wasm' ? 'WebAssembly' : 'JavaScript']
      ]
    : [];

  async function copy() {
    const text = [
      `Device: ${device || 'unknown'}`,
      `Browser: ${r?.userAgent ?? ''}`,
      ...rows.map(([k, v]) => `${k}: ${v}`)
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied.');
    } catch {
      setCopied('Copy isn’t allowed here. Select the table to copy it.');
    }
  }

  return (
    <div className="bench">
      <h3>Measure this device</h3>
      <p className="sub">
        Runs the same Argon2id and AES-GCM code on this device, in the background. Takes 5 to 30 seconds. Try it on a
        phone and a laptop to compare.
      </p>
      {!r && (
        <button type="button" className="secondary" onClick={measure} disabled={state === 'running'}>
          {state === 'running' ? 'Measuring…' : 'Measure this device'}
        </button>
      )}
      {state === 'error' && <p className="sub bad">The measurement didn’t finish. Reload the page and try again.</p>}
      {r && (
        <>
          <table className="bench-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {device && <p className="sub">This device: {device}.</p>}
          <div className="row">
            <button type="button" className="secondary" onClick={copy} disabled={state === 'running'}>
              Copy results
            </button>
            <button type="button" className="link" onClick={measure} disabled={state === 'running'}>
              {state === 'running' ? 'Measuring…' : 'Measure again'}
            </button>
          </div>
          {copied && <p className="sub">{copied}</p>}
        </>
      )}
    </div>
  );
}
