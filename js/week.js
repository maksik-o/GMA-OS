import {
  state, MODES, WEEKDAYS, DAYS_FULL, TYPE_LABEL, MONTHS, MONTHS_FULL,
  addDays, today, isoWeek, iso, parseISO, fmtD, esc, fmtMin, blockEnd,
  tasksForDay, weekRows, getTask, getTagColor, isDone,
  removeTask, setEntry, postponeFrom, setMode,
  toggleSubtask, delSubtask,
} from './store.js';
import { openSheet, refreshBackdrop } from './sheet.js';
import * as hk from './hotkeys.js';
import * as tm from './timer.js';

const $ = id => document.getElementById(id);

const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 20 20"><path d="M10 2v16M4 12l6 6 6-6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const I = {
  todo: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/></svg>',
  started: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/><line x1="6" y1="14" x2="14" y2="6"/></svg>',
  done: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/><line x1="6" y1="11" x2="11" y2="6"/><line x1="7" y1="14" x2="14" y2="7"/><line x1="10" y1="15" x2="15" y2="10"/></svg>',
  skipped: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/><line x1="7" y1="7" x2="13" y2="13"/><line x1="13" y1="7" x2="7" y2="13"/></svg>',
  postponed: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/><line x1="6.5" y1="10" x2="12.5" y2="10"/><polyline points="10,7.5 12.5,10 10,12.5"/></svg>',
  remove: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5" stroke-dasharray="3 3"/><line x1="5" y1="15" x2="15" y2="5"/></svg>'
};

const MENU = [
  ['todo', 'Запланировано', I.todo],
  ['started', 'Начато', I.started],
  ['done', 'Выполнено', I.done],
  ['skipped', 'Пропущено', I.skipped],
  ['postponed', 'Перенесено', I.postponed],
  [null, 'Убрать квадрат', I.remove]
];

let expandedSub = null;

export function closeCellMenu() {
  const m = document.getElementById('cellMenu');
  if (m) m.classList.remove('open');
}

function openCellMenu(cell, id, day) {
  const task = getTask(id);
  if (!task) { closeCellMenu(); return; }

  const cur = (task.days || {})[day] || null;
  const m = $('cellMenu');

  m.innerHTML = MENU.map(([st, label, ic]) =>
    `<button type="button" data-st="${st || ''}" class="${cur === st ? 'on' : ''}">${ic}<span>${label}</span></button>`
  ).join('');

  m.classList.add('open');

  const r = cell.getBoundingClientRect();
  const mw = 200;
  const mh = m.offsetHeight || 240;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2), innerWidth - mw - 8);
  let y = r.bottom + 8;
  if (y + mh > innerHeight - 8) y = r.top - mh - 8;

  m.style.left = x + 'px';
  m.style.top = Math.max(8, y) + 'px';

  m.querySelectorAll('button').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      if (!getTask(id)) { closeCellMenu(); return; }
      setEntry(id, day, b.dataset.st || null).then(() => { closeCellMenu(); renderAll(); });
    };
  });

  setTimeout(() => {
    const close = e => {
      if (!m.contains(e.target)) {
        closeCellMenu();
        document.removeEventListener('pointerdown', close);
      }
    };
    document.addEventListener('pointerdown', close);
  }, 0);
}

let swiped = false;

function weekRangeLabels() {
  const a = state.weekStart, b = addDays(a, 6);
  const da = +a.slice(8), db = +b.slice(8);
  const ma = +a.slice(5, 7), mb = +b.slice(5, 7);
  const short = ma === mb ? `${da}–${db} ${MONTHS[ma - 1]}` : `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]}`;
  const full = ma === mb ? `${da} – ${db} ${MONTHS_FULL[ma - 1]}` : `${da} ${MONTHS_FULL[ma - 1]} – ${db} ${MONTHS_FULL[mb - 1]}`;
  return { full, short };
}

export function shiftWeek(dir) {
  state.weekStart = addDays(state.weekStart, dir * 7);
  renderAll();
}

export function goToday() {
  const d = parseISO(today());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  state.weekStart = iso(d);
  if (dayOpen()) state.day = today();
  renderAll();
}

let _modeBlobInitialized = false;

