import {
  init, state, addDays, today, MODES,
  getTagsDict, addTagsToDict, setTagColor, renameTag, deleteTag,
  loadModeColors, getModeColors, setModeColor, resetModeColors, getDefaultModeColors,
  subscribe, getTimeAtmosphere, checkDayRollover,
  setModeLabel, resetModeLabel, resetAllModeLabels,
} from './store.js';
import { renderAll, shiftWeek, goToday, dayOpen, openDay, closeDay, closeCellMenu, refreshRunning } from './week.js';
import { openSheet, closeSheet, sheetOpen, refreshBackdrop } from './sheet.js';
import { syncInit, syncNow, renderSyncPanel } from './sync.js';
import { searchInit, openSearch, closeSearch, searchOpen } from './search.js';
import { dbGetKV, dbSetKV } from './db.js';
import * as hk from './hotkeys.js';
import { timerInit } from './timer.js';
import { init as contactsInit, renderContactsView, contactsSubscribe } from './contacts.js';
import { init as notesInit } from './notes.js';
import { focusInit } from './focus.js';
import { widgetsInit, openWidgetsPanel } from './widgets.js';

const $ = id => document.getElementById(id);

/* ── ТЕМЫ: 5 обоев + 10 однотонных/градиентных ── */
const THEMES = [
  { id: 'sky',       label: 'Небо',    img: 'images/sky.jpg',       surf: 'light', tint: '#2563eb', bg: '#cfdcf2' },
  { id: 'sunset',    label: 'Закат',   img: 'images/sunset.jpg',    surf: 'dark',  tint: '#fb7185', bg: '#2b1024' },
  { id: 'waves',     label: 'Волны',   img: 'images/waves.jpg',     surf: 'dark',  tint: '#60a5fa', bg: '#0a1428' },
  { id: 'mountains', label: 'Горы',    img: 'images/mountains.jpg', surf: 'light', tint: '#16a34a', bg: '#e2f0d9' },
  { id: 'winter',    label: 'Зима',    img: 'images/winter.jpg',    surf: 'light', tint: '#64748b', bg: '#e9eef2' },
  { id: 'light',  label: 'Светлая', surf: 'light', tint: '#38bdf8', bg: '#eef2f7' },
  { id: 'dark',   label: 'Тёмная',  surf: 'dark',  tint: '#6366f1', bg: '#0b1220' },
  { id: 'ocean',  label: 'Океан',   surf: 'dark',  tint: '#22d3ee', bg: 'linear-gradient(135deg,#062b3a,#0a4d68)' },
  { id: 'amber',  label: 'Янтарь',  surf: 'light', tint: '#f59e0b', bg: 'linear-gradient(135deg,#fff7e6,#ffe0b3)' },
  { id: 'lava',   label: 'Лава',    surf: 'dark',  tint: '#ef4444', bg: 'linear-gradient(135deg,#1a0505,#7f1d1d)' },
  { id: 'plum',   label: 'Слива',   surf: 'dark',  tint: '#e879f9', bg: 'linear-gradient(135deg,#221129,#4a1d5f)' },
  { id: 'forest', label: 'Лес',     surf: 'dark',  tint: '#4ade80', bg: 'linear-gradient(135deg,#0f2417,#1a4028)' },
  { id: 'nord',   label: 'Nord',    surf: 'dark',  tint: '#88c0d0', bg: '#2e3440' },
  { id: 'paper',  label: 'Бумага',  surf: 'light', tint: '#d4a574', bg: '#f5f1e8' },
  { id: 'aurora', label: 'Аврора',  surf: 'dark',  tint: '#34d399', bg: 'linear-gradient(135deg,#003b3a,#006d77,#8b5cf6)' },
];
const BG_GRADIENT_PRESETS = [
  { id: 'sunset-grad', c: 'linear-gradient(135deg,#ff6b6b,#feca57,#48dbfb)' },
  { id: 'ocean-grad', c: 'linear-gradient(135deg,#667eea,#764ba2)' },
  { id: 'forest-grad', c: 'linear-gradient(135deg,#134e5e,#71b280)' },
  { id: 'aurora-grad', c: 'linear-gradient(135deg,#a8edea,#fed6e3)' },
  { id: 'night-grad', c: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
  { id: 'candy-grad', c: 'linear-gradient(135deg,#ff9a9e,#fecfef,#fecfef)' },
];
const BG_PRESETS = ['#eef2f7', '#f8e8d4', '#0b1220', '#04222e', '#221129', '#101c10'];
const FONTS = [{ id: 's', label: 'S' }, { id: 'm', label: 'M' }, { id: 'l', label: 'L' }];
const TAG_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#2563eb', '#8b5cf6', '#ec4899'];

let storedTheme = 'sky';
let storedBg = '';
let storedBgImage = '';
let storedBgOpacity = 0.3;
let storedPanelAlpha = null; // null = дефолт поверхности
let storedFont = 'm';

const isDark = hex => {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
};
const currentTheme = () => THEMES.find(t => t.id === storedTheme) || THEMES[0];

function applyPanelAlpha() {
  const def = document.body.dataset.surf === 'dark' ? 0.35 : 0.45;
  const v = storedPanelAlpha == null ? def : storedPanelAlpha;
  const r = document.documentElement.style;
  r.setProperty('--panel-a', v);        // прозрачность стекла/карточек
  r.setProperty('--panel-blur-k', v);   // блюр привязан к прозрачности, как было
  const s = $('panelOpacitySlider');
  if (s) { s.min = 0; s.max = 1; s.value = v; }
  const l = $('panelOpacityLabel');
  if (l) l.textContent = Math.round(v * 100) + '%';
}
async function setPanelAlpha(v) {
  storedPanelAlpha = v;
  await dbSetKV('panelAlpha', v);
  applyPanelAlpha();
}
function applyTheme() {
  const th = THEMES.find(t => t.id === storedTheme) || THEMES[0];
  document.documentElement.dataset.theme = th.id;
  if (storedBg) {
    document.documentElement.style.setProperty('--bg', storedBg);
    document.body.dataset.surf = isDark(storedBg) ? 'dark' : 'light';
  } else {
    document.documentElement.style.removeProperty('--bg');
    document.body.dataset.surf = th.surf;
  }
  applyPanelAlpha();
  applyBgImage(); // тема ставит и обои
  requestAnimationFrame(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || th.bg;
  });
}
function applyBgImage() {
  const th = THEMES.find(t => t.id === storedTheme) || THEMES[0];
  const img = storedBgImage || th.img || ''; // своя картинка → иначе обои темы
  document.documentElement.style.setProperty('--bg-image', img ? `url(${img})` : 'none');
  document.documentElement.style.setProperty('--bg-image-opacity', storedBgOpacity);
}
function applyFont() { document.body.dataset.font = storedFont; }
function updateTimeAtmosphere() {
  document.documentElement.style.setProperty('--time-atmosphere', getTimeAtmosphere());
}

