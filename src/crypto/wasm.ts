/**
 * Whether this page may compile WebAssembly. A Content Security Policy without
 * 'wasm-unsafe-eval' blocks it; compiling the smallest valid module tells us.
 */
let allowed: boolean | null = null;

export function wasmAllowed(): boolean {
  if (allowed !== null) return allowed;
  try {
    const empty = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    allowed = empty instanceof WebAssembly.Module;
  } catch {
    allowed = false;
  }
  return allowed;
}
