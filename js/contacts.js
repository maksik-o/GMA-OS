import { dbAll, dbPut, dbBulk } from './db.js';
import { uid, esc } from './store.js';

const STORE = 'contacts';
const state = { people: [] };
const listeners = [];
export const contactsSubscribe = fn => listeners.push(fn);

let pending = false;
const notify = () => {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    listeners.forEach(fn => fn());
  }, 100);
};

const userChange = () => document.dispatchEvent(new CustomEvent('user-change'));

export async function init() {
  state.people = (await dbAll(STORE)).map(m => {
    if (!Array.isArray(m.assignments)) m.assignments = [];
    if (!m.mode) m.mode = 'all';
    return m;
  });
}

export const getPeople = mode => {
  const list = state.people.filter(p => !p.deleted && (mode === 'all' || p.mode === 'all' || p.mode === mode));
  return list.sort((a, b) => a.name.localeCompare(b.name));
};

export const getPerson = id => state.people.find(p => p.id === id);

export async function addPerson(data) {
  const p = {
    id: uid(), name: (data.name || '').trim(), note: data.note || '', mode: data.mode || 'all',
    phone: data.phone || '', email: data.email || '', birthday: data.birthday || '',
    assignments: [], createdAt: new Date().toISOString()
  };
  state.people.push(p);
  await dbPut(STORE, p);
  notify();
  userChange();
  return p;
}

export async function updatePerson(id, patch) {
  const p = getPerson(id);
  if (!p) return;
  Object.assign(p, patch);
  await dbPut(STORE, p);
  notify();
  userChange();
}

export async function removePerson(id) {
  const p = getPerson(id);
  if (!p) return;
  p.deleted = true;
  await dbPut(STORE, p);
  notify();
  userChange();
}

export async function addAssignment(personId, data) {
  const p = getPerson(personId);
  if (!p) return;
  const a = {
    id: uid(), title: (data.title || '').trim(), note: data.note || '',
    status: data.status || 'todo', createdAt: new Date().toISOString(), doneAt: null
  };
  p.assignments.push(a);
  await dbPut(STORE, p);
  notify();
  userChange();
  return a;
}

export async function updateAssignment(personId, aid, patch) {
  const p = getPerson(personId);
  if (!p) return;
  const a = p.assignments.find(x => x.id === aid);
  if (!a) return;
  Object.assign(a, patch);
  if (patch.status === 'done' && !a.doneAt) a.doneAt = new Date().toISOString();
  if (patch.status !== 'done') a.doneAt = null;
  await dbPut(STORE, p);
  notify();
  userChange();
}

export async function removeAssignment(personId, aid) {
  const p = getPerson(personId);
  if (!p) return;
  p.assignments = p.assignments.filter(a => a.id !== aid);
  await dbPut(STORE, p);
  notify();
  userChange();
}

const modeLabel = m => ({ work: 'Работа', home: 'Дом', study: 'Учёба', all: 'Все' }[m] || m);

function modeColor(m) {
  const cs = getComputedStyle(document.documentElement);
  return ({
    work: cs.getPropertyValue('--mode-work'),
    home: cs.getPropertyValue('--mode-home'),
    study: cs.getPropertyValue('--mode-study'),
    all: cs.getPropertyValue('--mode-all')
  }[m] || '#888').trim();
}

