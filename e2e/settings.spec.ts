/**
 * The settings panel, driven in a real browser.
 *
 * The unit suite already proves the draft model — what it cannot see is whether
 * the controller finds these fourteen elements, whether Save reaches
 * `settings.json`, and whether an edited setting actually changes what the
 * scheduler does next. A panel that renders perfectly and saves nothing passes
 * every other gate in this repo.
 */

import { expect, test } from '@playwright/test';

import { advanceMinutes, dayFile, openSettings, readSettings, startApp } from './harness.ts';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`Uncaught page error: ${error.message}`);
  });
});

test('opens with the settings currently in force', async ({ page }) => {
  await startApp(page, { settings: { workStart: '08:30', workEnd: '16:00', snoozeMinutes: 25 } });
  await openSettings(page);

  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#work-start')).toHaveValue('08:30');
  await expect(page.locator('#work-end')).toHaveValue('16:00');
  await expect(page.locator('#snooze-minutes')).toHaveValue('25');
  await expect(page.locator('#hourly-enabled')).toBeChecked();
});

test('renders one toggle per day, pressed for the working week', async ({ page }) => {
  await startApp(page, { settings: { workDays: [1, 2, 3, 4, 5] } });
  await openSettings(page);

  const toggles = page.locator('.day-toggle');
  await expect(toggles).toHaveCount(7);
  await expect(toggles).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

  // Sunday off, Monday on — the pressed state has to follow getDay() numbering,
  // not the left-to-right position of the buttons.
  await expect(toggles.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(toggles.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(toggles.nth(6)).toHaveAttribute('aria-pressed', 'false');
});

test('saves an edited work window', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  await page.fill('#work-start', '07:45');
  await page.fill('#work-end', '15:30');
  await page.click('#settings-save');

  // The panel closing is the signal that the write resolved.
  await expect(page.locator('#settings')).toBeHidden();

  const settings = await readSettings(page);
  expect(settings).toMatchObject({ workStart: '07:45', workEnd: '15:30' });
});

test('saves a changed working week', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  // Drop Monday, add Saturday: a Tuesday-to-Saturday week.
  await page.locator('.day-toggle').nth(1).click();
  await page.locator('.day-toggle').nth(6).click();
  await expect(page.locator('.day-toggle').nth(1)).toHaveAttribute('aria-pressed', 'false');

  await page.click('#settings-save');
  await expect(page.locator('#settings')).toBeHidden();

  expect(await readSettings(page)).toMatchObject({ workDays: [2, 3, 4, 5, 6] });
});

test('reports a bad value instead of saving it', async ({ page }) => {
  await startApp(page, { settings: { snoozeMinutes: 10 } });
  await openSettings(page);

  await page.fill('#snooze-minutes', '900');
  await page.click('#settings-save');

  // Still open, with a reason, and nothing written.
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#settings-error')).toContainText('between 1 and 60');
  await expect(page.locator('#snooze-minutes')).toHaveClass(/is-invalid/);
  expect(await readSettings(page)).toMatchObject({ snoozeMinutes: 10 });
});

test('refuses a work day that ends before it starts', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  await page.fill('#work-start', '17:00');
  await page.fill('#work-end', '09:00');
  await page.click('#settings-save');

  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#settings-error')).toContainText('end after it starts');
  expect(await readSettings(page)).toMatchObject({ workStart: '09:00', workEnd: '17:00' });
});

test('refuses a week with no working days', async ({ page }) => {
  await startApp(page, { settings: { workDays: [1] } });
  await openSettings(page);

  await page.locator('.day-toggle').nth(1).click();
  await page.click('#settings-save');

  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#settings-error')).toContainText('at least one working day');
  await expect(page.locator('#work-days')).toHaveClass(/is-invalid/);
});

test('clears a reported problem once it is fixed', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  await page.fill('#snooze-minutes', '0');
  await page.click('#settings-save');
  await expect(page.locator('#settings-error')).not.toBeEmpty();

  await page.fill('#snooze-minutes', '15');
  await page.click('#settings-save');

  await expect(page.locator('#settings')).toBeHidden();
  expect(await readSettings(page)).toMatchObject({ snoozeMinutes: 15 });
});

