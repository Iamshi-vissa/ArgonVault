import { keccak_256 } from '@noble/hashes/sha3.js';
import artifact from './artifact.json';

/**
 * Blockchain timestamps for locked files, on the Ethereum Sepolia test network.
 *
 * Only the SHA-256 of the locked (encrypted) file goes on chain. The page talks
 * to the chain solely through the user's own wallet (window.ethereum), so its
 * "no network connections" policy still holds: the wallet extension does the
 * networking, and every write needs the user's approval in the wallet.
 */

export const SEPOLIA = {
  chainId: '0xaa36a7',
  chainName: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io']
};

const STORAGE_KEY = 'argonvault.stampContract';

/** The contract address: set at build time (VITE_STAMP_CONTRACT), or saved on this browser by the setup page. */
export function contractAddress(): string | null {
  let local: string | null = null;
  try {
    local = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage can be unavailable */
  }
  const value = (import.meta.env?.VITE_STAMP_CONTRACT as string | undefined) || local;
  return value && isAddress(value) ? value : null;
}

export function rememberContract(address: string) {
  try {
    localStorage.setItem(STORAGE_KEY, address);
  } catch {
    /* ignore */
  }
}

export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const explorerTx = (hash: string) => `${SEPOLIA.blockExplorerUrls[0]}/tx/${hash}`;
export const explorerAddress = (a: string) => `${SEPOLIA.blockExplorerUrls[0]}/address/${a}`;

/* ---------------- ABI encoding (no library: two functions, one error) ---------------- */

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const toHex = (b: Uint8Array) => '0x' + hex(b);
const selector = (signature: string) => hex(keccak_256(new TextEncoder().encode(signature)).subarray(0, 4));

export const SELECTORS = {
  stamp: selector('stamp(bytes32)'),
  stampOf: selector('stampOf(bytes32)'),
  alreadyStamped: selector('AlreadyStamped(bytes32,uint64,uint64)'),
  emptyHash: selector('EmptyHash()')
};

function word(fileHash: Uint8Array | string): string {
  const h = typeof fileHash === 'string' ? fileHash.replace(/^0x/, '') : hex(fileHash);
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error('A file fingerprint must be 32 bytes.');
  return h.toLowerCase();
}

export const encodeStamp = (fileHash: Uint8Array | string) => '0x' + SELECTORS.stamp + word(fileHash);
export const encodeStampOf = (fileHash: Uint8Array | string) => '0x' + SELECTORS.stampOf + word(fileHash);

export interface StampInfo {
  time: number; // seconds since 1970
  blockNumber: number;
  by: string;
  txHash?: string;
}

/** Decodes stampOf's (uint64, uint64, address). Returns null when the hash was never stamped. */
export function decodeStampOf(result: string): StampInfo | null {
  const h = result.replace(/^0x/, '');
  if (h.length < 192) throw new Error('Unexpected reply from the contract.');
  const time = Number(BigInt('0x' + h.slice(0, 64)));
  const blockNumber = Number(BigInt('0x' + h.slice(64, 128)));
  const by = '0x' + h.slice(128 + 24, 192);
  return /^0x0{40}$/.test(by) ? null : { time, blockNumber, by };
}

/** Reads AlreadyStamped(hash, time, block) out of revert data, if that's what it is. */
export function decodeAlreadyStamped(data: string | undefined): { time: number; blockNumber: number } | null {
  const h = (data ?? '').replace(/^0x/, '');
  if (!h.startsWith(SELECTORS.alreadyStamped) || h.length < 8 + 192) return null;
  return {
    time: Number(BigInt('0x' + h.slice(8 + 64, 8 + 128))),
    blockNumber: Number(BigInt('0x' + h.slice(8 + 128, 8 + 192)))
  };
}

/* ---------------- Wallet access ---------------- */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export class ChainError extends Error {
  constructor(
    public code: 'no-wallet' | 'rejected' | 'no-contract' | 'wrong-network' | 'failed' | 'timeout',
    message: string
  ) {
    super(message);
  }
}

export const hasWallet = () => typeof window !== 'undefined' && !!window.ethereum;