function closeTagColorMenu() { const m = $('tagColorMenu'); if (m) m.classList.remove('open'); }
function openTagColorMenu(anchor, t) {
  const m = $('tagColorMenu');
  if (!m) return;
  m.innerHTML = '<div class="tc-row">' + TAG_COLORS.map(c => '<button type="button" class="tc-dot' + (t.color === c ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>').join('') + '</div><div class="tc-row"><input type="color" class="tc-input" value="' + (/^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#ec4899') + '"><span class="tc-label">свой цвет</span></div>';
  m.classList.add('open');
  const r = anchor.getBoundingClientRect();
  const mw = 200;
  const mh = m.offsetHeight || 96;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2), innerWidth - mw - 8);
  let y = r.bottom + 8;
  if (y + mh > innerHeight - 8) y = r.top - mh - 8;
  m.style.left = x + 'px';
  m.style.top = Math.max(8, y) + 'px';
  m.querySelectorAll('.tc-dot').forEach(d => {
    d.onclick = async () => {
      await setTagColor(t.name, d.dataset.c);
      closeTagColorMenu();
      renderTagsPanel();
      renderCurrent();
    };
  });
  const ci = m.querySelector('.tc-input');
  if (ci) {
    ci.onchange = async e => {
      await setTagColor(t.name, e.target.value);
      closeTagColorMenu();
      renderTagsPanel();
      renderCurrent();
    };
  }
  setTimeout(() => {
    const close = e => {
      if (!m.contains(e.target) && !anchor.contains(e.target)) {
        closeTagColorMenu();
        document.removeEventListener('pointerdown', close);
      }
    };
    document.addEventListener('pointerdown', close);
  }, 0);
}

