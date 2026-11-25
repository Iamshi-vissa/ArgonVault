import { expect, test, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'argonvault-e2e-'));
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function tempFile(name: string, bytes: Buffer) {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

/** Console errors, ignoring the one Chrome logs when there's no GPU for the WebGPU shards. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/adapter/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function holdToLock(page: Page) {
  const button = page.locator('.hold');
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1350);
  await page.mouse.up();
}

async function lockFile(page: Page, path: string) {
  await page.goto('/#lock');
  await page.locator('.drop input').setInputFiles(path);
  await page.getByRole('button', { name: 'Suggest a passphrase' }).click();
  const password = await page.locator('#pw').inputValue();
  await holdToLock(page);
  await expect(page.getByText('File locked')).toBeVisible({ timeout: 60_000 });
  return password;
}

async function saveDownload(page: Page, name: RegExp | string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const d = await download;
  const out = join(dir, `${Date.now()}-${d.suggestedFilename()}`);
  await d.saveAs(out);
  return { path: out, name: d.suggestedFilename() };
}

test('landing page: first screen is the hero, cards lead to the tool', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.wordmark')).toBeVisible();
  const aboutTop = await page.locator('#about').evaluate(e => e.getBoundingClientRect().top);
  expect(aboutTop).toBeGreaterThanOrEqual((page.viewportSize()?.height ?? 0) - 1);
  await page.locator('a.choice.unlock').click();
  await expect(page).toHaveURL(/#unlock$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Open something locked' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('lock then unlock restores the exact file; wrong password and tampering are refused', async ({ page }) => {
  const errors = watchErrors(page);
  const original = randomBytes(1_500_000);
  const password = await lockFile(page, tempFile('report.pdf', original));
  const seal = await page.locator('.seal').getAttribute('aria-label');
  const locked = await saveDownload(page, 'Save locked file');
  expect(locked.name).toBe('report.pdf.argonvault');

  await page.goto('/#unlock');
  await page.locator('.drop input').setInputFiles(locked.path);
  await page.locator('#pw').fill('definitely not it');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.err')).toContainText('doesn’t open this file', { timeout: 60_000 });

  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('File unlocked')).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('.seal').getAttribute('aria-label')).toBe(seal);
  const restored = await saveDownload(page, /^Save report\.pdf/);
  expect(restored.name).toBe('report.pdf');
  expect(readFileSync(restored.path).equals(original)).toBe(true);

  // Flip one byte in the middle of the locked file.
  const tampered = readFileSync(locked.path);
  tampered[tampered.length >> 1] ^= 1;
  await page.getByRole('button', { name: 'Open another' }).click();
  await page.locator('.drop input').setInputFiles(tempFile('tampered.argonvault', tampered));
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.err')).toContainText('changed or damaged', { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('notes lock to text and open from pasted text', async ({ page }) => {
  await page.goto('/#lock');
  await page.getByRole('radio', { name: 'A note' }).click();
  await page.locator('textarea').fill('Gate code 4471.\nSpare key with Meera.');
  await page.getByRole('button', { name: 'Suggest a passphrase' }).click();
  const password = await page.locator('#pw').inputValue();
  await holdToLock(page);
  await expect(page.getByText('Note locked')).toBeVisible({ timeout: 60_000 });
  const armored = await page.locator('pre.armor').innerText();
  expect(armored).toContain('BEGIN ARGONVAULT LOCKED NOTE');

  await page.locator('.bar .modes').getByRole('radio', { name: 'Unlock', exact: true }).click();
  await page.getByRole('radio', { name: 'Pasted text' }).click();
  await page.locator('textarea').fill(armored);
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Note unlocked')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.note-out')).toContainText('Spare key with Meera.');
});

test('large files stream straight to disk and back (File System Access, mocked onto OPFS)', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as unknown as { __ARGONVAULT_TEST__: object }).__ARGONVAULT_TEST__ = { streamFrom: 1024 * 1024 };
    let n = 0;
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(`out-${++n}`, { create: true });
    };
  });
  const original = randomBytes(3_200_000);
  const password = await lockFile(page, tempFile('big.bin', original));
  await expect(page.getByText('Saved straight to the file you chose')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save locked file' })).toHaveCount(0);

  // Read the streamed locked file back out of OPFS and open it (streamed again).
  const lockedB64 = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const f = await (await root.getFileHandle('out-1')).getFile();
    const bytes = new Uint8Array(await f.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const lockedPath = tempFile('big.bin.argonvault', Buffer.from(lockedB64, 'base64'));
  await page.goto('/#unlock');
  await page.locator('.drop input').setInputFiles(lockedPath);
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('File unlocked')).toBeVisible({ timeout: 60_000 });
  const restoredHash = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const f = await (await root.getFileHandle('out-2')).getFile();
    const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  });
  expect(restoredHash).toBe(sha256(original));
});

test('Back returns to the landing page, even after switching Lock and Unlock', async ({ page }) => {
  await page.goto('/');
  await page.locator('a.choice.lock').click();
  await page.locator('.bar .modes').getByRole('radio', { name: 'Unlock', exact: true }).click();
  await page.locator('.bar .modes').getByRole('radio', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.choices')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test('blockchain timestamp: stamps the SHA-256 of the locked file and finds it again (mock wallet)', async ({
  page
}) => {
  const contract = '0x' + 'ab'.repeat(20);
  await page.addInitScript(addr => {
    localStorage.setItem('argonvault.stampContract', addr);
    const stamps = new Map<string, string>();
    const sent: string[] = [];
    (window as unknown as { __sent: string[] }).__sent = sent;
    const word = (n: number) => n.toString(16).padStart(64, '0');
    (window as unknown as { ethereum: unknown }).ethereum = {
      async request({ method, params }: { method: string; params?: { data: string }[] }) {
        switch (method) {
          case 'eth_requestAccounts':
            return ['0x' + '12'.repeat(20)];
          case 'eth_chainId':
            return '0xaa36a7';
          case 'eth_call': {
            const hash = params![0].data.slice(10);
            return stamps.get(hash) ?? '0x' + word(0) + word(0) + word(0);
          }
          case 'eth_sendTransaction': {
            const data = params![0].data;
            sent.push(data);
            stamps.set(data.slice(10), '0x' + word(1_795_600_000) + word(7_123_456) + '0'.repeat(24) + '12'.repeat(20));
            return '0x' + 'cd'.repeat(32);
          }
          case 'eth_getTransactionReceipt':
            return { status: '0x1', blockNumber: '0x6cb340' };
          default:
            throw new Error('unexpected ' + method);
        }
      }
    };
  }, contract);

  const original = randomBytes(40_000);
  const password = await lockFile(page, tempFile('deed.pdf', original));
  const locked = await saveDownload(page, 'Save locked file');
  await page.getByRole('button', { name: 'Timestamp with my wallet' }).click();
  await expect(page.locator('.stamp-ok')).toContainText('block 7,123,456');
  const sent = await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);
  expect(sent).toHaveLength(1);
  expect(sent[0].slice(10)).toBe(sha256(readFileSync(locked.path)));

  await page.goto('/#unlock');
  await page.locator('.drop input').setInputFiles(locked.path);
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('File unlocked')).toBeVisible({ timeout: 60_000 });
  // Same page session, so the mock wallet still remembers the stamp.
  await page.getByRole('button', { name: 'Check the timestamp' }).click();
  await expect(page.locator('.stamp-ok')).toContainText('block 7,123,456');
});

test('benchmark measures this device', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/#details');
  await page.getByRole('button', { name: 'Measure this device' }).click();
  await expect(page.locator('.bench-table')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.bench-table')).toContainText('MB/s');
});
