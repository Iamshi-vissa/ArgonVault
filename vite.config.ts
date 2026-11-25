/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Three builds:
 *
 *   npm run build             → dist/              multi-file site for Vercel: hashed, cacheable files, and
 *                                                  a policy with no inline scripts at all
 *   npm run build:standalone  → dist-standalone/   one self-contained HTML file that works offline, even
 *                                                  opened straight from disk (needs inline scripts)
 *   npm run build:artifact    → dist-artifact/     the single file published as a Claude artifact
 *
 * Every policy forbids network connections (connect-src 'none'), so the page
 * cannot send files or passwords anywhere even if a dependency tried.
 * Inline *styles* stay allowed because React style props and several React Bits
 * components set them; inline *scripts* are only allowed in the single-file builds.
 */
const policy = (inlineScripts: boolean) =>
  [
    "default-src 'none'",
    `script-src 'self'${inlineScripts ? " 'unsafe-inline'" : ''} 'wasm-unsafe-eval'`,
    'worker-src blob:',
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ');

export const WEB_POLICY = policy(false);

const csp = (mode: string): Plugin => ({
  name: 'argonvault-csp',
  transformIndexHtml(html) {
    const value = mode === 'production' ? WEB_POLICY : mode === 'standalone' ? policy(true) : '';
    return html.replace('<!--CSP-->', value ? `<meta http-equiv="Content-Security-Policy" content="${value}" />` : '');
  }
});

export default defineConfig(({ mode }) => {
  const single = mode === 'standalone' || mode === 'artifact';
  return {
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : []), csp(mode)],
    worker: { format: 'iife' },
    test: { include: ['test/**/*.test.ts'] },
    build: {
      target: 'es2022',
      outDir: mode === 'artifact' ? 'dist-artifact' : mode === 'standalone' ? 'dist-standalone' : 'dist',
      emptyOutDir: true,
      // The password-strength dictionaries are one large chunk by nature; they load only on the lock page.
      chunkSizeWarningLimit: 2000
    }
  };
});
