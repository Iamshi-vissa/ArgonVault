// Compiles contracts/ArgonVaultTimestamps.sol with solc-js and writes the ABI and
// bytecode to src/chain/artifact.json, which the app and the tests import.
// Run: npm run compile:contract
import { readFileSync, writeFileSync } from 'node:fs';
import solc from 'solc';

const source = readFileSync(new URL('../contracts/ArgonVaultTimestamps.sol', import.meta.url), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'ArgonVaultTimestamps.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter(e => e.severity === 'error');
for (const e of out.errors ?? []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (errors.length) process.exit(1);

const c = out.contracts['ArgonVaultTimestamps.sol'].ArgonVaultTimestamps;
const artifact = {
  contractName: 'ArgonVaultTimestamps',
  compiler: solc.version(),
  abi: c.abi,
  bytecode: '0x' + c.evm.bytecode.object,
  deployedBytecode: '0x' + c.evm.deployedBytecode.object
};
writeFileSync(new URL('../src/chain/artifact.json', import.meta.url), JSON.stringify(artifact, null, 2) + '\n');
console.log(`Compiled with solc ${solc.version()}: ${(c.evm.bytecode.object.length / 2) | 0} bytes`);