async function setBg(c) { storedBg = c; await dbSetKV('bg', c); applyTheme(); renderLookPanel(); }
async function setFont(id) {
  if (!FONTS.some(f => f.id === id)) return;
  storedFont = id;
  await dbSetKV('fontSize', id);
  applyFont();
  renderLookPanel();
}
async function handleBgImageUpload(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Выберите изображение'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    storedBgImage = e.target.result;
    await dbSetKV('bgImage', storedBgImage);
    applyBgImage();
    renderLookPanel();
  };
  reader.readAsDataURL(file);
}
async function clearBgImage() {
  storedBgImage = '';
  await dbSetKV('bgImage', '');
  applyBgImage();
  renderLookPanel();
}
async function setBgOpacity(val) {
  storedBgOpacity = parseFloat(val);
  await dbSetKV('bgOpacity', storedBgOpacity);
  applyBgImage();
  const label = $('bgOpacityLabel');
  if (label) label.textContent = Math.round(storedBgOpacity * 100) + '%';
}

function renderLookPanel() {
  const row = $('themeRow');
  if (row) {
    row.innerHTML = '';
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-dot' + (t.id === storedTheme ? ' on' : '');
      b.title = t.label;
      b.style.background = t.bg;
      if (t.img) {
        const pre = new Image();
        pre.onload = () => { b.style.background = `url(${t.img}) center/cover`; };
        pre.src = t.img;
      }
      b.onclick = async () => {
        storedTheme = t.id;
        await dbSetKV('theme', t.id);
        if (t.img) { // тема с обоями → обои на 100%
          storedBgOpacity = 1;
          await dbSetKV('bgOpacity', 1);
        }
        applyTheme();
        renderLookPanel();
      };
      row.appendChild(b);
    }
  }
  const bgRow = $('bgRow');
  if (bgRow) {
    bgRow.innerHTML = '';
    for (const c of BG_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bg-dot' + (storedBg === c ? ' on' : '');
      b.title = c;
      b.style.background = c;
      b.onclick = () => setBg(c);
      bgRow.appendChild(b);
    }
  }
  const bc = $('bgColor');
  if (bc) {
    bc.value = /^#[0-9a-f]{6}$/i.test(storedBg) ? storedBg : '#eef2f7';
    bc.onchange = e => setBg(e.target.value);
  }
  const br = $('bgReset');
  if (br) br.onclick = () => setBg('');
  const bgPresets = $('bgPresets');
  if (bgPresets) {
    bgPresets.innerHTML = '';
    for (const p of BG_GRADIENT_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bg-preset' + (storedBg === p.c ? ' on' : '');
      b.style.background = p.c;
      b.onclick = () => setBg(p.c);
      bgPresets.appendChild(b);
    }
  }
  const bgUploadBtn = $('bgUploadBtn');
  const bgFileInput = $('bgFileInput');
  const bgClearBtn = $('bgClearBtn');
  const bgOpacitySlider = $('bgOpacitySlider');
  const bgOpacityLabel = $('bgOpacityLabel');
  if (bgUploadBtn && bgFileInput) {
    bgUploadBtn.onclick = () => bgFileInput.click();
    bgFileInput.onchange = e => {
      const file = e.target.files[0];
      if (file) handleBgImageUpload(file);
    };
  }
  if (bgClearBtn) {
    bgClearBtn.onclick = clearBgImage;
    bgClearBtn.disabled = !storedBgImage && !currentTheme().img;
  }
  if (bgOpacitySlider) {
    bgOpacitySlider.min = 0;
    bgOpacitySlider.max = 1;
    bgOpacitySlider.value = storedBgOpacity;
    bgOpacitySlider.oninput = e => setBgOpacity(e.target.value);
  }
  if (bgOpacityLabel) {
    bgOpacityLabel.textContent = Math.round(storedBgOpacity * 100) + '%';
  }
  /* ── Ползунок прозрачности панелей (вставляется один раз) ── */
  const bgOpRow = document.querySelector('.bg-opacity-row');
  if (bgOpRow && !document.getElementById('panelOpacityRow')) {
    const prow = document.createElement('div');
    prow.className = 'bg-opacity-row';
    prow.id = 'panelOpacityRow';
    prow.innerHTML = '<span class="bg-opacity-label">Панели</span><input id="panelOpacitySlider" class="bg-opacity-slider" type="range" min="0.1" max="0.9" step="0.05"><span class="bg-opacity-label" id="panelOpacityLabel"></span>';
    bgOpRow.insertAdjacentElement('afterend', prow);
  }
  const pSlider = $('panelOpacitySlider');
  if (pSlider) pSlider.oninput = e => setPanelAlpha(parseFloat(e.target.value));
  applyPanelAlpha();
  /* ── Заголовок «Размытие»: после строки загрузки, над ползунками ── */
  const uploadRow = document.querySelector('.bg-upload-row');
  if (uploadRow && !document.getElementById('blurHeading')) {
    const h = document.createElement('div');
    h.id = 'blurHeading';
    h.className = 'set-sub';
    h.textContent = 'Размытие';
    uploadRow.insertAdjacentElement('afterend', h);
  }
  /* ── Верхний ползунок как «Панели»: слева «Фон», справа % ── */
  const bgRowFirst = document.querySelector('.bg-opacity-row');
  if (bgRowFirst && !bgRowFirst.querySelector('.bg-left-label')) {
    const lab = document.createElement('span');
    lab.className = 'bg-opacity-label bg-left-label';
    lab.textContent = 'Фон';
    bgRowFirst.insertBefore(lab, bgRowFirst.firstChild);
  }
  const frow = $('fontRow');
  if (frow) {
    frow.innerHTML = '';
    for (const f of FONTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'font-btn' + (f.id === storedFont ? ' on' : '') + ' ' + f.id;
      b.textContent = f.label;
      b.onclick = () => setFont(f.id);
      frow.appendChild(b);
    }
  }
  /* ── ЕДИНЫЙ БЛОК "Настройки режимов" (цвет + название) ── */
  const ms = $('modeSettings');
  if (ms) {
    ms.innerHTML = '';
    const colors = getModeColors();
    const defaults = getDefaultModeColors();
    for (const m of MODES) {
      const rowEl = document.createElement('div');
      rowEl.className = 'mode-setting-row';
      const colorWrap = document.createElement('div');
      colorWrap.className = 'mode-color-wrap';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'mode-color-input';
      colorInput.value = colors[m.id] || defaults[m.id] || '#888888';
      colorInput.title = 'Цвет режима';
      colorInput.onchange = async () => {
        await setModeColor(m.id, colorInput.value);
        renderLookPanel();
        renderCurrent();
      };
      colorWrap.appendChild(colorInput);
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'mode-label-input';
      labelInput.value = m.label;
      labelInput.maxLength = 30;
      labelInput.placeholder = 'Название';
      const commit = async () => {
        const v = labelInput.value.trim();
        if (!v) await resetModeLabel(m.id);
        else await setModeLabel(m.id, v);
        renderLookPanel();
        renderCurrent();
      };
      labelInput.onblur = commit;
      labelInput.onkeydown = async e => {
        if (e.key === 'Enter') { e.preventDefault(); labelInput.blur(); }
        if (e.key === 'Escape') { labelInput.value = m.label; labelInput.blur(); }
      };
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'mode-label-reset';
      resetBtn.title = 'Сбросить к умолчаниям';
      resetBtn.textContent = '↺';
      resetBtn.onclick = async () => {
        await resetModeLabel(m.id);
        await setModeColor(m.id, defaults[m.id]);
        renderLookPanel();
        renderCurrent();
      };
      rowEl.append(colorWrap, labelInput, resetBtn);
      ms.appendChild(rowEl);
    }
    const rstAll = document.createElement('button');
    rstAll.type = 'button';
    rstAll.className = 'btn';
    rstAll.textContent = 'Сбросить все режимы';
    rstAll.style.marginTop = '10px';
    rstAll.onclick = async () => {
      await resetAllModeLabels();
      await resetModeColors();
      renderLookPanel();
      renderCurrent();
    };
    ms.appendChild(rstAll);
  }
}

