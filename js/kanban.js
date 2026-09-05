/* ============================================================
   GMA OS — Канбан: вид-доска для задач.
   Три доски: Приоритет / Теги / Тип. Периоды: Сегодня / 3 дня / Неделя / Всё.
   Переключение: кнопка рядом с поиском (ПК), удержание липкой шапки (мобилка),
   клавиша KeyK. Настройки вида храним локально (localStorage).
   ============================================================ */
import {
  state, visibleTasks, isDone, getTask, getTagsDict, getTagColor, addTagsToDict,
  updateTask, TYPE_LABEL, PRIORITY_LABEL, today, addDays, mondayOf, esc, fmtD,
  hapticLight, hapticMedium,
} from './store.js';
import { openSheet } from './sheet.js';

const $ = id => document.getElementById(id);
const LS_KEY = 'rl_kanban_v1';

/* ── Локальные настройки: доска, период, скрытые тег-колонки ── */
let kb = { view: 'prio', period: 'today', hiddenTags: [], showHidden: false };
try {
  const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  if (s && typeof s === 'object') kb = Object.assign(kb, s);
} catch (e) { /* игнор */ }
const saveKb = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(kb)); } catch (e) {} };

let isOpen = false;
let animBusy = false;
export const kanbanOpen = () => isOpen;

/* ── Период: какие задачи по дням попадают на доску ── */
function periodRange() {
  const t0 = today();
  if (kb.period === 'today') return [t0, t0];
  if (kb.period === '3d') return [addDays(t0, -1), addDays(t0, 1)];
  if (kb.period === 'week') { const ws = mondayOf(t0); return [ws, addDays(ws, 6)]; }
  return null; // «всё»
}
function inPeriod(t) {
  const keys = Object.keys(t.days || {});
  const r = periodRange();
  if (!r) return true;             // «всё» — включая задачи без даты
  if (!keys.length) return false;  // бездатные только в «всё»
  return keys.some(k => k >= r[0] && k <= r[1]);
}

