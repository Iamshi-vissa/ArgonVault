import { beforeAll, describe, expect, it } from 'vitest';
import { createVM, runTx, type VM } from '@ethereumjs/vm';
import { createLegacyTx } from '@ethereumjs/tx';
import { createBlock } from '@ethereumjs/block';
import { Common, Hardfork, Sepolia } from '@ethereumjs/common';
import {
  Account,
  createAddressFromPrivateKey,
  createContractAddress,
  hexToBytes,
  bytesToHex,
  type Address
} from '@ethereumjs/util';
import artifact from '../src/chain/artifact.json';
import { decodeAlreadyStamped, decodeStampOf, encodeStamp, encodeStampOf, SELECTORS } from '../src/chain/stamp';

/**
 * Runs the compiled contract in an in-process EVM (EthereumJS) and drives it
 * with the same encoders and decoders the app uses, so the app's hand-written
 * ABI encoding is checked against the real bytecode.
 */

const common = new Common({ chain: Sepolia, hardfork: Hardfork.Paris });
const keys = [hexToBytes(`0x${'11'.repeat(32)}`), hexToBytes(`0x${'22'.repeat(32)}`)];
let vm: VM;
let contract: Address;
const nonces = new Map<string, bigint>();
let height = 7_000_000n;

async function send(key: Uint8Array, to: Address | undefined, data: string) {
  const from = createAddressFromPrivateKey(key);
  const nonce = nonces.get(from.toString()) ?? 0n;
  nonces.set(from.toString(), nonce + 1n);
  const tx = createLegacyTx(
    { nonce, gasPrice: 10n, gasLimit: 1_000_000n, to, data: hexToBytes(data as `0x${string}`) },
    { common }
  ).sign(key);
  height += 1n;
  const block = createBlock(
    { header: { number: height, timestamp: 1_790_000_000n + height * 12n, gasLimit: 30_000_000n } },
    { common }
  );
  return runTx(vm, { tx, block, skipBlockGasLimitValidation: true });
}

async function read(data: string) {
  const r = await vm.evm.runCall({ to: contract, data: hexToBytes(data as `0x${string}`), gasLimit: 1_000_000n });
  return bytesToHex(r.execResult.returnValue);
}

const fileHash = new Uint8Array(32).map((_, i) => i + 1);

beforeAll(async () => {
  vm = await createVM({ common });
  for (const k of keys) await vm.stateManager.putAccount(createAddressFromPrivateKey(k), new Account(0n, 10n ** 20n));
  const deployer = createAddressFromPrivateKey(keys[0]);
  contract = createContractAddress(deployer, 0n);
  const r = await send(keys[0], undefined, artifact.bytecode);
  expect(r.execResult.exceptionError).toBeUndefined();
});

describe('ArgonVaultTimestamps contract', () => {
  it('reports nothing for a hash that was never stamped', async () => {
    expect(decodeStampOf(await read(encodeStampOf(fileHash)))).toBeNull();
  });

  it('stamps a hash and returns its time, block and sender', async () => {
    const r = await send(keys[1], contract, encodeStamp(fileHash));
    expect(r.execResult.exceptionError).toBeUndefined();
    expect(r.receipt.logs).toHaveLength(1); // the Stamped event
    const s = decodeStampOf(await read(encodeStampOf(fileHash)));
    expect(s).not.toBeNull();
    expect(s!.by.toLowerCase()).toBe(createAddressFromPrivateKey(keys[1]).toString());
    expect(s!.blockNumber).toBe(Number(height));
    expect(s!.time).toBe(Number(1_790_000_000n + height * 12n));
  });

  it('refuses a second stamp of the same hash, so the first time stands', async () => {
    const before = decodeStampOf(await read(encodeStampOf(fileHash)));
    const r = await send(keys[0], contract, encodeStamp(fileHash));
    expect(r.execResult.exceptionError).toBeDefined();
    const revert = bytesToHex(r.execResult.returnValue);
    expect(revert.slice(2, 10)).toBe(SELECTORS.alreadyStamped);
    expect(decodeAlreadyStamped(revert)?.time).toBe(before!.time);
    expect(decodeStampOf(await read(encodeStampOf(fileHash)))!.by).toBe(before!.by);
  });

  it('refuses the all-zero hash', async () => {
    const r = await send(keys[0], contract, encodeStamp(new Uint8Array(32)));
    expect(bytesToHex(r.execResult.returnValue).slice(2, 10)).toBe(SELECTORS.emptyHash);
  });

  it('keeps different files apart', async () => {
    const other = new Uint8Array(32).fill(9);
    expect(decodeStampOf(await read(encodeStampOf(other)))).toBeNull();
  });
});