function renderTagsPanel() {
  const dict = getTagsDict();
  const box = $('tagsList');
  if (!box) return;
  box.innerHTML = '';
  if (!dict.length) box.innerHTML = '<p class="hint">Пока пусто. Добавь теги выше.</p>';
  for (const t of dict) {
    const row = document.createElement('div');
    row.className = 'tag-line';
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.textContent = t.name;
    pill.title = t.name;
    if (t.color) pill.style.setProperty('--tc', t.color);
    const pal = document.createElement('button');
    pal.type = 'button';
    pal.className = 'pal-btn';
    pal.title = 'Цвет тега';
    const dot = document.createElement('i');
    dot.style.background = t.color || 'conic-gradient(#ef4444,#f59e0b,#10b981,#2563eb,#8b5cf6,#ec4899,#ef4444)';
    pal.appendChild(dot);
    pal.onclick = () => openTagColorMenu(pal, t);
    const ren = document.createElement('button');
    ren.className = 'fl-btn';
    ren.textContent = '✎';
    ren.title = 'Переименовать';
    const del = document.createElement('button');
    del.className = 'fl-btn del';
    del.textContent = '✕';
    del.title = 'Удалить';
    ren.onclick = () => {
      const inp = document.createElement('input');
      inp.className = 'tag-rename';
      inp.value = t.name;
      pill.replaceWith(inp);
      ren.remove();
      inp.focus();
      const commit = async () => {
        await renameTag(t.name, inp.value);
        renderTagsPanel();
        renderCurrent();
      };
      inp.onkeydown = e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') renderTagsPanel();
      };
      inp.onblur = commit;
    };
    del.onclick = async () => {
      if (confirm('Удалить тег «' + t.name + '» из словаря и всех задач?')) {
        await deleteTag(t.name);
        renderTagsPanel();
        renderCurrent();
      }
    };
    row.append(pill, pal, ren, del);
    box.appendChild(row);
  }
}

