/**
 * Application entry point.
 *
 * Two cadences, kept apart on purpose (the same split the sibling calendar-alert
 * project uses):
 *
 * - **The scheduler tick** is pure arithmetic on a one-minute timer. It decides
 *   whether a check-in is due and touches no disk.
 * - **Vault I/O** happens only in response to something real: a check-in coming
 *   due, or the user adding a task. Every write is serialized through a promise
 *   chain so two edits can never interleave and produce a half-written day file.
 *
 * The window is hidden except while a check-in is up. That's the entire UI
 * surface — everything else the app knows lives in the vault as Markdown.
 */

import { addDays, fromDateKey, startOfIsoWeek, toClock, toDateKey } from './lib/dates.ts';
import { describeError } from './lib/errors.ts';
import { addNote, type DayDocument } from './lib/markdown/day.ts';
import { CONTEXT_DOC, CONTEXT_FILENAME } from './lib/markdown/context-doc.ts';
import { standupSummary, weeklyRollup, weekFileName } from './lib/markdown/rollup.ts';
import {
  describeCheckIn,
  dueCheckIn,
  INITIAL_CHECK_IN_STATE,
  markHandled,
  onDemandSlot,
  restoreCheckInState,
  slotClock,
  snooze,
  SCHEDULER_TICK_MS,
  type CheckInSlot,
  type CheckInState,
} from './lib/schedule.ts';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from './lib/settings.ts';
import {
  addTask,
  cycleStatus,
  removeTask,
  setTaskStatus,
  summarizeTasks,
  type Task,
} from './lib/tasks.ts';
import { formatTrayStatus } from './lib/tray.ts';
import {
  copyToClipboard,
  createVault,
  hideCheckIn,
  loadSettingsJson,
  onCheckInRequested,
  onOpenVaultRequested,
  onStandupRequested,
  openVaultFolder,
  setTrayStatus,
  showCheckIn,
  showError,
} from './lib/tauri.ts';
import {
  openDay,
  previousDayKey,
  listDayKeys,
  readDay,
  readDayRange,
  writeDay,
  type VaultPort,
} from './lib/vault.ts';

/** How long a transient status message stays on the card. */
const STATUS_HOLD_MS = 2_400;

interface Elements {
  card: HTMLElement;
  headline: HTMLElement;
  subhead: HTMLElement;
  taskList: HTMLUListElement;
  emptyState: HTMLElement;
  taskForm: HTMLFormElement;
  taskInput: HTMLInputElement;
  noteForm: HTMLFormElement;
  noteInput: HTMLInputElement;
  done: HTMLButtonElement;
  snooze: HTMLButtonElement;
  copyStandup: HTMLButtonElement;
  status: HTMLElement;
}

/** Resolve a required element or fail loudly at startup. */
function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing required element #${id}`);
  return el as T;
}

function resolveElements(): Elements {
  return {
    card: mustGet('card'),
    headline: mustGet('headline'),
    subhead: mustGet('subhead'),
    taskList: mustGet<HTMLUListElement>('task-list'),
    emptyState: mustGet('empty-state'),
    taskForm: mustGet<HTMLFormElement>('task-form'),
    taskInput: mustGet<HTMLInputElement>('task-input'),
    noteForm: mustGet<HTMLFormElement>('note-form'),
    noteInput: mustGet<HTMLInputElement>('note-input'),
    done: mustGet<HTMLButtonElement>('done'),
    snooze: mustGet<HTMLButtonElement>('snooze'),
    copyStandup: mustGet<HTMLButtonElement>('copy-standup'),
    status: mustGet('status'),
  };
}

class CheckInController {
  private readonly vault: VaultPort;
  private readonly elements: Elements;

  private settings: Settings = { ...DEFAULT_SETTINGS };
  private state: CheckInState = { ...INITIAL_CHECK_IN_STATE };
  /** The day currently loaded in the card, or `null` when nothing is open. */
  private day: DayDocument | null = null;
  /** The slot the open card belongs to, so Done knows what to mark handled. */
  private slot: CheckInSlot | null = null;
  /** `true` while the card is on screen. */
  private visible = false;
  /** `true` between the decision to present and the card actually appearing. */
  private presenting = false;
  /** Last text pushed to the tray, so identical updates aren't re-sent. */
  private lastTrayStatus: string | null = null;
  /**
   * Serializes vault writes. Every save appends to this chain rather than
   * racing, so a fast "add task, add task, Done" can't produce interleaved
   * writes where the second read clobbers the first.
   */
  private writes: Promise<void> = Promise.resolve();
  private statusTimer: number | undefined;