function renderModes() {
  const el = $('modes');
  if (!el) return;

  if (!el.querySelector('.mode-blob')) {
    const blob = document.createElement('span');
    blob.className = 'mode-blob';
    el.insertBefore(blob, el.firstChild);
  }

  el.querySelectorAll('button').forEach(b => b.remove());

  MODES.forEach(m => {
    const label = m.short
      ? `<span class="m-full">${m.label}</span><span class="m-short">${m.short}</span>`
      : m.label;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.m = m.id;
    b.innerHTML = label;
    if (m.id === state.mode) b.classList.add('on');
    b.onclick = async () => {
      await setMode(m.id);
      renderAll();
    };
    el.appendChild(b);
  });

  updateModeBlob();
}

function updateModeBlob() {
  requestAnimationFrame(() => {
    const el = $('modes');
    if (!el) return;
    const blob = el.querySelector('.mode-blob');
    const active = el.querySelector('button.on');
    if (!blob || !active) {
      if (blob) blob.classList.remove('visible');
      return;
    }

    const elRect = el.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();
    const left = btnRect.left - elRect.left;
    const width = btnRect.width;

    if (!_modeBlobInitialized) {
      blob.style.transition = 'none';
      blob.style.left = left + 'px';
      blob.style.width = width + 'px';
      blob.classList.add('visible');
      blob.offsetHeight;
      blob.style.transition = '';
      _modeBlobInitialized = true;
    } else {
      blob.style.left = left + 'px';
      blob.style.width = width + 'px';
      blob.classList.add('visible');
    }
  });
}

window.addEventListener('resize', updateModeBlob);

function metaHTML(tk) {
  const meta = [];
  if ((tk.subtasks || []).length) {
    const dn = tk.subtasks.filter(s => s.done).length;
    meta.push(`<span class="sub-chip">${dn}/${tk.subtasks.length}</span>`);
  }
  if ((tk.tags || []).length) {
    meta.push(
      tk.tags.slice(0, 2).map(tg => {
        const c = getTagColor(tg);
        return `<span class="tag-pill"${c ? ` style="--tc:${c}"` : ''}>${esc(tg)}</span>`;
      }).join('') + (tk.tags.length > 2 ? `<span class="tag-more">+${tk.tags.length - 2}</span>` : '')
    );
  }
  if (tk.blockStart) meta.push(`<span class="m-time">⏰${tk.blockStart}</span>`);
  if (tk.spentMin) meta.push(`<span class="m-time">⏱${fmtMin(tk.spentMin)}</span>`);
  if (tk.notes && tk.notes.trim()) meta.push('<span class="note-dot" title="Есть заметка"></span>');
  if ((tk.files || []).length) meta.push(`📎${tk.files.length}`);
  return meta.join(' ');
}

function indHTML(tk) {
  const hasSub = (tk.subtasks || []).length > 0;
  return hasSub
    ? `<button type="button" class="sub-arrow p${tk.priority}${expandedSub === tk.id ? ' open' : ''}" data-id="${tk.id}" title="Подзадачи">${ARROW_DOWN}</button>`
    : `<i class="prio p${tk.priority}" title="Приоритет"></i>`;
}

function subPanelHTML(tk) {
  return `<div class="sub-panel glass">${
    (tk.subtasks || []).map(s => `
      <div class="sub-row">
        <button type="button" class="cell sub ${s.done ? 'c-done' : 'c-todo'}" data-subtoggle="${s.id}" title="${s.done ? 'Выполнено' : 'Запланировано'}"></button>
        <span class="sub-text${s.done ? ' done' : ''}">${esc(s.text)}</span>
        <button type="button" class="sub-del" data-subdel="${s.id}" title="Удалить подзадачу">✕</button>
      </div>
    `).join('')
  }</div>`;
}

function headHTML(t) {
  let h = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(state.weekStart, i);
    h += `<button type="button" class="g-hd${d === t ? ' today' : ''}" data-day="${d}" title="Открыть день">${WEEKDAYS[i]}<b>${+d.slice(8)}</b></button>`;
  }
  return h;
}

function leftRowHTML(tk, t) {
  let cells = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(state.weekStart, i);
    const st = (tk.days || {})[d];
    cells += `<button type="button" class="cell ${st ? 'c-' + st : 'none'}${d === t ? ' tdy' : ''}" data-id="${esc(tk.id)}" data-day="${d}" title="${fmtD(d)}">${tk.receivedAt === d ? '<i class="rd"></i>' : ''}</button>`;
  }
  return `<div class="l-row">${cells}</div>`;
}