const drawerOpen = () => { const d = $('drawer'); return d && d.classList.contains('open'); };

function setupDrawerGrip() {
  const drawer = $('drawer');
  const drawerMain = $('drawerMain');
  if (!drawer) return;
  if (!drawer.querySelector('.drawer-grip')) {
    const grip = document.createElement('div');
    grip.className = 'drawer-grip';
    drawer.appendChild(grip);
  }
  const grip = drawer.querySelector('.drawer-grip');
  if (!grip || grip._bound) return;
  grip._bound = true;
  let startX = 0, dx = 0, dragging = false;
  grip.addEventListener('pointerdown', e => {
    dragging = true;
    startX = e.clientX;
    dx = 0;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    drawer.classList.add('drag');
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = Math.max(0, e.clientX - startX);
    drawer.style.transform = `translateX(${dx}px)`;
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove('dragging');
    drawer.classList.remove('drag');
    drawer.style.transform = '';
    if (dx > 80) {
      if (drawerMain && drawerMain.hidden) showDrawerView('main');
      else closeDrawer();
    }
    dx = 0;
  };
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
}

function showDrawerView(v) {
  const dm = $('drawerMain');
  const ds = $('drawerSync');
  const dt = $('drawerTheme');
  const dg = $('drawerTags');
  const dk = $('drawerKeys');
  if (dm) dm.hidden = v !== 'main';
  if (ds) ds.hidden = v !== 'sync';
  if (dt) dt.hidden = v !== 'theme';
  if (dg) dg.hidden = v !== 'tags';
  if (dk) dk.hidden = v !== 'keys';
  if (v === 'sync') renderSyncPanel($('syncPanel'));
  if (v === 'theme') renderLookPanel();
  if (v === 'tags') renderTagsPanel();
  if (v === 'keys') hk.renderKeysPanel($('keysRows'));
}
function openDrawer(view) {
  const d = $('drawer');
  if (!d) return;
  setupDrawerGrip();
  d.classList.add('open');
  refreshBackdrop();
  showDrawerView(view || 'main');
}
function closeDrawer() {
  const d = $('drawer');
  if (d) d.classList.remove('open');
  refreshBackdrop();
}
(function bindDrawerSwipe() {
  const d = $('drawer');
  if (!d) return;
  let sx = 0, sy = 0;
  d.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  d.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (dx > 60 && Math.abs(dy) < 60) closeDrawer();
  });
})();