function wallet(): Eip1193 {
  if (!window.ethereum)
    throw new ChainError(
      'no-wallet',
      'No Ethereum wallet found. Install MetaMask (or a similar wallet) to use timestamps.'
    );
  return window.ethereum;
}

function friendly(e: unknown): ChainError {
  if (e instanceof ChainError) return e;
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001) return new ChainError('rejected', 'You cancelled the request in your wallet.');
  if (err?.code === -32002)
    return new ChainError('rejected', 'Your wallet already has a request open. Check the wallet window.');
  return new ChainError('failed', err?.message ? `The wallet reported: ${err.message}` : 'The wallet request failed.');
}

async function call<T>(method: string, params?: unknown[]): Promise<T> {
  try {
    return (await wallet().request({ method, params })) as T;
  } catch (e) {
    throw friendly(e);
  }
}

/** Makes sure the wallet is on Sepolia, offering to add it if the wallet doesn't know it. */
export async function ensureSepolia(): Promise<void> {
  const current = await call<string>('eth_chainId');
  if (current?.toLowerCase() === SEPOLIA.chainId) return;
  try {
    await wallet().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA.chainId }] });
  } catch (e) {
    if ((e as { code?: number })?.code === 4902) await call('wallet_addEthereumChain', [SEPOLIA]);
    else throw friendly(e);
  }
}

async function account(): Promise<string> {
  const accounts = await call<string[]>('eth_requestAccounts');
  if (!accounts?.length) throw new ChainError('rejected', 'No account was shared from the wallet.');
  return accounts[0];
}

function needContract(): string {
  const address = contractAddress();
  if (!address) throw new ChainError('no-contract', 'Timestamps aren’t set up on this site yet.');
  return address;
}

async function receipt(txHash: string, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await call<{ status: string; blockNumber: string; contractAddress?: string } | null>(
      'eth_getTransactionReceipt',
      [txHash]
    );
    if (r) {
      if (r.status !== '0x1') throw new ChainError('failed', 'The transaction was included in a block but failed.');
      return r;
    }
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new ChainError('timeout', 'The network is slow to confirm. Check the transaction link later.');
}

/** Looks up when a locked file was first timestamped. */
export async function lookup(fileHash: Uint8Array | string): Promise<StampInfo | null> {
  const to = needContract();
  await ensureSepolia();
  const result = await call<string>('eth_call', [{ to, data: encodeStampOf(fileHash) }, 'latest']);
  return decodeStampOf(result);
}

export type StampStep = 'connecting' | 'network' | 'checking' | 'confirm' | 'mining';

/**
 * Timestamps a locked file. If it was already stamped, returns that earlier
 * stamp (the first one is the one that counts) without sending anything.
 */
export async function stamp(
  fileHash: Uint8Array | string,
  onStep: (s: StampStep) => void = () => {}
): Promise<StampInfo & { alreadyStamped: boolean }> {
  const to = needContract();
  onStep('connecting');
  const from = await account();
  onStep('network');
  await ensureSepolia();
  onStep('checking');
  const before = decodeStampOf(await call<string>('eth_call', [{ to, data: encodeStampOf(fileHash) }, 'latest']));
  if (before) return { ...before, alreadyStamped: true };
  onStep('confirm');
  const txHash = await call<string>('eth_sendTransaction', [{ from, to, data: encodeStamp(fileHash) }]);
  onStep('mining');
  await receipt(txHash);
  const after = decodeStampOf(await call<string>('eth_call', [{ to, data: encodeStampOf(fileHash) }, 'latest']));
  if (!after) throw new ChainError('failed', 'The transaction confirmed, but the stamp wasn’t found.');
  return { ...after, txHash, alreadyStamped: false };
}

/** Deploys the timestamp contract from the user's wallet (setup page). */
export async function deployContract(
  onStep: (s: StampStep) => void = () => {}
): Promise<{ address: string; txHash: string }> {
  onStep('connecting');
  const from = await account();
  onStep('network');
  await ensureSepolia();
  onStep('confirm');
  const txHash = await call<string>('eth_sendTransaction', [{ from, data: artifact.bytecode }]);
  onStep('mining');
  const r = await receipt(txHash);
  if (!r.contractAddress) throw new ChainError('failed', 'The deployment didn’t create a contract.');
  return { address: r.contractAddress, txHash };
}