function rightRowHTML(tk, t) {
  const struck = isDone(tk);
  const run = tm.activeFor(tk.id) ? ' running' : '';
  const hasSub = (tk.subtasks || []).length > 0;
  const sub = (hasSub && expandedSub === tk.id) ? subPanelHTML(tk) : '';

  return `
    <div class="r-row m-${tk.mode}${struck ? ' st-done' : ''}${run}" data-id="${esc(tk.id)}">
      <button type="button" class="swipe-hint hint-done">✓ Выполнено</button>
      <button type="button" class="swipe-hint hint-move">Перенос на завтра →</button>
      ${indHTML(tk)}
      <span class="g-title">${esc(tk.title)}</span>
      <span class="g-meta">${metaHTML(tk)}</span>
      <span class="g-sp"></span>
      <button type="button" class="timer${run ? ' on' : ''}" title="Таймер">${ICON_PLAY}</button>
      ${sub}
    </div>`;
}

function bindSub(scope) {
  scope.querySelectorAll('.sub-arrow').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const id = b.dataset.id;
      expandedSub = expandedSub === id ? null : id;
      renderAll();
    };
  });

  scope.querySelectorAll('[data-subtoggle]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const row = b.closest('[data-id]');
      if (!row) return;
      const taskId = row.dataset.id;
      const task = getTask(taskId);
      if (!task) return;
      toggleSubtask(taskId, b.dataset.subtoggle).then(renderAll);
    };
  });

  scope.querySelectorAll('[data-subdel]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const row = b.closest('[data-id]');
      if (!row) return;
      const taskId = row.dataset.id;
      const task = getTask(taskId);
      if (!task) return;
      delSubtask(taskId, b.dataset.subdel).then(renderAll);
    };
  });
}

function renderGrid() {
  const t = today();
  const rows = weekRows(state.weekStart);
  const leftRows = rows.map(r => leftRowHTML(r, t)).join('');
  const rightRows = rows.map(r => rightRowHTML(r, t)).join('');
  const mobileRows = rows.map(r => `<div class="m-task">${rightRowHTML(r, t)}${leftRowHTML(r, t)}</div>`).join('');

  const empty = `<p class="empty">Пусто — добавьте задачу (кнопка «＋» или клавиша ${hk.pretty(hk.keyFor('new'))})</p>`;

  $('grid').innerHTML = `
    <section class="pane p-left glass">
      <div class="l-head">${headHTML(t)}</div>
      <div>${leftRows}</div>
    </section>
    <section class="pane p-right glass">
      <div class="r-head">Задачи</div>
      <div>${rightRows}</div>
      ${rows.length ? '' : empty}
    </section>
    <section class="pane p-mobile glass">
      <div class="m-head">${headHTML(t)}</div>
      <div>${mobileRows}</div>
      ${rows.length ? '' : empty}
    </section>`;

  $('grid').querySelectorAll('.g-hd').forEach(h => {
    h.onclick = () => openDay(h.dataset.day);
  });

  $('grid').querySelectorAll('.cell:not(.sub)').forEach(bindCell);
  bindSub($('grid'));

  $('grid').querySelectorAll('.r-row').forEach(row => {
    const id = row.dataset.id;
    const tsk = () => getTask(id);

    const timerBtn = row.querySelector('.timer');
    if (timerBtn) {
      timerBtn.onclick = e => {
        e.stopPropagation();
        const task = tsk();
        if (task) tm.start(id);
      };
    }

    bindRowGestures(row, {
      onTap: () => {
        if (!swiped) {
          const task = tsk();
          if (task) openSheet(task);
        }
      },
      onRight: () => {
        const task = tsk();
        if (!task) return;
        const cur = (task.days || {})[today()];
        setEntry(id, today(), cur === 'done' ? 'todo' : 'done').then(renderAll);
      },
      onLeft: () => {
        const task = tsk();
        if (!task) return;
        if ((task.days || {})[today()]) {
          postponeFrom(id, today()).then(renderAll);
        } else {
          setEntry(id, addDays(today(), 1), 'todo').then(renderAll);
        }
      },
      onLong: () => {
        if (confirm('Удалить задачу?')) {
          removeTask(id).then(renderAll);
        }
      }
    });
  });
}