function setView(v) {
  state.view = v;
  const grid = $('grid');
  const cv = $('contactsView');
  const notesPanel = $('notesPanel');
  const focusPanel = $('focusPanel');
  const topbar = document.querySelector('.topbar');
  if (grid) grid.hidden = v !== 'week';
  if (cv) cv.hidden = v !== 'contacts';
  // Скрываем панели заметок и фокусировки в режиме контактов
  if (notesPanel) notesPanel.hidden = v === 'contacts';
  if (focusPanel) focusPanel.hidden = v === 'contacts';
  // Переключаем класс на topbar для скрытия кнопок шапки
  if (topbar) topbar.classList.toggle('contacts-active', v === 'contacts');
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const ct = $('ctBtn');
  if (ct) ct.classList.toggle('on', v === 'contacts');
  if (v === 'contacts' && cv) renderContactsView(cv, state.mode);
  else renderAll();
  placeWeekNav();
}

function renderCurrent() {
  if (state.view === 'week') {
    renderAll();
    // Показываем панели в режиме недели
    const notesPanel = $('notesPanel');
    const focusPanel = $('focusPanel');
    if (notesPanel) notesPanel.hidden = false;
    if (focusPanel) focusPanel.hidden = false;
  }
  else if (state.view === 'contacts') {
    const cv = $('contactsView');
    // Скрываем панели в режиме контактов
    const notesPanel = $('notesPanel');
    const focusPanel = $('focusPanel');
    if (notesPanel) notesPanel.hidden = true;
    if (focusPanel) focusPanel.hidden = true;
    if (cv) renderContactsView(cv, state.mode);
  }
}

(function bindPull() {
  const app = $('app');
  const ind = $('pullIndicator');
  if (!app || !ind) return;
  let startY = null, dist = 0;
  app.addEventListener('pointerdown', e => {
    if (app.scrollTop <= 0) { startY = e.clientY; dist = 0; }
  });
  app.addEventListener('pointermove', e => {
    if (startY == null) return;
    dist = Math.max(0, e.clientY - startY);
    if (dist > 12) {
      ind.classList.add('show');
      ind.style.transform = 'translate(-50%, ' + Math.min(46, dist * 0.4) + 'px)';
    }
  });
  const finish = () => {
    if (startY == null) return;
    const trigger = dist > 70;
    startY = null;
    if (trigger) {
      ind.classList.add('spin');
      ind.style.transform = 'translate(-50%, 46px)';
      Promise.resolve(syncNow()).finally(() => {
        setTimeout(() => {
          ind.classList.remove('show', 'spin');
          ind.style.transform = '';
        }, 500);
      });
    } else {
      ind.classList.remove('show', 'spin');
      ind.style.transform = '';
    }
    dist = 0;
  };
  app.addEventListener('pointerup', finish);
  app.addEventListener('pointercancel', finish);
})();

