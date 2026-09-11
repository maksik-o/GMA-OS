import { API_URL, CLIENT_ID, OWNER_EMAIL } from './config.js';
import {
  state, applyMerged, getTagsDict, getTagsDeleted, saveTagsMeta,
  getTombstonesFull
} from './store.js';
import { getContactsForSync, applyContactsMerged, getContactTombstones, applyContactTombstones } from './contacts.js';
import { getNotesForSync, getNoteTombstones, applyNotesMerged } from './notes.js';

const TOKEN_KEY = 'rl_token';
const KEY_KEY = 'rl_device_key';
const ISSUED_KEYS_STORAGE = 'rl_issued_device_keys'; // список выданных ключей (только у владельца)

let busy = false;
let pushTimer = null;
let lastError = '';

export const configured = () => API_URL.startsWith('https://') && CLIENT_ID.includes('.apps.googleusercontent.com');
export const signedIn = () => !!(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(KEY_KEY));

function setStatus(s) { document.dispatchEvent(new CustomEvent('sync-status', { detail: s })); }
export function refreshStatus() {
  const s = !navigator.onLine ? 'offline' : !configured() ? 'off' : signedIn() ? 'ok' : 'auth';
  setStatus(s);
}

function jwtPayload(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { return null; }
}

export const userEmail = () => (jwtPayload(localStorage.getItem(TOKEN_KEY) || '') || {}).email || '';

const tokenValid = () => {
  const p = jwtPayload(localStorage.getItem(TOKEN_KEY) || '');
  return !!(p && p.exp * 1000 > Date.now() + 60000);
};

function loadGIS() {
  return new Promise((res, rej) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res;
    s.onerror = () => rej(new Error('GIS'));
    document.head.appendChild(s);
  });
}

async function ensureToken() {
  if (tokenValid()) return localStorage.getItem(TOKEN_KEY);
  if (!configured()) return '';
  try { await loadGIS(); } catch { return ''; }
  return new Promise(resolve => {
    let done = false;
    const fin = c => {
      if (done) return;
      done = true;
      if (c) localStorage.setItem(TOKEN_KEY, c);
      resolve(c || '');
    };
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      auto_select: true,
      callback: c => fin(c.credential)
    });
    google.accounts.id.prompt();
    setTimeout(() => fin(''), 7000);
  });
}

export async function apiCall(action, extra) {
  const key = localStorage.getItem(KEY_KEY) || '';
  let auth = '';
  if (!key) {
    auth = await ensureToken();
    if (!auth) {
      lastError = 'Требуется вход';
      setStatus('auth');
      const e = new Error(lastError);
      e.auth = true;
      throw e;
    }
  }
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ auth, key, action }, extra))
    });
  } catch (err) {
    lastError = 'Сеть: ' + err.message;
    throw new Error(lastError);
  }
  if (!res.ok) {
    lastError = 'HTTP ' + res.status;
    throw new Error(lastError);
  }
  let text;
  try { text = await res.text(); }
  catch (err) {
    lastError = 'Не удалось прочитать ответ';
    throw new Error(lastError);
  }
  let out;
  try { out = JSON.parse(text); }
  catch (err) {
    lastError = 'Сервер вернул не-JSON. Переразверните Apps Script с доступом «Все».';
    console.error('[sync] Non-JSON preview:', text.slice(0, 300));
    throw new Error(lastError);
  }
  if (!out || typeof out !== 'object') {
    lastError = 'Некорректный ответ сервера';
    throw new Error(lastError);
  }
  if (!out.ok) {
    lastError = out.error || 'Ошибка сервера';
    if (/Сеанс|токен|expired/i.test(lastError)) localStorage.removeItem(TOKEN_KEY);
    const e = new Error(lastError);
    if (/Сеанс|токен|expired/i.test(lastError)) e.auth = true;
    throw e;
  }
  lastError = '';
  return out;
}