export function renderContactsView(container, mode) {
  if (!container) return;
  const people = getPeople(mode);

  if (!people.length) {
    container.innerHTML = '<div class="contacts-empty"><p>Пока никого нет в режиме «' + modeLabel(mode) + '».</p><div class="contacts-add-row"><input id="newPersonName" class="f-title" placeholder="Имя человека" maxlength="100"><button type="button" class="btn primary" id="addPersonBtn">Добавить</button></div></div>';
    const inp = container.querySelector('#newPersonName'), btn = container.querySelector('#addPersonBtn');
    const doAdd = async () => {
      const v = inp.value.trim();
      if (!v) return;
      await addPerson({ name: v, mode });
      renderContactsView(container, mode);
    };
    btn.onclick = doAdd;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
    return;
  }

  let html = '<div class="contacts-add-row"><input id="newPersonName" class="f-title" placeholder="＋ новый человек" maxlength="100"><button type="button" class="btn primary" id="addPersonBtn">Добавить</button></div>';
  for (const p of people) {
    const active = p.assignments.filter(a => a.status !== 'done').length;
    const done = p.assignments.filter(a => a.status === 'done').length;
    html += '<section class="contact-card glass" data-id="' + p.id + '"><div class="contact-head"><div class="contact-avatar" style="background:' + modeColor(p.mode) + '">' + esc(p.name.charAt(0).toUpperCase()) + '</div><div class="contact-info"><div class="contact-name">' + esc(p.name) + '</div><div class="contact-meta">' + active + ' активно · ' + done + ' выполнено</div>';
    if (p.phone) html += '<div class="contact-sub">📞 ' + esc(p.phone) + '</div>';
    if (p.email) html += '<div class="contact-sub">✉ ' + esc(p.email) + '</div>';
    if (p.birthday) html += '<div class="contact-sub">🎂 ' + esc(p.birthday) + '</div>';
    html += '</div><button type="button" class="icon-btn contact-edit" title="Редактировать">✎</button><button type="button" class="icon-btn contact-del" title="Удалить">✕</button></div>';
    if (p.note) html += '<div class="contact-note">' + esc(p.note) + '</div>';
    html += '<div class="contact-assignments">';
    for (const a of p.assignments) {
      html += '<div class="assignment-row' + (a.status === 'done' ? ' a-done' : '') + '" data-aid="' + a.id + '"><button type="button" class="a-status a-' + a.status + '" title="Статус"></button><div class="a-body"><div class="a-title' + (a.status === 'done' ? ' a-done' : '') + '">' + esc(a.title) + '</div>';
      if (a.note) html += '<div class="a-note">' + esc(a.note) + '</div>';
      html += '</div><button type="button" class="a-edit" title="Редактировать">✎</button><button type="button" class="a-del" title="Удалить">✕</button></div>';
    }
    html += '</div><div class="assignment-add"><input class="f-title new-ass-title" placeholder="＋ новое поручение" maxlength="200"><button type="button" class="btn primary new-ass-btn">Добавить</button></div></section>';
  }
  container.innerHTML = html;

  const addInp = container.querySelector('#newPersonName'), addBtn = container.querySelector('#addPersonBtn');
  const doAdd = async () => {
    const v = addInp.value.trim();
    if (!v) return;
    await addPerson({ name: v, mode });
    renderContactsView(container, mode);
  };
  addBtn.onclick = doAdd;
  addInp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };

  container.querySelectorAll('.contact-card').forEach(card => {
    const pid = card.dataset.id;
    card.querySelector('.contact-edit').onclick = () => openPersonEditor(pid, mode);
    card.querySelector('.contact-del').onclick = async () => {
      if (confirm('Удалить человека и все его поручения?')) {
        await removePerson(pid);
        renderContactsView(container, mode);
      }
    };
    const addTitle = card.querySelector('.new-ass-title'), addAssBtn = card.querySelector('.new-ass-btn');
    const doAddAss = async () => {
      const v = addTitle.value.trim();
      if (!v) return;
      await addAssignment(pid, { title: v });
      renderContactsView(container, mode);
    };
    addAssBtn.onclick = doAddAss;
    addTitle.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doAddAss(); } };
    card.querySelectorAll('.assignment-row').forEach(row => {
      const aid = row.dataset.aid;
      row.querySelector('.a-status').onclick = async () => {
        const a = getPerson(pid).assignments.find(x => x.id === aid);
        const order = ['todo', 'started', 'done', 'skipped'];
        await updateAssignment(pid, aid, { status: order[(order.indexOf(a.status) + 1) % order.length] });
        renderContactsView(container, mode);
      };
      row.querySelector('.a-edit').onclick = async () => {
        const a = getPerson(pid).assignments.find(x => x.id === aid);
        const nt = prompt('Текст поручения:', a.title);
        if (nt === null) return;
        const nn = prompt('Заметка:', a.note || '');
        if (nn === null) return;
        await updateAssignment(pid, aid, { title: nt.trim() || a.title, note: nn });
        renderContactsView(container, mode);
      };
      row.querySelector('.a-del').onclick = async () => {
        if (confirm('Удалить поручение?')) {
          await removeAssignment(pid, aid);
          renderContactsView(container, mode);
        }
      };
    });
  });
}

