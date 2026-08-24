/**
 * Ranking the day's top five, driven end to end in a browser.
 *
 * The unit suite already proves the renumbering; what only a real run can show
 * is that the star on each row reaches it, that the ranked block leads the list
 * the user actually sees, and that the numbers land in the day file as
 * `_(priority N)_` rather than as some in-memory state that never gets written.
 */

import { expect, test } from '@playwright/test';

import { advanceMinutes, dayFile, readVaultFile, startApp } from './harness.ts';

/** Fail loudly on any uncaught page error — a dead app often logs before it dies. */
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`Uncaught page error: ${error.message}`);
  });
});

/** Add tasks through the card, in the order given. */
async function addTasks(page: import('@playwright/test').Page, titles: string[]): Promise<void> {
  for (const title of titles) {
    await page.fill('#task-input', title);
    await page.press('#task-input', 'Enter');
  }
}

test('ranks tasks in the order they are starred', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Answer the survey', 'Ship the rollback', 'Draft the RFC']);

  await page.locator('.task', { hasText: 'Ship the rollback' }).locator('.task-priority').click();
  await page.locator('.task', { hasText: 'Draft the RFC' }).locator('.task-priority').click();

  // The ranked pair leads the list, in rank order, ahead of the unranked task.
  await expect(page.locator('.task-title')).toHaveText([
    'Ship the rollback',
    'Draft the RFC',
    'Answer the survey',
  ]);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2']);

  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [ ] Ship the rollback _(priority 1)_');
  expect(file).toContain('- [ ] Draft the RFC _(priority 2)_');
  expect(file).toContain('- [ ] Answer the survey\n');
});

test('promotes the rest when the top priority is completed', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback', 'Draft the RFC', 'Answer the survey']);

  for (const title of ['Ship the rollback', 'Draft the RFC', 'Answer the survey']) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }
  await expect(page.locator('.task-rank')).toHaveText(['1', '2', '3']);

  // Two clicks on the checkbox: upcoming → in progress → completed.
  const first = page.locator('.task', { hasText: 'Ship the rollback' });
  await first.locator('.task-toggle').click();
  await first.locator('.task-toggle').click();

  // The finished task drops out of the top five and the gap closes behind it.
  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Draft the RFC',
    'Answer the survey',
  ]);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2']);

  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [x] Ship the rollback\n');
  expect(file).toContain('- [ ] Draft the RFC _(priority 1)_');
  expect(file).toContain('- [ ] Answer the survey _(priority 2)_');
});

test('unranking closes the gap too', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback', 'Draft the RFC']);

  await page.locator('.task', { hasText: 'Ship the rollback' }).locator('.task-priority').click();
  await page.locator('.task', { hasText: 'Draft the RFC' }).locator('.task-priority').click();
  await page.locator('.task', { hasText: 'Ship the rollback' }).locator('.task-priority').click();

  await expect(page.locator('.task.is-priority .task-title')).toHaveText(['Draft the RFC']);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1']);

  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [ ] Draft the RFC _(priority 1)_');
  expect(file).toContain('- [ ] Ship the rollback\n');
});

test('offers no sixth slot once five are ranked', async ({ page }) => {
  await startApp(page);
  const titles = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  await addTasks(page, titles);

  for (const title of titles.slice(0, 5)) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }

  const sixth = page.locator('.task', { hasText: 'Six' }).locator('.task-priority');
  await expect(sixth).toBeDisabled();
  await expect(sixth).toHaveAttribute('title', /full/);

  // And the five that are ranked stay ranked.
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2', '3', '4', '5']);
});

test('a day where nothing is ranked writes no priority annotation', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback', 'Draft the RFC']);

  await expect(page.locator('.task.is-priority')).toHaveCount(0);
  expect(await readVaultFile(page, '2026-08-03.md')).not.toContain('priority');
});

test("carries yesterday's ranking into today, compacted around what got done", async ({ page }) => {
  await startApp(page, {
    files: {
      '2026-07-31.md': dayFile('2026-07-31', [
        { title: 'Ship the rollback', marker: 'x', priority: 1 },
        { title: 'Draft the RFC', marker: '/', priority: 2 },
        { title: 'Review the checklist', marker: ' ', priority: 3 },
        { title: 'Answer the survey', marker: ' ' },
      ]),
    },
  });

  await expect(page.locator('#headline')).toHaveText("Here's your day");
  // The completed number one is left behind in Friday's file; the rest move up.
  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Draft the RFC',
    'Review the checklist',
  ]);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2']);

  // Today's file is written when the check-in is finished, like any other.
  await page.click('#done');

  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [/] Draft the RFC _(priority 1)_ _(added 2026-07-31)_');
  expect(file).toContain('- [ ] Review the checklist _(priority 2)_ _(added 2026-07-31)_');
  expect(file).toContain('- [ ] Answer the survey _(added 2026-07-31)_');
});

test('a rank survives the next check-in of the day', async ({ page }) => {
  await startApp(page, { now: new Date(2026, 7, 3, 10, 0) });

  await addTasks(page, ['Ship the rollback']);
  await page.locator('.task', { hasText: 'Ship the rollback' }).locator('.task-priority').click();
  await page.click('#done');

  await advanceMinutes(page, 61);

  await expect(page.locator('#card')).toHaveClass(/is-open/);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1']);
});

test('reorders the top five with the arrows, keeping focus on the button', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback', 'Draft the RFC', 'Review the checklist']);
  for (const title of ['Ship the rollback', 'Draft the RFC', 'Review the checklist']) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }

  const third = page.locator('.task', { hasText: 'Review the checklist' });
  await third.locator('[data-control="move-up"]').click();

  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Ship the rollback',
    'Review the checklist',
    'Draft the RFC',
  ]);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2', '3']);

  // The button the user just pressed is still under their finger for the next
  // press — the row moved, so the whole list was rebuilt underneath it.
  await expect(
    page.locator('.task', { hasText: 'Review the checklist' }).locator('[data-control="move-up"]'),
  ).toBeFocused();

  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [ ] Ship the rollback _(priority 1)_');
  expect(file).toContain('- [ ] Review the checklist _(priority 2)_');
  expect(file).toContain('- [ ] Draft the RFC _(priority 3)_');
});

test('walks a task to the top with repeated presses', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['One', 'Two', 'Three']);
  for (const title of ['One', 'Two', 'Three']) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }

  const up = () =>
    page.locator('.task', { hasText: 'Three' }).locator('[data-control="move-up"]').click();
  await up();
  await up();

  await expect(page.locator('.task.is-priority .task-title')).toHaveText(['Three', 'One', 'Two']);

  // At the top there is nowhere further to go, and focus lands on the arrow
  // that still works rather than on a disabled button.
  const row = page.locator('.task', { hasText: 'Three' });
  await expect(row.locator('[data-control="move-up"]')).toBeDisabled();
  await expect(row.locator('[data-control="move-down"]')).toBeFocused();
});

test('moves a task with Alt+arrow from the keyboard', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback', 'Draft the RFC']);
  for (const title of ['Ship the rollback', 'Draft the RFC']) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }

  await page.locator('.task', { hasText: 'Draft the RFC' }).locator('.task-toggle').focus();
  await page.keyboard.press('Alt+ArrowUp');

  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Draft the RFC',
    'Ship the rollback',
  ]);
  // Focus followed the row, so a second Alt+↑ would act on the same task.
  await expect(
    page.locator('.task', { hasText: 'Draft the RFC' }).locator('.task-toggle'),
  ).toBeFocused();
});

test('offers no reorder arrows on an unranked task', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback']);

  await expect(page.locator('.task-move')).toHaveCount(0);
});