/* ── Сортировка карточек внутри колонки ── */
const firstDay = t => { const k = Object.keys(t.days || {}).sort(); return k[0] || '9999-99-99'; };
const colSort = (a, b) => {
  const da = isDone(a), db = isDone(b);
  if (da !== db) return da ? 1 : -1;
  const fa = firstDay(a), fb = firstDay(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
};

/* ── Колонки текущей доски ── */
function buildColumns() {
  const tasks = visibleTasks().filter(inPeriod);
  if (kb.view === 'prio') {
    return [1, 2, 3].map(p => ({
      kind: 'prio', value: String(p), title: PRIORITY_LABEL[p], prio: p,
      tasks: tasks.filter(t => (t.priority || 2) === p).sort(colSort),
    }));
  }
  if (kb.view === 'type') {
    return Object.keys(TYPE_LABEL).map(tp => ({
      kind: 'type', value: tp, title: TYPE_LABEL[tp],
      tasks: tasks.filter(t => (t.type || 'task') === tp).sort(colSort),
    }));
  }
  /* Теги: словарь минус скрытые + «Без тега» */
  const cols = [];
  for (const tg of getTagsDict()) {
    if (kb.hiddenTags.includes(tg.name)) continue;
    cols.push({
      kind: 'tag', value: tg.name, title: tg.name, color: tg.color, hideable: true,
      tasks: tasks.filter(t => (t.tags || []).includes(tg.name)).sort(colSort),
    });
  }
  if (!kb.hiddenTags.includes('__none')) {
    cols.push({
      kind: 'tag', value: '__none', title: 'Без тега', hideable: true,
      tasks: tasks.filter(t => !(t.tags || []).length).sort(colSort),
    });
  }
  return cols;
}

/* ── HTML карточки и колонки ── */
function metaBits(t) {
  const bits = [];
  if (kb.view !== 'type') bits.push('<span class="kb-type">' + (TYPE_LABEL[t.type || 'task'] || 'Задача') + '</span>');
  if (kb.view !== 'tags') {
    bits.push((t.tags || []).slice(0, 3).map(tg => {
      const c = getTagColor(tg);
      return '<span class="tag-pill"' + (c ? ' style="--tc:' + c + '"' : '') + '>' + esc(tg) + '</span>';
    }).join(''));
  }
  const k = Object.keys(t.days || {}).sort();
  if (k[0]) bits.push('<span class="m-time">📅 ' + fmtD(k[0]) + '</span>');
  return bits.join(' ');
}
function cardHTML(t) {
  return '<div class="kb-card m-' + t.mode + (isDone(t) ? ' done' : '') + '" data-id="' + esc(t.id) + '">' +
    '<i class="prio p' + (t.priority || 2) + '"></i>' +
    '<div class="kb-cbody"><div class="kb-ctitle">' + esc(t.title) + '</div>' +
    '<div class="g-meta">' + metaBits(t) + '</div></div></div>';
}
function colHTML(c) {
  const head =
    (c.color ? '<i class="kb-dot" style="background:' + c.color + '"></i>' : '') +
    (c.kind === 'prio' ? '<i class="prio p' + c.prio + '"></i>' : '') +
    '<span class="kb-col-title">' + esc(c.title) + '</span>' +
    '<span class="kb-count">' + c.tasks.length + '</span>' +
    (c.hideable ? '<button type="button" class="kb-eye" data-hide="' + esc(c.value) + '" title="Скрыть столбик">👁</button>' : '');
  return '<div class="kb-col" data-kind="' + c.kind + '" data-value="' + esc(c.value) + '">' +
    '<div class="kb-col-head">' + head + '</div>' +
    '<div class="kb-col-body">' + c.tasks.map(cardHTML).join('') +
    (c.tasks.length ? '' : '<p class="empty kb-empty">Пусто</p>') + '</div></div>';
}

/* ── Рендер панели ── */
export function renderKanban() {
  const panel = $('kanbanPanel');
  if (!panel || !isOpen) return;
  /* чистим скрытые от умерших тегов */
  const names = getTagsDict().map(t => t.name).concat('__none');
  const hb = kb.hiddenTags.filter(n => names.includes(n));
  if (hb.length !== kb.hiddenTags.length) { kb.hiddenTags = hb; saveKb(); }

  const colsElPrev = panel.querySelector('.kb-cols');
  const scroll = colsElPrev ? colsElPrev.scrollLeft : 0;

  const seg = ['prio', 'tags', 'type'].map(v =>
    '<button type="button" data-view="' + v + '" class="' + (kb.view === v ? 'on' : '') + '">' +
    ({ prio: 'Приоритет', tags: 'Теги', type: 'Тип' })[v] + '</button>').join('');
  const per = ['today', '3d', 'week', 'all'].map(v =>
    '<button type="button" class="chip' + (kb.period === v ? ' on' : '') + '" data-period="' + v + '">' +
    ({ today: 'Сегодня', '3d': '3 дня', week: 'Неделя', all: 'Всё' })[v] + '</button>').join('');
  let actions = '';
  if (kb.view === 'tags') {
    actions += '<button type="button" class="kb-addcol" id="kbAddCol">＋ столбик</button>';
    if (kb.hiddenTags.length) {
      actions += '<button type="button" class="kb-addcol' + (kb.showHidden ? ' on' : '') + '" id="kbHiddenBtn">Скрытые (' + kb.hiddenTags.length + ')</button>';
    }
  }
  let tray = '';
  if (kb.view === 'tags' && kb.showHidden && kb.hiddenTags.length) {
    tray = '<div class="kb-hidden-tray">' + kb.hiddenTags.map(n =>
      '<button type="button" class="chip" data-restore="' + esc(n) + '" title="Вернуть столбик">⟲ ' +
      (n === '__none' ? 'Без тега' : esc(n)) + '</button>').join('') + '</div>';
  }

  panel.innerHTML =
    '<div class="kb-head kb-head-hold" title="Удерживай — сменить вид">' +
      '<div class="kb-row"><div class="kb-seg">' + seg + '</div>' +
      '<div class="kb-periods">' + per + '</div>' + actions + '</div>' + tray +
    '</div>' +
    '<div class="kb-cols">' + buildColumns().map(colHTML).join('') + '</div>';

  /* привязки шапки */
  panel.querySelectorAll('.kb-seg button').forEach(b => b.onclick = () => { kb.view = b.dataset.view; saveKb(); renderKanban(); });
  panel.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { kb.period = b.dataset.period; saveKb(); renderKanban(); });
  const ac = panel.querySelector('#kbAddCol');
  if (ac) ac.onclick = async () => {
    const v = prompt('Название нового тега-столбика:');
    const name = (v || '').trim();
    if (!name) return;
    await addTagsToDict([name]);
    renderKanban();
  };
  const hbBtn = panel.querySelector('#kbHiddenBtn');
  if (hbBtn) hbBtn.onclick = () => { kb.showHidden = !kb.showHidden; saveKb(); renderKanban(); };
  panel.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => {
    kb.hiddenTags = kb.hiddenTags.filter(n => n !== b.dataset.restore);
    saveKb(); renderKanban();
  });
  panel.querySelectorAll('[data-hide]').forEach(b => b.onclick = () => {
    const v = b.dataset.hide;
    if (!kb.hiddenTags.includes(v)) kb.hiddenTags.push(v);
    saveKb(); renderKanban();
  });

  const colsEl = panel.querySelector('.kb-cols');
  if (colsEl) colsEl.scrollLeft = scroll;
}