let editorOpen = false;
export function openPersonEditor(personId, mode) {
  if (editorOpen) return;
  const p = getPerson(personId);
  if (!p) return;
  editorOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'person-editor-backdrop';
  overlay.innerHTML = '<div class="person-editor glass"><header class="ed-head"><span class="ed-title">Человек</span><span class="spacer"></span><button type="button" class="icon-btn pe-cancel" title="Закрыть">✕</button></header><div class="ed-scroll"><textarea class="f-title pe-name" rows="1" maxlength="100" placeholder="Имя">' + esc(p.name) + '</textarea><section class="ed-card"><h4>Режим</h4><div class="chip-row pe-mode">' + ['work', 'home', 'study', 'all'].map(m => '<button type="button" class="chip' + (p.mode === m ? ' on' : '') + '" data-mode="' + m + '">' + modeLabel(m) + '</button>').join('') + '</div></section><section class="ed-card"><h4>Контакты</h4><input class="f-title pe-phone" placeholder="Телефон" value="' + esc(p.phone || '') + '"><input class="f-title pe-email" placeholder="Email" value="' + esc(p.email || '') + '"><input class="f-title pe-birthday" type="date" value="' + (p.birthday || '') + '"></section><section class="ed-card"><h4>Заметка</h4><textarea class="f-title pe-note" rows="2" placeholder="Заметка о человеке...">' + esc(p.note || '') + '</textarea></section></div><div class="ed-actions"><button type="button" class="btn danger pe-delete">Удалить</button><span class="spacer"></span><button type="button" class="btn pe-cancel2">✕</button><button type="button" class="btn primary pe-save">✓</button></div></div>';
  document.body.appendChild(overlay);
  const nameEl = overlay.querySelector('.pe-name');
  nameEl.style.height = 'auto';
  nameEl.style.height = nameEl.scrollHeight + 'px';
  nameEl.addEventListener('input', () => {
    nameEl.style.height = 'auto';
    nameEl.style.height = nameEl.scrollHeight + 'px';
  });
  overlay.querySelectorAll('.pe-mode .chip').forEach(b => {
    b.onclick = () => {
      overlay.querySelectorAll('.pe-mode .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    };
  });
  const close = () => {
    overlay.remove();
    editorOpen = false;
  };
  overlay.querySelectorAll('.pe-cancel, .pe-cancel2').forEach(b => { b.onclick = close; });
  overlay.querySelector('.pe-save').onclick = async () => {
    await updatePerson(personId, {
      name: nameEl.value.trim() || p.name,
      mode: overlay.querySelector('.pe-mode .chip.on').dataset.mode,
      phone: overlay.querySelector('.pe-phone').value.trim(),
      email: overlay.querySelector('.pe-email').value.trim(),
      birthday: overlay.querySelector('.pe-birthday').value,
      note: overlay.querySelector('.pe-note').value
    });
    close();
    const cv = document.getElementById('contactsView');
    if (cv && !cv.hidden) renderContactsView(cv, mode);
  };
  overlay.querySelector('.pe-delete').onclick = async () => {
    if (confirm('Удалить человека и все его поручения?')) {
      await removePerson(personId);
      close();
      const cv = document.getElementById('contactsView');
      if (cv && !cv.hidden) renderContactsView(cv, mode);
    }
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

export const getContactsForSync = () => state.people.filter(p => !p.deleted);

export async function applyContactsMerged(people) {
  const remote = Array.isArray(people) ? people : [];
  const byId = new Map();
  for (const p of state.people) {
    if (p && p.id) byId.set(p.id, p);
  }
  for (const rp of remote) {
    if (!rp || !rp.id) continue;
    if (!Array.isArray(rp.assignments)) rp.assignments = [];
    if (!rp.mode) rp.mode = 'all';
    const local = byId.get(rp.id);
    if (!local) {
      byId.set(rp.id, rp);
    } else if (String(rp.updatedAt || '') >= String(local.updatedAt || '')) {
      byId.set(rp.id, rp);
    }
  }
  state.people = [...byId.values()];
  try {
    await dbBulk(STORE, state.people);
  } catch (err) {
    console.error('[contacts] dbBulk failed:', err);
  }
  notify();
}