export async function syncNow() {
  if (busy || !configured()) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (!signedIn()) { setStatus('auth'); return; }
  busy = true;
  setStatus('syncing');
  const tombstonesToSend = getTombstonesFull();
  const tombIds = new Set(tombstonesToSend.map(t => t.id));
  const tasksToSend = state.tasks.filter(t => t && !tombIds.has(t.id));
  try {
    const notesToSend = getNotesForSync();
    const out = await apiCall('sync', {
      tasks: tasksToSend,
      tombstones: tombstonesToSend,
      tags: getTagsDict(),
      tagsDeleted: getTagsDeleted(),
      contacts: getContactsForSync(),
      contactTombstones: getContactTombstones(),
      notes: notesToSend,
      noteTombstones: getNoteTombstones()
    });
    await applyMerged({
      tasks: Array.isArray(out.tasks) ? out.tasks : [],
      tombstones: Array.isArray(out.tombstones) ? out.tombstones : []
    });
    if (Array.isArray(out.tags)) await saveTagsMeta(out.tags, out.tagsDeleted || []);
    if (Array.isArray(out.contacts)) await applyContactsMerged(out.contacts);
    if (Array.isArray(out.contactTombstones)) await applyContactTombstones(out.contactTombstones);
    if (Array.isArray(out.notes)) {
      const { applyNotesMerged } = await import('./notes.js');
      await applyNotesMerged(out.notes);
    }
    document.dispatchEvent(new CustomEvent('sync-done'));
    setStatus('ok');
  } catch (e) {
    lastError = e.message || String(e);
    if (e.auth) setStatus('auth');
    else setStatus(navigator.onLine ? 'error' : 'offline');
  } finally {
    busy = false;
  }
}

export function schedule() {
  if (!configured() || !signedIn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 2000);
}

export async function connectKey(key) {
  localStorage.setItem(KEY_KEY, key);
  lastError = '';
  refreshStatus();
  await syncNow();
}

export async function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(KEY_KEY);
  lastError = '';
  refreshStatus();
}

/* ── Генератор ключей устройства (для владельца) ── */
function generateDeviceKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const rnd = new Uint32Array(24);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < 24; i++) out += chars[rnd[i] % chars.length];
  // группами по 4 для удобства чтения: ABCD-EFGH-JKLM-NPQR-STUV-WXYZ
  return out.match(/.{1,4}/g).join('-');
}

function loadIssuedKeys() {
  try { return JSON.parse(localStorage.getItem(ISSUED_KEYS_STORAGE) || '[]'); }
  catch { return []; }
}
function saveIssuedKeys(list) {
  try { localStorage.setItem(ISSUED_KEYS_STORAGE, JSON.stringify(list)); } catch {}
}

function isOwner() {
  if (!OWNER_EMAIL) return false;
  return String(userEmail()).toLowerCase() === String(OWNER_EMAIL).toLowerCase();
}

