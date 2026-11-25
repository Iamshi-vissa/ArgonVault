import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * `npm run build` makes one self-contained HTML file (dist/index.html) that
 * works offline, even opened straight from disk.
 *
 * In the standalone build a Content Security Policy forbids every network
 * connection, so the page cannot send your files or passwords anywhere even
 * if a dependency tried. The artifact build leaves the policy to its host.
 */
const csp = (mode: string): Plugin => ({
  name: 'argonvault-csp',
  transformIndexHtml(html) {
    const policy =
      mode === 'artifact'
        ? ''
        : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'" />`;
    return html.replace('<!--CSP-->', mode === 'development' ? '' : policy);
  }
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), viteSingleFile(), csp(mode)],
  worker: { format: 'iife' },
  build: { target: 'es2022', outDir: mode === 'artifact' ? 'dist-artifact' : 'dist' }
}));