async function boot() {
  await init();
  await contactsInit();
  await notesInit();
  await focusInit();
  widgetsInit();
  await loadModeColors();
  await hk.loadKeys();
  const t = await dbGetKV('theme');
  if (THEMES.some(x => x.id === t)) storedTheme = t;
  storedBg = (await dbGetKV('bg')) || '';
  storedBgImage = (await dbGetKV('bgImage')) || '';
  storedBgOpacity = parseFloat(await dbGetKV('bgOpacity')) || 0.3;
  const pa = await dbGetKV('panelAlpha');
  storedPanelAlpha = pa == null ? null : parseFloat(pa);
  const f = await dbGetKV('fontSize');
  if (FONTS.some(x => x.id === f)) storedFont = f;
  applyTheme();
  applyFont();
  updateTimeAtmosphere();
  setInterval(updateTimeAtmosphere, 60000);
  setInterval(checkDayRollover, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDayRollover();
  });
  addEventListener('load', () => window.scrollTo(0, 0));
  addEventListener('pageshow', () => window.scrollTo(0, 0));
  document.addEventListener('hotkeys-changed', renderCurrent);
  document.addEventListener('timer-changed', refreshRunning);
  document.addEventListener('sync-done', renderCurrent);
  document.addEventListener('mode-labels-changed', renderCurrent);
  contactsSubscribe(renderCurrent);
  subscribe(renderCurrent);
  document.addEventListener('goto-week', e => {
    if (e.detail) {
      state.weekStart = e.detail;
      setView('week');
    }
  });
  bindNav();
  bindNavHide();
  searchAnchor = $('searchBtn') ? $('searchBtn').nextSibling : null;
  document.addEventListener('grid-rendered', placeWeekNav);
  if (mqMobile.addEventListener) mqMobile.addEventListener('change', placeWeekNav);
  bindKeys();
  bindSync();
  timerInit();
  searchInit();
  renderAll();
  syncInit();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function moveDay(dir) { openDay(addDays(dayOpen() ? state.day : today(), dir)); }

function bindNav() {
  const prevWeek = $('prevWeek');
  const nextWeek = $('nextWeek');
  const weekLabel = $('weekLabel');
  if (prevWeek) prevWeek.onclick = () => shiftWeek(-1);
  if (nextWeek) nextWeek.onclick = () => shiftWeek(1);
  if (weekLabel) weekLabel.onclick = goToday;
  const ab = $('addBtn');
  if (ab) {
    ab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>';
    ab.onclick = () => openSheet(null);
  }
  const sb = $('searchBtn');
  if (sb) sb.onclick = openSearch;
  const ct = $('ctBtn');
  if (ct) ct.onclick = () => setView(state.view === 'contacts' ? 'week' : 'contacts');
  const wb = $('widgetsBtn');
  if (wb) {
    wb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    wb.onclick = e => openWidgetsPanel(wb);
  }
  const st = $('settingsBtn');
  if (st) st.onclick = () => openDrawer('main');
  const sth = $('setThemes');
  if (sth) sth.onclick = () => showDrawerView('theme');
  const stg = $('setTags');
  if (stg) stg.onclick = () => showDrawerView('tags');
  const sts = $('setSync');
  if (sts) sts.onclick = () => showDrawerView('sync');
  const stk = $('setKeys');
  if (stk) stk.onclick = () => showDrawerView('keys');
  const sbk = $('syncBack');
  if (sbk) sbk.onclick = () => showDrawerView('main');
  const tbk = $('themeBack');
  if (tbk) tbk.onclick = () => showDrawerView('main');
  const tgk = $('tagsBack');
  if (tgk) tgk.onclick = () => showDrawerView('main');
  const kk = $('keysBack');
  if (kk) kk.onclick = () => showDrawerView('main');
  const tb = $('tagsBulk');
  const ta2 = $('tagsAdd');
  if (tb && ta2) {
    const growTa = () => { tb.style.height = 'auto'; tb.style.height = tb.scrollHeight + 'px'; };
    tb.addEventListener('input', growTa);
    growTa();
    const addTags = async () => {
      const names = tb.value.split(/[,;\n]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean);
      if (!names.length) return;
      await addTagsToDict(names);
      tb.value = '';
      growTa();
      renderTagsPanel();
      renderCurrent();
    };
    ta2.onclick = addTags;
    tb.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      await addTags();
    });
  }
  const backdrop = $('backdrop');
  if (backdrop) {
    backdrop.onclick = () => {
      closeSheet();
      closeSearch();
      closeTagColorMenu();
      closeDrawer();
      closeDay();
      closeCellMenu();
    };
  }
  document.querySelectorAll('#bottomNav button').forEach(b => {
    b.onclick = () => setView(b.dataset.view);
  });
}