/* ── Кнопка-переключатель рядом с поиском (создаётся один раз) ── */
const KB_ICON = '<svg viewBox="0 0 24 24"><path d="M4 4h4.6v16H4zM9.7 4h4.6v10h-4.6zM15.4 4H20v7h-4.6z"/></svg>';
function ensureKanbanBtn() {
  let b = $('kanbanBtn');
  if (b) return b;
  const sb = $('searchBtn');
  if (!sb) return null;
  b = document.createElement('button');
  b.type = 'button';
  b.id = 'kanbanBtn';
  b.className = 'icon-btn';
  b.innerHTML = KB_ICON;
  b.title = 'Канбан';
  b.onclick = () => toggleKanbanView();
  sb.parentNode.insertBefore(b, sb);
  return b;
}
function updateBtn() {
  const b = $('kanbanBtn');
  if (!b) return;
  b.classList.toggle('on', isOpen);
  b.title = isOpen ? 'Неделя' : 'Канбан';
}

/* ── Панель канбана (создаётся один раз, сосед #grid) ── */
function ensurePanel() {
  let p = $('kanbanPanel');
  if (p) return p;
  const grid = $('grid');
  if (!grid) return null;
  p = document.createElement('section');
  p.id = 'kanbanPanel';
  p.className = 'pane glass kanban-panel';
  p.hidden = true;
  grid.parentNode.insertBefore(p, grid.nextSibling);
  return p;
}

/* ── Меню видов (мобилка, удержание липкой шапки) ── */
function openViewMenu(anchor) {
  let m = $('viewMenu');
  if (!m) {
    m = document.createElement('div');
    m.id = 'viewMenu';
    m.className = 'cmenu';
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<button type="button" data-v="week" class="' + (!isOpen ? 'on' : '') + '"><span>▦ Неделя</span></button>' +
    '<button type="button" data-v="kanban" class="' + (isOpen ? 'on' : '') + '"><span>▥ Канбан</span></button>';
  m.classList.add('open');
  const r = anchor.getBoundingClientRect();
  const mw = 200, mh = m.offsetHeight || 100;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2), innerWidth - mw - 8);
  let y = r.bottom + 8;
  if (y + mh > innerHeight - 8) y = r.top - mh - 8;
  m.style.left = x + 'px';
  m.style.top = Math.max(8, y) + 'px';
  m.querySelectorAll('button').forEach(b => b.onclick = e => {
    e.stopPropagation();
    m.classList.remove('open');
    const want = b.dataset.v === 'kanban';
    if (want !== isOpen) toggleKanbanView();
  });
  setTimeout(() => {
    const close = e => { if (!m.contains(e.target)) { m.classList.remove('open'); document.removeEventListener('pointerdown', close); } };
    document.addEventListener('pointerdown', close);
  }, 0);
}
/* Удержание липкой шапки (мобилка): неделя ↔ канбан (расширяемо другими видами) */
function bindHoldViewMenu() {
  let t = null, sx = 0, sy = 0;
  document.addEventListener('pointerdown', e => {
    if (!matchMedia('(max-width: 720px)').matches) return;
    const head = e.target.closest('.m-head, .kb-head-hold');
    if (!head) return;
    sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => { t = null; hapticMedium(); openViewMenu(head); }, 450);
  });
  const kill = e => {
    if (!t) return;
    if (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(t); t = null; }
  };
  document.addEventListener('pointermove', kill);
  document.addEventListener('pointerup', kill);
  document.addEventListener('pointercancel', kill);
}