  constructor(vault: VaultPort, elements: Elements) {
    this.vault = vault;
    this.elements = elements;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.elements.taskForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.onAddTask();
    });

    this.elements.noteForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.onAddNote();
    });

    this.elements.done.addEventListener('click', () => {
      void this.finish();
    });

    this.elements.snooze.addEventListener('click', () => {
      void this.onSnooze();
    });

    this.elements.copyStandup.addEventListener('click', () => {
      void this.copyStandup();
    });

    // Esc snoozes; the card is a prompt, not a modal you have to defeat.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void this.onSnooze();
      }
    });
  }

  /** Load settings, publish the agent guide, and arm the scheduler. */
  async start(): Promise<void> {
    await this.loadSettings();

    // Rewritten every launch so it can never drift from the format the app
    // actually writes. Failing here must not stop the app from running.
    try {
      await this.vault.write(CONTEXT_FILENAME, CONTEXT_DOC);
    } catch (error) {
      console.warn('Could not write the vault guide:', describeError(error));
    }

    await this.restoreSchedulerState();
    await this.registerTrayHandlers();
    await this.refreshTrayStatus();

    window.setInterval(() => {
      void this.tick();
    }, SCHEDULER_TICK_MS);

    // Evaluate immediately so launching mid-morning doesn't wait an hour for
    // the first tick to notice an outstanding slot.
    await this.tick();
  }

  /**
   * Recover which check-in was last handled today, from today's day file.
   *
   * The scheduler's state is in-memory, and this app is expected to survive
   * reboots, Windows updates and its own crashes mid-workday. Without this the
   * app would relaunch believing nothing had been handled and immediately
   * re-prompt for a slot the user already completed.
   */
  private async restoreSchedulerState(): Promise<void> {
    try {
      const today = toDateKey(new Date());
      const day = await readDay(this.vault, today, this.settings.workStart, this.settings.workEnd);
      if (day === null) return;

      this.state = restoreCheckInState(today, day.lastCheckIn);
    } catch (error) {
      // Falling back to "nothing handled" costs at most one extra prompt, which
      // is a far better failure than refusing to start.
      console.warn('Could not restore check-in state:', describeError(error));
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const raw = await loadSettingsJson();
      this.settings = raw === null ? { ...DEFAULT_SETTINGS } : parseSettings(JSON.parse(raw));
    } catch (error) {
      // A corrupt settings file must not stop the app from starting.
      console.warn('Falling back to default settings:', describeError(error));
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private async registerTrayHandlers(): Promise<void> {
    await onCheckInRequested(() => {
      void this.openOnDemand();
    });
    await onStandupRequested(() => {
      void this.copyStandup();
    });
    await onOpenVaultRequested(() => {
      void openVaultFolder();
    });
  }

  /** The scheduler cadence: decide whether to interrupt, and do nothing if not. */
  private async tick(): Promise<void> {
    if (this.visible) return;

    // Keep the tray honest even on the many ticks that don't prompt.
    await this.refreshTrayStatus();

    const now = new Date();
    const slot = dueCheckIn(now, this.settings, this.state);
    if (slot === null) return;

    await this.present(slot);
  }

  /**
   * Load the day behind `slot` and bring the card on screen.
   *
   * `presenting` is raised **synchronously**, before the first `await`. The
   * `visible` flag alone is not a sufficient guard: it is only set after the
   * vault read resolves, so a tray "check in now" landing during that read would
   * pass the `visible` check and present a second card over the first. The
   * sibling calendar-alert project shipped exactly this race between its
   * animation and poll paths before adding a mutual-exclusion flag.
   */
  private async present(slot: CheckInSlot): Promise<void> {
    if (this.presenting) return;
    this.presenting = true;

    try {
      this.day = await openDay(
        this.vault,
        slot.date,
        this.settings.workStart,
        this.settings.workEnd,
      );
    } catch (error) {
      await showError('Could not open your journal', describeError(error));
      // Mark the slot handled anyway: re-prompting every minute against a
      // broken vault would be worse than missing one check-in.
      this.state = markHandled(slot);
      return;
    } finally {
      this.presenting = false;
    }

    this.slot = slot;
    this.visible = true;

    this.render();
    await showCheckIn();

    // Let the entrance transition start from the off-stage position before
    // flipping the class, or the card simply appears with no motion.
    requestAnimationFrame(() => {
      this.elements.card.classList.add('is-open');
    });

    this.elements.taskInput.focus();
  }

  /** Tray "Check in now": open the current slot even if it was already handled. */
  private async openOnDemand(): Promise<void> {
    if (this.visible) return;

    await this.present(onDemandSlot(new Date(), this.settings));
  }

  private render(): void {
    const day = this.day;
    const slot = this.slot;
    if (day === null || slot === null) return;

    this.elements.headline.textContent = describeCheckIn(slot.kind);
    this.elements.subhead.textContent = this.describeProgress(day, slot);

    this.elements.taskList.replaceChildren(...day.tasks.map((task) => this.renderTask(task)));
    this.elements.emptyState.hidden = day.tasks.length > 0;
  }

  private describeProgress(day: DayDocument, slot: CheckInSlot): string {
    const summary = summarizeTasks(day.tasks);

    if (slot.kind === 'day-start') {
      return summary.total === 0
        ? "Nothing carried over — what's on today?"
        : `${String(summary.open)} to pick up today`;
    }

    if (slot.kind === 'day-end') {
      return `${String(summary.completed)} done, ${String(summary.open)} still open — plan tomorrow?`;
    }

    return `${String(summary.completed)} of ${String(summary.total)} done`;
  }

  /**
   * Build one task row.
   *
   * Titles go in with `textContent`, never `innerHTML`. The text is the user's
   * own, but it round-trips through a file on disk that other tools (and agents)
   * can write — treating it as markup would be a standing XSS hole for the sake
   * of nothing.
   */
  private renderTask(task: Task): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'task';
    if (task.status === 'in-progress') item.classList.add('is-in-progress');
    if (task.status === 'completed') item.classList.add('is-completed');
    if (task.carriedOver === true) item.classList.add('is-carried');

    const glyphs: Record<Task['status'], string> = {
      upcoming: '',
      'in-progress': '•',
      completed: '✓',
    };

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'task-toggle';
    toggle.textContent = glyphs[task.status];
    toggle.title = `Mark ${cycleStatus(task.status).replace('-', ' ')}`;
    toggle.setAttribute('aria-label', `${task.title} — ${task.status}`);
    toggle.addEventListener('click', () => {
      this.updateTasks(setTaskStatus(this.tasks(), task.title, cycleStatus(task.status)));
    });

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task-remove';
    remove.textContent = '×';
    remove.title = 'Remove task';
    remove.setAttribute('aria-label', `Remove ${task.title}`);
    remove.addEventListener('click', () => {
      this.updateTasks(removeTask(this.tasks(), task.title));
    });

    item.append(toggle, title, remove);
    return item;
  }

  private tasks(): Task[] {
    return this.day?.tasks ?? [];
  }

  private updateTasks(tasks: Task[]): void {
    if (this.day === null) return;

    this.day = { ...this.day, tasks };
    this.render();
    this.save();
  }

  private onAddTask(): void {
    const title = this.elements.taskInput.value;
    if (title.trim() === '') return;

    this.elements.taskInput.value = '';
    this.updateTasks(addTask(this.tasks(), title));
  }

  private onAddNote(): void {
    const text = this.elements.noteInput.value;
    if (text.trim() === '' || this.day === null) return;

    this.elements.noteInput.value = '';
    this.day = addNote(this.day, toClock(new Date()), text);
    this.save();
    this.setStatus('Note saved');
  }

  /**
   * Queue a vault write behind any in flight.
   *
   * Captures `this.day` at call time so a later edit can't retroactively change
   * what this write was supposed to persist.
   */
  private save(): void {
    const day = this.day;
    if (day === null) return;

    this.writes = this.writes
      .then(() => writeDay(this.vault, day))
      .catch(async (error: unknown) => {
        await showError('Could not save your journal', describeError(error));
      });
  }

  /** Done: persist, mark the slot handled, and get out of the way. */
  private async finish(): Promise<void> {
    const slot = this.slot;
    if (slot === null) return;

    // Record the handled slot *in the day file* before saving, so the scheduler
    // can recover it after a reboot. This has to happen before `save()`, which
    // snapshots the document.
    if (this.day !== null) this.day = { ...this.day, lastCheckIn: slotClock(slot) };

    this.save();
    await this.writes;

    await this.refreshRollups(slot);

    this.state = markHandled(slot);
    await this.dismiss();
    await this.refreshTrayStatus();
  }

  private async onSnooze(): Promise<void> {
    if (this.slot === null) return;

    this.save();
    await this.writes;

    this.state = snooze(this.state, new Date(), this.settings);
    await this.dismiss();
  }

  private async dismiss(): Promise<void> {
    this.elements.card.classList.remove('is-open');
    this.visible = false;
    this.slot = null;
    await hideCheckIn();
  }

  /**
   * Keep the weekly rollups current, and heal any the week boundary skipped.
   *
   * The rollup used to be written only at `day-end`, which quietly lost a whole
   * week whenever the last working day didn't get a wrap-up — knock off early on
   * a Friday and that week produced no rollup at all, forever. Since the rollups
   * are what make a year of day files reviewable, a silently missing week is the
   * expensive kind of gap.
   *
   * So: refresh the current week on every check-in (it is derived data and cheap
   * to rebuild), and on the first check-in of a day, also rebuild the previous
   * logged week if that day belongs to a different week. That makes Monday
   * morning repair the Friday nobody closed.
   */
  private async refreshRollups(slot: CheckInSlot): Promise<void> {
    await this.writeRollupForWeekOf(slot.date);

    if (slot.kind !== 'day-start') return;

    try {
      const previous = previousDayKey(await listDayKeys(this.vault), slot.date);
      if (previous === null) return;
      if (weekFileName(previous) === weekFileName(slot.date)) return;

      await this.writeRollupForWeekOf(previous);
    } catch (error) {
      console.warn('Could not heal the previous weekly rollup:', describeError(error));
    }
  }

  /** Regenerate the rollup file for the ISO week containing `date`. */
  private async writeRollupForWeekOf(date: string): Promise<void> {
    const name = weekFileName(date);
    if (name === null) return;

    const slotDate = fromDateKey(date);
    if (slotDate === null) return;

    try {
      const monday = startOfIsoWeek(slotDate);
      const days = await readDayRange(
        this.vault,
        toDateKey(monday),
        toDateKey(addDays(monday, 6)),
        this.settings.workStart,
        this.settings.workEnd,
      );
      await this.vault.write(name, weeklyRollup(days));
    } catch (error) {
      // A rollup is derived data — never let it take down the check-in.
      console.warn('Could not write the weekly rollup:', describeError(error));
    }
  }

  /** Copy a paste-ready standup summary for today. */
  private async copyStandup(): Promise<void> {
    try {
      const today = toDateKey(new Date());
      // Only reuse the cached document if it is actually today's. The app runs
      // overnight, so after midnight `this.day` still holds yesterday — and
      // pasting yesterday's plan into today's standup is exactly the failure
      // this feature exists to prevent.
      const cached = this.day?.date === today ? this.day : null;
      const day =
        cached ??
        (await openDay(this.vault, today, this.settings.workStart, this.settings.workEnd));

      const keys = await listDayKeys(this.vault);
      const previousKey = previousDayKey(keys, today);
      const previous =
        previousKey === null
          ? null
          : await readDay(this.vault, previousKey, this.settings.workStart, this.settings.workEnd);

      await copyToClipboard(standupSummary(day, previous));
      this.setStatus('Standup copied');
    } catch (error) {
      await showError('Could not copy your standup', describeError(error));
    }
  }

  /**
   * Keep the tray menu's status line current.
   *
   * Runs on every scheduler tick, not just at launch and after a check-in.
   * Refreshing only on those two events left the line showing a snapshot that
   * could be hours old — a status that looks broken rather than live, which is
   * the same defect the sibling calendar-alert project fixed in its tray
   * countdown.
   *
   * It reads from the in-memory day when that is today's, and only pushes to the
   * tray when the rendered text actually changed, so a minute-by-minute refresh
   * costs neither a disk read nor a redundant IPC call in the common case.
   */
  private async refreshTrayStatus(): Promise<void> {
    try {
      const today = toDateKey(new Date());
      const day =
        this.day?.date === today
          ? this.day
          : await readDay(this.vault, today, this.settings.workStart, this.settings.workEnd);

      const text = formatTrayStatus(day);
      if (text === this.lastTrayStatus) return;

      this.lastTrayStatus = text;
      await setTrayStatus(text);
    } catch {
      // The tray line is cosmetic; a failure here is not worth a dialog.
    }
  }

  private setStatus(text: string): void {
    this.elements.status.textContent = text;
    this.elements.status.classList.add('is-visible');

    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.elements.status.classList.remove('is-visible');
    }, STATUS_HOLD_MS);
  }
}

const controller = new CheckInController(createVault(), resolveElements());
void controller.start().catch(async (error: unknown) => {
  await showError('Task Tracker failed to start', describeError(error));
});