function bindCell(c) {
  const id = c.dataset.id;
  const day = c.dataset.day;
  let lt = null, fired = false, sx = 0, sy = 0;

  const moved = e => Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8;

  c.addEventListener('pointerdown', e => {
    fired = false;
    sx = e.clientX;
    sy = e.clientY;
    lt = setTimeout(() => {
      fired = true;
      try { navigator.vibrate(10); } catch {}
      const task = getTask(id);
      if (task) postponeFrom(id, day).then(renderAll);
    }, 550);
  });

  c.addEventListener('pointermove', e => {
    if (lt && moved(e)) {
      clearTimeout(lt);
      lt = null;
    }
  });

  c.addEventListener('pointerup', e => {
    if (lt) {
      clearTimeout(lt);
      lt = null;
    }
    if (fired) return;
    if (moved(e)) return;
    if (getTask(id)) openCellMenu(c, id, day);
  });

  c.addEventListener('pointercancel', () => {
    if (lt) {
      clearTimeout(lt);
      lt = null;
    }
  });

  c.addEventListener('contextmenu', e => e.preventDefault());
}

(function bindGridSwipe() {
  let sx = 0, sy = 0, active = false;
  const el = $('grid');
  if (!el) return;

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.target.closest('.r-row')) {
      active = false;
      return;
    }
    active = true;
    sx = e.clientX;
    sy = e.clientY;
  });

  el.addEventListener('pointerup', e => {
    if (!active) return;
    active = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
      swiped = true;
      collapseRevealed();
      shiftWeek(dx < 0 ? 1 : -1);
      setTimeout(() => { swiped = false; }, 60);
    }
  });
})();

let revealedRow = null;

function collapseRevealed() {
  if (revealedRow) {
    revealedRow.classList.remove('rev-done', 'rev-move');
    revealedRow = null;
  }
}

function bindRowGestures(row, acts) {
  let sx = 0, sy = 0, dx = 0, dragging = false, longTimer = null, fired = false;

  row.addEventListener('contextmenu', e => e.preventDefault());

  row.querySelectorAll('.swipe-hint').forEach(h => {
    h.onclick = e => {
      e.stopPropagation();
      collapseRevealed();
      if (h.classList.contains('hint-done')) acts.onRight();
      else acts.onLeft();
    };
  });

  row.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    if (revealedRow === row) {
      collapseRevealed();
      fired = true;
      return;
    }
    collapseRevealed();
    sx = e.clientX;
    sy = e.clientY;
    dx = 0;
    dragging = false;
    fired = false;

    longTimer = setTimeout(() => {
      longTimer = null;
      if (!dragging) {
        fired = true;
        try { navigator.vibrate(10); } catch {}
        acts.onLong();
      }
    }, 550);
  });

  row.addEventListener('pointermove', e => {
    if (!longTimer && !dragging) return;
    const ddx = e.clientX - sx;
    const ddy = e.clientY - sy;

    if (!dragging) {
      if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy)) {
        dragging = true;
        if (longTimer) {
          clearTimeout(longTimer);
          longTimer = null;
        }
        row.classList.add('swiping');
      } else if (Math.abs(ddy) > 8) {
        if (longTimer) {
          clearTimeout(longTimer);
          longTimer = null;
        }
        return;
      }
    }

    if (dragging) {
      const s = Math.sign(ddx);
      const a = Math.abs(ddx);
      dx = s * Math.min(120, a <= 60 ? a : 60 + (a - 60) * 0.35);
      row.style.transform = `translateX(${dx}px)`;
      row.classList.toggle('to-done', dx > 24);
      row.classList.toggle('to-move', dx < -24);
    }
  });

  const end = () => {
    if (longTimer) {
      clearTimeout(longTimer);
      longTimer = null;
    }
    if (dragging) {
      row.classList.remove('swiping', 'to-done', 'to-move');
      row.style.transform = '';
      if (dx >= 90) {
        fired = true;
        acts.onRight();
      } else if (dx <= -90) {
        fired = true;
        acts.onLeft();
      } else if (dx >= 24) {
        fired = true;
        row.classList.add('rev-done');
        revealedRow = row;
      } else if (dx <= -24) {
        fired = true;
        row.classList.add('rev-move');
        revealedRow = row;
      }
    }
    dragging = false;
    dx = 0;
  };

  row.addEventListener('pointerup', e => {
    end();
    const tx = Math.abs(e.clientX - sx);
    const ty = Math.abs(e.clientY - sy);
    if (!fired && !e.target.closest('button') && tx <= 8 && ty <= 8) {
      acts.onTap();
    }
  });

  row.addEventListener('pointercancel', end);
}

export const dayOpen = () => {
  const el = document.getElementById('daySheet');
  return el && el.classList.contains('open');
};

export function openDay(day) {
  state.day = day;
  const el = document.getElementById('daySheet');
  if (el) el.classList.add('open');
  refreshBackdrop();
  renderDaySheet();
}

