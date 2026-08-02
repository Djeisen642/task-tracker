import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests: the real app, driven in a real browser.
 *
 * The unit suite covers pure logic exhaustively, but nothing in it proves the
 * app *runs* — that `main.ts` finds its elements, that clicking a checkbox is
 * wired to the model, that a finished check-in produces a well-formed day file.
 * A typo in `mustGet('task-list')` passes lint, typecheck, tests and the bundle,
 * and ships a blank window.
 *
 * This is possible only because the frontend is deliberately framework-free and
 * browser-runnable: `tauri.ts` guards every native call behind `isTauri()` and
 * the vault falls back to `localStorage`. So the browser exercises the same
 * controller, the same scheduler and the same Markdown serializer that the
 * desktop build uses — everything except the native shell.
 */
/**
 * Escape hatch for environments that already have a Chromium and can't download
 * Playwright's pinned build — CI images, locked-down networks, container
 * sandboxes. Unset (the normal case) Playwright uses its own managed browser.
 */
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './e2e/.results',

  use: {
    baseURL: 'http://localhost:1430',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The standup summary goes to the clipboard; without this the read-back
    // assertion fails on a permission prompt rather than on real behavior.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(systemChromium === undefined
          ? {}
          : { launchOptions: { executablePath: systemChromium } }),
      },
    },
  ],

  // Reuse a dev server if one is already up, so `npm run dev` in another
  // terminal doubles as the harness during development.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1430',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
