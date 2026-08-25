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
  await expect(sixth).toHaveAttribute('aria-disabled', 'true');
  await expect(sixth).toHaveAttribute('title', /full/);

  // Inert, not `disabled` — a real click reaches it (Playwright's actionability
  // check treats `aria-disabled` as unavailable, hence `force`), and it does
  // nothing rather than quietly evicting number five.
  await sixth.click({ force: true });
  await expect(page.locator('.task.is-priority')).toHaveCount(5);
  await expect(page.locator('.task', { hasText: 'Six' })).not.toHaveClass(/is-priority/);

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

test('reorders the top five with the arrows', async ({ page }) => {
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

  // Focus is *not* re-armed after a mouse click. The controls are invisible
  // once the pointer leaves the row, so a restored focus here would be a button
  // the user cannot see, which the next Space or Enter would fire. Keyboard
  // repeat is covered by the next test, where focus restoration is wanted.
  await expect(page.locator('[data-control="move-up"]:focus')).toHaveCount(0);

  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [ ] Ship the rollback _(priority 1)_');
  expect(file).toContain('- [ ] Review the checklist _(priority 2)_');
  expect(file).toContain('- [ ] Draft the RFC _(priority 3)_');
});

test('walks a task to the top on repeated keypresses, and stops there', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['One', 'Two', 'Three', 'Four']);
  for (const title of ['One', 'Two', 'Three', 'Four']) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }

  // The keyboard gesture this is for: press once, then keep pressing. Focus is
  // handed back to the same button after each re-render, so Enter repeats it.
  await page.locator('.task', { hasText: 'Four' }).locator('[data-control="move-up"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Four',
    'One',
    'Two',
    'Three',
  ]);

  // A fourth press must do nothing. The arrow goes inert rather than
  // `disabled`, because a disabled button drops focus — and focus used to land
  // on the row's *other* arrow, which sent the task straight back down.
  const row = page.locator('.task', { hasText: 'Four' });
  await expect(row.locator('[data-control="move-up"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(row.locator('[data-control="move-up"]')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Four',
    'One',
    'Two',
    'Three',
  ]);
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

  // And back down again.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Ship the rollback',
    'Draft the RFC',
  ]);
});

test('leaves a bare arrow key alone — the modifier is the gesture', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback', 'Draft the RFC']);
  for (const title of ['Ship the rollback', 'Draft the RFC']) {
    await page.locator('.task', { hasText: title }).locator('.task-priority').click();
  }

  await page.locator('.task', { hasText: 'Draft the RFC' }).locator('.task-toggle').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');

  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Ship the rollback',
    'Draft the RFC',
  ]);
});

test('offers no reorder arrows on an unranked task', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback']);

  // The star is there to rank it with; the arrows only exist once it is ranked,
  // so an unranked day carries no reorder controls at all.
  await expect(page.locator('.task-priority')).toHaveCount(1);
  await expect(page.locator('.task-move')).toHaveCount(0);

  await page.locator('.task-priority').click();
  await expect(page.locator('.task-move')).toHaveCount(2);
});

test('will not rank finished work', async ({ page }) => {
  await startApp(page, { now: new Date(2026, 7, 3, 17, 30) });
  await addTasks(page, ['Ship the rollback']);

  const task = page.locator('.task', { hasText: 'Ship the rollback' });
  await task.locator('.task-toggle').click();
  await task.locator('.task-toggle').click();
  await expect(task).toHaveClass(/is-completed/);

  const star = task.locator('.task-priority');
  await expect(star).toHaveAttribute('aria-disabled', 'true');
  await star.click({ force: true });

  await expect(page.locator('.task.is-priority')).toHaveCount(0);
  expect(await readVaultFile(page, '2026-08-03.md')).not.toContain('priority');
});

test('tidies a hand-edited ranking when the day is opened', async ({ page }) => {
  await startApp(page, {
    now: new Date(2026, 7, 3, 14, 20),
    files: {
      // Ranks a human wrote: sparse, and sitting on work that is already done.
      '2026-08-03.md': dayFile(
        '2026-08-03',
        [
          { title: 'Finished yesterday', marker: 'x', priority: 1 },
          { title: 'Draft the RFC', marker: ' ', priority: 4 },
          { title: 'Ship the rollback', marker: '/', priority: 9 },
        ],
        { lastCheckIn: '13:00' },
      ),
    },
  });

  // Renumbered from 1, the completed task's rank dropped — and the star is
  // offered rather than reporting the top five as full.
  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'Draft the RFC',
    'Ship the rollback',
  ]);
  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2']);
  await expect(
    page.locator('.task', { hasText: 'Draft the RFC' }).locator('[data-control="move-up"]'),
  ).toHaveAttribute('aria-disabled', 'true');

  await page.click('#done');
  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [x] Finished yesterday\n');
  expect(file).toContain('- [ ] Draft the RFC _(priority 1)_');
  expect(file).toContain('- [/] Ship the rollback _(priority 2)_');
});

test('does not re-arm a control the mouse clicked', async ({ page }) => {
  await startApp(page);
  await addTasks(page, ['Ship the rollback']);

  // Clicking the checkbox used to leave it focused-but-invisible across the
  // re-render, so a stray Space or Enter afterwards cycled the task again —
  // silently, in the only copy of the day's notes.
  const task = page.locator('.task', { hasText: 'Ship the rollback' });
  await task.locator('.task-toggle').click();
  await expect(task).toHaveClass(/is-in-progress/);

  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');

  await expect(task).toHaveClass(/is-in-progress/);
  expect(await readVaultFile(page, '2026-08-03.md')).toContain('- [/] Ship the rollback');
});

test('stars one of two near-identical lines, not both', async ({ page }) => {
  // `sameTask` treats these as one task, which is right for "don't add this
  // twice" and wrong for "which row did the user click". Starring by title hit
  // both rows — and because both then took the same next rank, one click
  // consumed two of the five slots.
  await startApp(page, {
    now: new Date(2026, 7, 3, 14, 20),
    files: {
      '2026-08-03.md': dayFile(
        '2026-08-03',
        [
          { title: 'Ship it', marker: ' ' },
          { title: 'ship it', marker: ' ' },
        ],
        { lastCheckIn: '13:00' },
      ),
    },
  });

  const rows = page.locator('.task');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).locator('.task-priority').click();

  await expect(page.locator('.task.is-priority')).toHaveCount(1);
  await expect(page.locator('.task-rank')).toHaveText(['1']);

  await page.click('#done');
  const file = await readVaultFile(page, '2026-08-03.md');
  expect(file).toContain('- [ ] ship it _(priority 1)_');
  expect(file).toContain('- [ ] Ship it\n');
});

test('moves the row it was handed, through a hand-edited sparse ranking', async ({ page }) => {
  // Every rank changes when a sparse file is normalized, so a lookup made
  // after normalizing would be holding stale objects and quietly do nothing.
  await startApp(page, {
    now: new Date(2026, 7, 3, 14, 20),
    files: {
      '2026-08-03.md': dayFile(
        '2026-08-03',
        [
          { title: 'First', marker: ' ', priority: 2 },
          { title: 'Second', marker: ' ', priority: 5 },
          { title: 'Third', marker: ' ', priority: 9 },
        ],
        { lastCheckIn: '13:00' },
      ),
    },
  });

  await expect(page.locator('.task.is-priority .task-rank')).toHaveText(['1', '2', '3']);

  await page.locator('.task', { hasText: 'Third' }).locator('[data-control="move-up"]').click();

  await expect(page.locator('.task.is-priority .task-title')).toHaveText([
    'First',
    'Third',
    'Second',
  ]);
});
