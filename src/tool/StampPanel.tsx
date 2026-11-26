import { useState } from 'react';
import StatusMark from '../rb/StatusMark';
import type { StampInfo, StampStep } from '../chain/stamp';

type ChainModule = typeof import('../chain/stamp');
const load = () => import('../chain/stamp');

const STEP_TEXT: Record<StampStep, string> = {
  connecting: 'Connecting to your wallet',
  network: 'Switching to the Sepolia test network',
  checking: 'Checking for an earlier timestamp',
  confirm: 'Confirm the transaction in your wallet',
  mining: 'Waiting for the transaction to be confirmed'
};

const when = (s: StampInfo) =>
  new Date(s.time * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type View =
  | { state: 'idle' }
  | { state: 'busy'; text: string }
  | { state: 'stamped'; info: StampInfo; already: boolean }
  | { state: 'none' }
  | { state: 'no-wallet'; events: string }
  | { state: 'error'; text: string };

/**
 * Optional proof-of-existence on Ethereum (Sepolia test network). Locking offers
 * to record the locked file's SHA-256; opening offers to look it up.
 */
export default function StampPanel({ fileHash, mode }: { fileHash: Uint8Array; mode: 'lock' | 'unlock' }) {
  const [view, setView] = useState<View>({ state: 'idle' });
  const [chain, setChain] = useState<ChainModule | null>(null);
  const [copied, setCopied] = useState(false);
  const hex = Array.from(fileHash, b => b.toString(16).padStart(2, '0')).join('');

  async function copyFingerprint() {
    try {
      await navigator.clipboard.writeText('0x' + hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the full value is still selectable in the page */
    }
  }

  async function run(kind: 'stamp' | 'lookup') {
    try {
      const m = chain ?? (await load());
      setChain(m);
      const address = m.contractAddress();
      if (!address) {
        setView({
          state: 'error',
          text: 'Timestamps aren’t set up on this site yet. See the setup page in the README.'
        });
        return;
      }
      if (!m.hasWallet()) {
        // Reading needs a wallet too: the page itself never connects to the network.
        if (kind === 'lookup') {
          setView({ state: 'no-wallet', events: `${m.explorerAddress(address)}#events` });
          return;
        }
        setView({
          state: 'error',
          text: 'No Ethereum wallet found. Install MetaMask (or a similar wallet) and reload.'
        });
        return;
      }
      if (kind === 'stamp') {
        const r = await m.stamp(fileHash, step => setView({ state: 'busy', text: STEP_TEXT[step] }));
        setView({ state: 'stamped', info: r, already: r.alreadyStamped });
      } else {
        setView({ state: 'busy', text: 'Looking up the timestamp' });
        const r = await m.lookup(fileHash);
        setView(r ? { state: 'stamped', info: r, already: true } : { state: 'none' });
      }
    } catch (e) {
      setView({ state: 'error', text: (e as Error)?.message || 'The wallet request failed.' });
    }
  }

  const busy = view.state === 'busy';
  return (
    <section className="stamp" aria-labelledby="stamp-title">
      <h2 id="stamp-title">Blockchain timestamp</h2>
      <p className="sub">
        {mode === 'lock'
          ? 'Optional. Records this locked file’s fingerprint on the Ethereum Sepolia test network, proving it existed today. Nothing about the contents, name or password goes on chain.'
          : 'Check whether this locked file was timestamped on the Ethereum Sepolia test network, and when.'}
      </p>
      <p className="fingerprint" title="SHA-256 of the locked file">
        <span className="lbl">Fingerprint</span>
        <code>
          {hex.slice(0, 16)}…{hex.slice(-16)}
        </code>
        <button type="button" className="link" onClick={copyFingerprint}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>

      {view.state === 'busy' && (
        <StatusMark
          status="running"
          label={view.text}
          color="var(--ink)"
          size={20}
          fontSize={14}
          className="mark"
          strike={false}
        />
      )}
      {view.state === 'stamped' && (
        <div className="stamp-ok" role="status">
          <StatusMark
            status="done"
            label={view.already && mode === 'lock' ? 'Already timestamped' : 'Timestamped'}
            color="var(--ink)"
            doneColor="var(--gold)"
            size={20}
            fontSize={14}
            className="mark"
            strike={false}
          />
          <p>
            {when(view.info)}, block {view.info.blockNumber.toLocaleString()}.
            {view.info.txHash && chain && (
              <>
                {' '}
                <a className="link" href={chain.explorerTx(view.info.txHash)} target="_blank" rel="noreferrer">
                  View the transaction
                </a>
              </>
            )}
          </p>
        </div>
      )}
      {view.state === 'none' && <p className="sub">No timestamp found for this file.</p>}
      {view.state === 'no-wallet' && (
        <p className="sub" role="status">
          Checking needs a wallet such as MetaMask, because this page never connects to the network itself. Without one,
          copy the fingerprint and look for it in the{' '}
          <a className="link" href={view.events} target="_blank" rel="noreferrer">
            contract’s events on Etherscan
          </a>
          .
        </p>
      )}
      {view.state === 'error' && (
        <p className="sub bad" role="alert">
          {view.text}
        </p>
      )}

      {view.state !== 'stamped' && (
        <button
          type="button"
          className="secondary"
          onClick={() => run(mode === 'lock' ? 'stamp' : 'lookup')}
          disabled={busy}
        >
          {mode === 'lock' ? 'Timestamp with my wallet' : 'Check the timestamp'}
        </button>
      )}
    </section>
  );
}