/* ── Drag-and-drop карточек (тач: удержание 220мс, мышь: сразу) ── */
let drag = null; // { id, fromKind, fromValue, ghost, w }
function startDrag(card, x, y) {
  const col = card.closest('.kb-col');
  const ghost = card.cloneNode(true);
  ghost.className = 'kb-card kb-ghost m-' + (getTask(card.dataset.id) || {}).mode;
  ghost.style.width = card.offsetWidth + 'px';
  document.body.appendChild(ghost);
  drag = {
    id: card.dataset.id,
    fromKind: col ? col.dataset.kind : '',
    fromValue: col ? col.dataset.value : '',
    ghost, w: card.offsetWidth,
  };
  card.classList.add('kb-dragging');
  document.body.classList.add('kb-drag');
  moveGhost(x, y);
}
function moveGhost(x, y) {
  if (!drag) return;
  drag.ghost.style.left = (x - drag.w / 2) + 'px';
  drag.ghost.style.top = (y - 30) + 'px';
  /* автопрокрутка ленты колонок и страницы у краёв */
  const panel = $('kanbanPanel');
  const colsEl = panel && panel.querySelector('.kb-cols');
  if (colsEl) {
    const r = colsEl.getBoundingClientRect();
    if (x < r.left + 44) colsEl.scrollLeft -= 14;
    else if (x > r.right - 44) colsEl.scrollLeft += 14;
  }
  const app = $('app');
  if (app) {
    if (y < 70) app.scrollTop -= 10;
    else if (y > innerHeight - 70) app.scrollTop += 10;
  }
  /* подсветка колонки под курсором */
  const under = document.elementFromPoint(x, y);
  const col = under && under.closest ? under.closest('.kb-col') : null;
  document.querySelectorAll('.kb-col.kb-over').forEach(c => { if (c !== col) c.classList.remove('kb-over'); });
  if (col) col.classList.add('kb-over');
}
function endDragVisual() {
  if (!drag) return;
  drag.ghost.remove();
  document.querySelectorAll('.kb-card.kb-dragging').forEach(c => c.classList.remove('kb-dragging'));
  document.querySelectorAll('.kb-col.kb-over').forEach(c => c.classList.remove('kb-over'));
  document.body.classList.remove('kb-drag');
}
async function applyDrop(colEl) {
  const kind = colEl.dataset.kind, value = colEl.dataset.value;
  const t = getTask(drag.id);
  if (!t) return;
  if (kind === 'prio') {
    if (String(t.priority || 2) !== value) await updateTask(t.id, { priority: +value });
  } else if (kind === 'type') {
    if ((t.type || 'task') !== value) await updateTask(t.id, { type: value });
  } else if (kind === 'tag') {
    if (value === drag.fromValue) return;
    let tags = [...(t.tags || [])];
    if (drag.fromValue && drag.fromValue !== '__none') tags = tags.filter(x => x !== drag.fromValue);
    if (value !== '__none') {
      if (!tags.includes(value)) tags.push(value);
      await addTagsToDict([value]);
    }
    await updateTask(t.id, { tags });
  }
  hapticLight();
}
function bindDnD() {
  /* блокируем скролл страницы, пока тащим карточку */
  document.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerdown', e => {
    const card = e.target.closest('.kb-card');
    if (!card || e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY;
    const isMouse = e.pointerType === 'mouse';
    let started = false, cancelled = false, hold = null;
    if (!isMouse) hold = setTimeout(() => { hold = null; started = true; hapticLight(); startDrag(card, sx, sy); }, 220);
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!started) {
        if (isMouse && Math.hypot(dx, dy) > 5) { started = true; startDrag(card, ev.clientX, ev.clientY); }
        else if (!isMouse && Math.hypot(dx, dy) > 10) { cancelled = true; if (hold) { clearTimeout(hold); hold = null; } cleanup(); }
      }
      if (started && drag) moveGhost(ev.clientX, ev.clientY);
    };
    const up = ev => {
      if (hold) { clearTimeout(hold); hold = null; }
      if (started && drag) {
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const col = under && under.closest ? under.closest('.kb-col') : null;
        endDragVisual();
        const d = drag; drag = null;
        if (col) applyDrop(col).then(renderKanban);
        else renderKanban();
      } else if (!cancelled && !started) {
        /* тап — открыть редактор задачи */
        const t = getTask(card.dataset.id);
        if (t) openSheet(t);
      }
      cleanup();
    };
    const cancel = () => { if (hold) clearTimeout(hold); endDragVisual(); drag = null; cleanup(); };
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  });
}

