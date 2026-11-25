import { useEffect, useState } from 'react';
import type { StampStep } from './chain/stamp';

type Chain = typeof import('./chain/stamp');

const STEPS: Record<StampStep, string> = {
  connecting: 'Connecting to your wallet',
  network: 'Switching to Sepolia',
  checking: 'Checking',
  confirm: 'Confirm the deployment in your wallet',
  mining: 'Waiting for the deployment to be confirmed'
};

/**
 * One-time setup for blockchain timestamps (#setup): deploys the timestamp
 * contract to Sepolia from the owner's wallet, or saves an existing address on
 * this browser. Not linked from the app; the README points here.
 */
export default function Setup() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [deployed, setDeployed] = useState<{ address: string; txHash: string } | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    import('./chain/stamp').then(setChain);
  }, []);

  const current = chain?.contractAddress() ?? null;

  async function deploy() {
    if (!chain) return;
    setError('');
    try {
      const r = await chain.deployContract(s => setStatus(STEPS[s]));
      chain.rememberContract(r.address);
      setDeployed(r);
      setStatus('');
    } catch (e) {
      setStatus('');
      setError((e as Error).message);
    }
  }

  function useExisting() {
    if (!chain) return;
    if (!chain.isAddress(manual.trim())) {
      setError('That isn’t an Ethereum address (0x followed by 40 hex characters).');
      return;
    }
    chain.rememberContract(manual.trim());
    setError('');
    setStatus('Saved on this browser.');
  }

  return (
    <div className="page setup">
      <header className="bar">
        <div className="bar-inner">
          <a className="brand-link" href="#">
            ArgonVault
          </a>
        </div>
      </header>
      <main className="band setup-main">
        <h1>Set up blockchain timestamps</h1>
        <p className="lede">
          Timestamps use a small contract on the Ethereum Sepolia test network. Deploy it once from your wallet, then
          put its address in the site’s settings so every visitor uses it.
        </p>

        <section className="setup-card">
          <h2>Current contract</h2>
          {current ? (
            <p>
              <code>{current}</code>{' '}
              <a className="link" href={chain!.explorerAddress(current)} target="_blank" rel="noreferrer">
                View on Etherscan
              </a>
            </p>
          ) : (
            <p className="sub">None yet.</p>
          )}
        </section>

        <section className="setup-card">
          <h2>Deploy a new contract</h2>
          <p className="sub">
            You need a wallet such as MetaMask with a little Sepolia test ETH (free from a Sepolia faucet). Deploying
            costs a fraction of that.
          </p>
          <button type="button" className="primary" onClick={deploy} disabled={!chain || !!status}>
            Deploy with my wallet
          </button>
          {status && <p className="sub">{status}</p>}
          {deployed && (
            <div className="setup-done" role="status">
              <p>
                Deployed to <code>{deployed.address}</code>. It’s saved on this browser already.
              </p>
              <p className="sub">
                To use it for everyone, add an environment variable in Vercel: <code>VITE_STAMP_CONTRACT</code> ={' '}
                <code>{deployed.address}</code>, then redeploy.
              </p>
            </div>
          )}
        </section>

        <section className="setup-card">
          <h2>Use an existing contract</h2>
          <label className="field">
            <span className="lbl">Contract address</span>
            <input value={manual} onChange={e => setManual(e.target.value)} placeholder="0x…" spellCheck={false} />
          </label>
          <button type="button" className="secondary" onClick={useExisting} disabled={!chain}>
            Use on this browser
          </button>
        </section>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
