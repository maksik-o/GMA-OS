import { API_URL, CLIENT_ID } from './config.js';
import {
  state, applyMerged, getTagsDict, getTagsDeleted, saveTagsMeta,
  getTombstonesFull
} from './store.js';
import { getContactsForSync, applyContactsMerged } from './contacts.js';

const TOKEN_KEY = 'rl_token';
const KEY_KEY = 'rl_device_key';
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
    if (window.google && google.accounts && google.accounts.id) return res();
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

  console.log('[sync] syncNow start, tasks:', tasksToSend.length, 'tombstones:', tombstonesToSend.length);

  try {
    const out = await apiCall('sync', {
      tasks: tasksToSend,
      tombstones: tombstonesToSend,
      tags: getTagsDict(),
      tagsDeleted: getTagsDeleted(),
      contacts: getContactsForSync()
    });

    console.log('[sync] server response:', {
      ok: out.ok,
      tasks: Array.isArray(out.tasks) ? out.tasks.length : 'NOT_ARRAY',
      tombstones: Array.isArray(out.tombstones) ? out.tombstones.length : 'NOT_ARRAY'
    });

    await applyMerged({
      tasks: Array.isArray(out.tasks) ? out.tasks : [],
      tombstones: Array.isArray(out.tombstones) ? out.tombstones : []
    });

    if (Array.isArray(out.tags)) {
      await saveTagsMeta(out.tags, out.tagsDeleted || []);
    }

    if (Array.isArray(out.contacts)) {
      await applyContactsMerged(out.contacts);
    }

    // УБРАНО: НЕ очищаем локальные tombstones.
    // Сервер хранит их 30 дней и возвращает при каждом sync.
    // Локальные tombstones автоматически удаляются через pruneTombstones()
    // по истечении TOMBSTONE_TTL_MS (30 дней).

    document.dispatchEvent(new CustomEvent('sync-done'));
    setStatus('ok');
  } catch (e) {
    console.error('[sync] error:', e);
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
}

export function syncInit() {
  document.addEventListener('user-change', schedule);
  window.addEventListener('online', () => { refreshStatus(); syncNow(); });
  window.addEventListener('offline', () => setStatus('offline'));
  refreshStatus();
  if (configured() && signedIn()) setTimeout(syncNow, 300);
}