function renderDeviceKeysPanel(el) {
  if (!el) return;
  if (!isOwner()) {
    el.innerHTML = '';
    return;
  }
  const list = loadIssuedKeys();
  el.innerHTML = `<div class="set-sub" style="margin-top:18px">Ключи устройства</div>
    <p class="hint" style="margin:0 0 10px">
      Ключ — это вход без Google. У каждого ключа своя изолированная папка в твоём Drive.
      Сгенерируй, скопируй и передай кому нужно.
    </p>
    <div class="auth-row" style="justify-content:flex-start">
      <button type="button" id="issueKeyBtn" class="btn primary">＋ Выдать ключ</button>
    </div>
    <div id="issuedKeysList" class="issued-keys-list"></div>`;

  const renderList = () => {
    const wrap = el.querySelector('#issuedKeysList');
    const current = loadIssuedKeys();
    if (!current.length) {
      wrap.innerHTML = '<p class="hint" style="margin:6px 0 0">Пока никто не получил ключ.</p>';
      return;
    }
    wrap.innerHTML = current.map((item, i) =>
      `<div class="key-line" style="margin-top:8px">
        <span class="kl" style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.label || 'Без имени'}</div>
          <div style="font-size:11px;color:var(--dim);margin-top:2px">выдан ${new Date(item.issuedAt).toLocaleString('ru-RU')}</div>
          <code style="font-size:11px;color:var(--accent);font-family:monospace;word-break:break-all;display:block;margin-top:4px">${item.key}</code>
        </span>
        <button type="button" class="btn mini" data-copy="${i}" title="Скопировать">⎘</button>
        <button type="button" class="btn mini danger" data-del="${i}" title="Отозвать (удалить из списка)">✕</button>
      </div>`
    ).join('');
    wrap.querySelectorAll('[data-copy]').forEach(b => {
      b.onclick = async () => {
        const idx = +b.dataset.copy;
        const k = loadIssuedKeys()[idx];
        if (!k) return;
        try {
          await navigator.clipboard.writeText(k.key);
          b.textContent = '✓';
          setTimeout(() => { b.textContent = '⎘'; }, 900);
        } catch {
          prompt('Скопируй ключ вручную:', k.key);
        }
      };
    });
    wrap.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        const idx = +b.dataset.del;
        const arr = loadIssuedKeys();
        arr.splice(idx, 1);
        saveIssuedKeys(arr);
        renderList();
      };
    });
  };

  el.querySelector('#issueKeyBtn').onclick = () => {
    const label = prompt('Для кого этот ключ? (имя/почта — для себя)', '') || '';
    const key = generateDeviceKey();
    const arr = loadIssuedKeys();
    arr.unshift({ key, label: label.trim() || 'Без имени', issuedAt: Date.now() });
    saveIssuedKeys(arr);
    // Сразу копируем в буфер, чтобы не потерять
    navigator.clipboard.writeText(key).catch(() => {});
    renderList();
  };

  renderList();
}

export function renderSyncPanel(el) {
  const st = !navigator.onLine ? 'offline' : !configured() ? 'off' : signedIn() ? 'ok' : 'auth';
  const names = { ok: 'подключено', auth: 'не выполнен вход', off: 'не настроено', offline: 'нет сети' };
  let html = `<div class="sync-statusline">Статус: ${names[st]}${userEmail() ? ' · ' + userEmail() : ''}</div>`;
  if (lastError) html += `<p class="hint err">${lastError}</p>`;
  if (!configured()) {
    html += `<p class="hint">Заполните API_URL и CLIENT_ID в js/config.js.</p>`;
  } else if (!signedIn()) {
    html += `<div class="key-row"><input id="syncKey" class="key-input" placeholder="Ключ устройства"><button type="button" id="syncKeyGo" class="btn">Войти</button></div><div id="gBtnWrap" style="display:flex;justify-content:center;margin:8px 0;"></div>`;
  } else {
    html += `<div class="auth-row"><button type="button" id="syncNowBtn" class="btn primary">Синхронизировать</button><button type="button" id="syncOut" class="btn danger">Выйти</button></div>`;
  }
  html += '<div id="deviceKeysHost"></div>';
  el.innerHTML = html;

  const kg = el.querySelector('#syncKeyGo');
  if (kg) kg.onclick = async () => {
    const v = el.querySelector('#syncKey').value.trim();
    if (v) { await connectKey(v); renderSyncPanel(el); }
  };
  const gw = el.querySelector('#gBtnWrap');
  if (gw) {
    loadGIS().then(() => {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        auto_select: false,
        callback: async c => {
          localStorage.setItem(TOKEN_KEY, c.credential);
          lastError = '';
          refreshStatus();
          await syncNow();
          renderSyncPanel(el);
        }
      });
      google.accounts.id.renderButton(gw, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ru' });
    }).catch(() => {});
  }
  const nb = el.querySelector('#syncNowBtn');
  if (nb) nb.onclick = async () => { await syncNow(); renderSyncPanel(el); };
  const ob = el.querySelector('#syncOut');
  if (ob) ob.onclick = async () => { await signOut(); renderSyncPanel(el); };

  // Панель генератора ключей — показывается только владельцу после входа
  renderDeviceKeysPanel(el.querySelector('#deviceKeysHost'));
}

export function syncInit() {
  document.addEventListener('user-change', schedule);
  window.addEventListener('online', () => { refreshStatus(); syncNow(); });
  window.addEventListener('offline', () => setStatus('offline'));
  refreshStatus();
  if (configured() && signedIn()) setTimeout(syncNow, 300);
}
