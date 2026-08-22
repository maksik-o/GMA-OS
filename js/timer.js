import { state, getTask, updateTask, hapticLight } from './store.js';

const $ = id => document.getElementById(id);

let activeTimer = null; // { taskId, startedAt, pausedAt, accumulated }
let tickInterval = null;
let pomodoroInterval = null;
let pomodoroCount = 0;
const POMODORO_WORK_MS = 25 * 60 * 1000;
const POMODORO_BREAK_MS = 5 * 60 * 1000;

export function activeFor(taskId) {
  return activeTimer && activeTimer.taskId === taskId;
}

function fmtTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getPill() {
  return $('timerPill');
}

function updatePillUI() {
  const pill = getPill();
  if (!pill) return;

  if (!activeTimer) {
    pill.classList.remove('on');
    return;
  }

  const task = getTask(activeTimer.taskId);
  if (!task) {
    stop();
    return;
  }

  const elapsed = activeTimer.accumulated + (Date.now() - activeTimer.startedAt);
  const titleEl = pill.querySelector('.tp-title');
  const timeEl = pill.querySelector('.tp-time');
  const pomEl = pill.querySelector('.tp-pom');

  if (titleEl) titleEl.textContent = task.title;
  if (timeEl) timeEl.textContent = fmtTime(elapsed);
  if (pomEl) pomEl.textContent = pomodoroCount > 0 ? `🍅 ${pomodoroCount}` : '';
  pill.classList.add('on');
}

function tick() {
  updatePillUI();
  document.dispatchEvent(new CustomEvent('timer-changed'));
}

export function start(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  // Если уже есть активный таймер на другую задачу — останавливаем
  if (activeTimer && activeTimer.taskId !== taskId) {
    stop();
  }

  // Если уже запущен на эту задачу — останавливаем
  if (activeTimer && activeTimer.taskId === taskId) {
    stop();
    return;
  }

  activeTimer = {
    taskId,
    startedAt: Date.now(),
    accumulated: 0,
  };
  pomodoroCount = 0;

  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 1000);

  // Запускаем Pomodoro
  startPomodoro();

  hapticLight();
  tick();
}

function startPomodoro() {
  if (pomodoroInterval) clearInterval(pomodoroInterval);
  pomodoroInterval = setInterval(() => {
    pomodoroCount++;
    updatePillUI();
    // Вибро-сигнал при завершении помидора
    try {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
    } catch (e) {}
  }, POMODORO_WORK_MS);
}

export async function stop() {
  if (!activeTimer) return;

  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (pomodoroInterval) {
    clearInterval(pomodoroInterval);
    pomodoroInterval = null;
  }

  const elapsed = activeTimer.accumulated + (Date.now() - activeTimer.startedAt);
  const elapsedMin = Math.round(elapsed / 60000);
  const task = getTask(activeTimer.taskId);

  if (task && elapsedMin >= 1) {
    const now = new Date();
    const session = {
      date: now.toISOString().slice(0, 10),
      start: now.toISOString().slice(11, 16),
      end: new Date(now.getTime()).toISOString().slice(11, 16),
      min: elapsedMin,
    };
    const sessions = [...(task.sessions || []), session];
    await updateTask(task.id, {
      sessions,
      spentMin: (task.spentMin || 0) + elapsedMin,
    });
  }

  activeTimer = null;
  pomodoroCount = 0;
  updatePillUI();
  document.dispatchEvent(new CustomEvent('timer-changed'));
}

export function timerInit() {
  const pill = getPill();
  if (!pill) {
    console.warn('[timer] timerPill not found in DOM, timer disabled');
    return;
  }

  // Безопасно ищем кнопку stop
  const stopBtn = pill.querySelector('.tp-btn.stop');
  if (stopBtn) {
    stopBtn.onclick = (e) => {
      e.stopPropagation();
      stop();
    };
  }

  // Клик по пилюле — открыть задачу
  pill.onclick = () => {
    if (!activeTimer) return;
    const task = getTask(activeTimer.taskId);
    if (!task) return;
    // Импортируем динамически чтобы избежать циклических зависимостей
    import('./sheet.js').then(({ openSheet }) => openSheet(task));
  };

  // Слушаем изменения state — обновляем UI
  document.addEventListener('sync-done', updatePillUI);
  document.addEventListener('user-change', updatePillUI);
}