/* ── Переключение вида с анимацией «кирпичики» ── */
const visiblePane = (grid, sel) => { const el = grid.querySelector(sel); return el && el.offsetWidth > 0 ? el : null; };
export async function toggleKanbanView() {
  if (animBusy || state.view !== 'week') return;
  const grid = $('grid'), panel = ensurePanel();
  if (!grid || !panel) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const off = innerWidth + 60;
  const EXIT = { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' };
  if (!isOpen) {
    isOpen = true; updateBtn();
    const left = visiblePane(grid, '.p-left') || visiblePane(grid, '.p-mobile');
    const right = visiblePane(grid, '.p-right');
    if (reduce || (!left && !right)) {
      grid.hidden = true; panel.hidden = false; renderKanban();
      document.dispatchEvent(new CustomEvent('grid-rendered'));
      return;
    }
    animBusy = true;
    const an = [];
    if (left) an.push(left.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-off) + 'px)' }], EXIT));
    if (right) an.push(right.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-off) + 'px)' }], Object.assign({ delay: 120 }, EXIT)));
    await Promise.all(an.map(a => a.finished.catch(() => {})));
    grid.hidden = true;
    panel.hidden = false;
    renderKanban();
    panel.animate([{ transform: 'translateX(' + off + 'px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'cubic-bezier(.32,.72,.28,1)' });
    animBusy = false;
    document.dispatchEvent(new CustomEvent('grid-rendered')); // вернуть поиск/кнопку в топбар
  } else {
    isOpen = false; updateBtn();
    animBusy = true;
    const a = panel.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + off + 'px)' }], EXIT);
    await a.finished.catch(() => {});
    panel.hidden = true; a.cancel();
    grid.hidden = false;
    const left = visiblePane(grid, '.p-left') || visiblePane(grid, '.p-mobile');
    const right = visiblePane(grid, '.p-right');
    const en = { duration: 300, easing: 'cubic-bezier(.32,.72,.28,1)', fill: 'backwards' };
    if (left) left.animate([{ transform: 'translateX(' + (-off) + 'px)' }, { transform: 'translateX(0)' }], en);
    if (right) right.animate([{ transform: 'translateX(' + (-off) + 'px)' }, { transform: 'translateX(0)' }], Object.assign({ delay: 120 }, en));
    animBusy = false;
    document.dispatchEvent(new CustomEvent('grid-rendered')); // вернуть поиск в шапку задач
  }
}
/* Тихое закрытие (например, при переходе в контакты) */
export function kanbanForceClose() {
  if (!isOpen) return;
  isOpen = false;
  const panel = $('kanbanPanel'), grid = $('grid');
  if (panel) panel.hidden = true;
  if (grid) grid.hidden = false;
  updateBtn();
  document.dispatchEvent(new CustomEvent('grid-rendered'));
}

/* ── Инициализация модуля ── */
export function kanbanInit() {
  ensurePanel();
  ensureKanbanBtn();
  bindDnD();
  bindHoldViewMenu();
  updateBtn();
}