export function closeDay() {
  const el = document.getElementById('daySheet');
  if (el) {
    el.classList.remove('open', 'drag');
    el.style.transform = '';
  }
  refreshBackdrop();
}

/* ── Карточка задачи внутри панели «Открыть день» ── */
function dayTaskHTML(t, day) {
  const st = (t.days || {})[day] || 'todo';
  const run = tm.activeFor(t.id) ? ' running' : '';
  const hasSub = (t.subtasks || []).length > 0;
  const sub = (hasSub && expandedSub === t.id) ? subPanelHTML(t) : '';
  const doneClass = isDone(t) ? ' task-done' : '';

  return `
    <li class="task m-${t.mode} st-${st}${run}${doneClass}" data-id="${esc(t.id)}">
      <button type="button" class="status"></button>
      ${indHTML(t)}
      <div class="t-body">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">${metaHTML(t) ? metaHTML(t) + ' · ' : ''}${TYPE_LABEL[t.type] || 'Задача'}${t.blockStart ? ` · ⏰ ${t.blockStart}–${blockEnd(t)}` : ''}</div>
      </div>
      ${sub}
    </li>`;
}

/* ── Панель «Открыть день»: задачи разделены на запланированные (сверху) и выполненные (снизу) ── */
export function renderDaySheet() {
  const day = state.day;
  const titleEl = $('daySheetTitle');
  if (titleEl) {
    titleEl.textContent = `${DAYS_FULL[(parseISO(day).getDay() + 6) % 7]}, ${fmtD(day)}${day === today() ? ' · сегодня' : ''}`;
  }

  const list = tasksForDay(day);
  const active = list.filter(t => !isDone(t));
  const done = list.filter(t => isDone(t));

  const blocked = active.filter(t => t.blockStart).sort((a, b) => a.blockStart.localeCompare(b.blockStart));
  const restActive = active.filter(t => !t.blockStart);

  let html = '';

  // Сверху — активные/запланированные
  if (blocked.length) {
    html += '<li class="grp">Тайм-блоки</li>' + blocked.map(t => dayTaskHTML(t, day)).join('');
  }
  if (restActive.length) {
    if (blocked.length) {
      html += '<li class="grp">Задачи</li>';
    } else {
      html += '<li class="grp">Запланировано</li>';
    }
    html += restActive.map(t => dayTaskHTML(t, day)).join('');
  }

  // Снизу — выполненные (приглушённый заголовок)
  if (done.length) {
    html += '<li class="grp grp-done">Выполнено</li>';
    html += done.map(t => dayTaskHTML(t, day)).join('');
  }

  const listEl = $('daySheetList');
  const emptyEl = $('daySheetEmpty');
  if (listEl) listEl.innerHTML = html;
  if (emptyEl) emptyEl.hidden = list.length > 0;

  if (listEl) bindSub(listEl);

  if (listEl) {
    listEl.querySelectorAll('.task').forEach(row => {
      const id = row.dataset.id;
      const t = () => getTask(id);
      const cur = () => {
        const task = t();
        return task ? (task.days || {})[day] : null;
      };

      const statusBtn = row.querySelector('.status');
      if (statusBtn) {
        statusBtn.onclick = e => {
          e.stopPropagation();
          openCellMenu(e.currentTarget, id, day);
        };
      }

      bindRowGestures(row, {
        onTap: () => {
          const task = t();
          if (task) openSheet(task);
        },
        onRight: () => {
          const c = cur();
          if (c !== null) setEntry(id, day, c === 'done' ? 'todo' : 'done').then(renderAll);
        },
        onLeft: () => {
          const task = t();
          if (task) postponeFrom(id, day).then(renderAll);
        },
        onLong: () => {
          if (confirm('Удалить задачу?')) {
            removeTask(id).then(renderAll);
          }
        }
      });
    });
  }
}

const dayCloseBtn = document.getElementById('dayClose');
if (dayCloseBtn) dayCloseBtn.onclick = closeDay;

export function renderAll() {
  closeCellMenu();
  collapseRevealed();
  document.documentElement.dataset.mode = state.mode;
  const { full, short } = weekRangeLabels();
  const wl = $('weekLabel');
  if (wl) {
    wl.innerHTML = `<span class="wl-num">Неделя ${isoWeek(state.weekStart)} · </span><span class="wl-full">${full}</span><span class="wl-short">${short}</span>`;
  }
  renderModes();
  renderGrid();
  if (dayOpen()) renderDaySheet();
}