function bindNavHide() {
  const app = $('app');
  const nav = $('bottomNav');
  if (!app || !nav) return;
  let t = null;
  app.addEventListener('scroll', () => {
    nav.classList.add('hid');
    clearTimeout(t);
    t = setTimeout(() => nav.classList.remove('hid'), 180);
  }, { passive: true });
}

/* ── ПК: блок недели и поиск в шапке задач; мобилка — топбар ── */
const mqMobile = matchMedia('(max-width: 720px)');
let navHost = null, searchHost = null, searchAnchor = null;
let navNodes = null;
function getNavNodes() {
  if (!navNodes) {
    navNodes = {
      prev: $('prevWeek'),
      wl: $('weekLabel'),
      next: $('nextWeek'),
      sb: $('searchBtn')
    };
  }
  return navNodes;
}
function placeWeekNav() {
  const n = getNavNodes();
  if (!n.wl) return;
  if (!navHost) navHost = document.querySelector('.wn-center');
  if (!searchHost) searchHost = document.querySelector('.wn-right');
  const toPanel = !mqMobile.matches && state.view === 'week';
  if (toPanel) {
    const grid = $('grid');
    const rn = grid && grid.querySelector('.r-nav');
    const rs = grid && grid.querySelector('.r-search');
    if (rn && n.wl.parentNode !== rn) rn.append(n.prev, n.wl, n.next);
    if (rs && n.sb && n.sb.parentNode !== rs) rs.appendChild(n.sb);
  } else {
    if (navHost && n.wl.parentNode !== navHost) navHost.append(n.prev, n.wl, n.next);
    if (searchHost && n.sb && n.sb.parentNode !== searchHost) {
      if (searchAnchor && searchAnchor.parentNode === searchHost) searchHost.insertBefore(n.sb, searchAnchor);
      else searchHost.appendChild(n.sb);
    }
  }
}

function bindKeys() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (sheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
    if (searchOpen()) { if (e.key === 'Escape') closeSearch(); return; }
    if (drawerOpen()) { if (e.key === 'Escape') closeDrawer(); return; }
    if (dayOpen()) { if (e.key === 'Escape') closeDay(); return; }
    if (hk.matches(e, 'new')) { e.preventDefault(); openSheet(null); }
    else if (hk.matches(e, 'search')) { e.preventDefault(); openSearch(); }
    else if (hk.matches(e, 'today')) goToday();
    else if (hk.matches(e, 'weekPrev')) shiftWeek(-1);
    else if (hk.matches(e, 'weekNext')) shiftWeek(1);
    else if (hk.matches(e, 'dayPrev')) { e.preventDefault(); moveDay(-1); }
    else if (hk.matches(e, 'dayNext')) { e.preventDefault(); moveDay(1); }
  });
}

function bindSync() {
  const btn = $('syncBtn');
  if (btn) btn.onclick = () => openDrawer('sync');
  document.addEventListener('sync-status', e => {
    if (btn) btn.dataset.state = e.detail;
  });
}

boot();