test('Cancel discards edits', async ({ page }) => {
  await startApp(page, { settings: { workStart: '09:00' } });
  await openSettings(page);

  await page.fill('#work-start', '06:00');
  await page.click('#settings-cancel');

  await expect(page.locator('#settings')).toBeHidden();
  expect(await readSettings(page)).toMatchObject({ workStart: '09:00' });

  // Reopening shows the saved value, not the abandoned edit.
  await openSettings(page);
  await expect(page.locator('#work-start')).toHaveValue('09:00');
});

test('Esc closes the panel instead of snoozing the check-in behind it', async ({ page }) => {
  await startApp(page);

  await expect(page.locator('#card')).toHaveClass(/is-open/);
  await openSettings(page);

  await page.keyboard.press('Escape');

  await expect(page.locator('#settings')).toBeHidden();
  // The check-in is still there. Snoozing a card the user never looked at would
  // silently swallow the prompt they opened settings from.
  await expect(page.locator('#card')).toHaveClass(/is-open/);
  await expect(page.locator('#headline')).toHaveText("Here's your day");
});

test('keeps focus out of the card behind the panel', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  // Tab order would otherwise walk into the card, which is in the DOM ahead of
  // the panel — you'd type your next task into a field hidden behind an overlay.
  const focusedWhileOpen = await page.evaluate(() => {
    document.getElementById('task-input')?.focus();
    return document.activeElement?.id ?? '';
  });
  expect(focusedWhileOpen).not.toBe('task-input');

  // And the card is usable again the moment the panel closes.
  await page.keyboard.press('Escape');
  const focusedAfterClose = await page.evaluate(() => {
    document.getElementById('task-input')?.focus();
    return document.activeElement?.id ?? '';
  });
  expect(focusedAfterClose).toBe('task-input');
});

test('shows the vault location', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  // The browser build has no real vault directory; what matters here is that the
  // field is populated at all, since it is filled by an async native call.
  await expect(page.locator('#vault-path')).not.toBeEmpty();
});

test('a saved setting changes what the scheduler does next', async ({ page }) => {
  // The whole point of the panel: this is the assertion that the edit reaches
  // the running scheduler and not just the JSON file.
  await startApp(page);
  await page.click('#done');

  await openSettings(page);
  await page.uncheck('#hourly-enabled');
  await page.click('#settings-save');
  await expect(page.locator('#settings')).toBeHidden();

  // 10:30 → 11:30, comfortably past the 11:00 hourly slot.
  await advanceMinutes(page, 60);

  await expect(page.locator('#card')).not.toHaveClass(/is-open/);
  expect(await readSettings(page)).toMatchObject({ hourlyEnabled: false });
});

test('does not open a check-in on top of the panel', async ({ page }) => {
  // Day-start already handled, so the next thing due is the 11:00 hourly slot.
  await startApp(page, {
    files: { '2026-08-03.md': dayFile('2026-08-03', [], { lastCheckIn: '10:00' }) },
  });
  await expect(page.locator('#card')).not.toHaveClass(/is-open/);

  await openSettings(page);
  await advanceMinutes(page, 60);

  // The slot stays outstanding rather than painting under the panel.
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#card')).not.toHaveClass(/is-open/);

  // And it is served as soon as the panel is out of the way.
  await page.click('#settings-cancel');
  await advanceMinutes(page, 1);
  await expect(page.locator('#card')).toHaveClass(/is-open/);
});

test('reopening after a save shows the saved values', async ({ page }) => {
  await startApp(page);
  await openSettings(page);

  await page.fill('#snooze-minutes', '5');
  await page.uncheck('#hourly-enabled');
  await page.click('#settings-save');
  await expect(page.locator('#settings')).toBeHidden();

  await openSettings(page);
  await expect(page.locator('#snooze-minutes')).toHaveValue('5');
  await expect(page.locator('#hourly-enabled')).not.toBeChecked();
});
