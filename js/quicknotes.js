import { dbGetKV, dbSetKV } from './db.js';

const $ = id => document.getElementById(id);
let notes = [];
let saveTimeout = null;

export async function init() {
  const stored = await dbGetKV('quickNotes');
  notes = stored || [];
  render();
  setupEvents();
}

function setupEvents() {
  $('qnAdd').addEventListener('click', addNote);
}

function addNote() {
  const newNote = {
    id: Date.now().toString(),
    text: '',
    createdAt: Date.now()
  };
  notes.unshift(newNote);
  render();
  save();
  
  // Focus on the new note's textarea
  setTimeout(() => {
    const el = $(`qnText_${newNote.id}`);
    if (el) {
      el.focus();
      el.select();
    }
  }, 50);
}

function deleteNote(id) {
  notes = notes.filter(n => n.id !== id);
  render();
  save();
}

function updateNote(id, text) {
  const note = notes.find(n => n.id === id);
  if (note) {
    note.text = text;
    note.updatedAt = Date.now();
    save();
  }
}

function save() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await dbSetKV('quickNotes', notes);
  }, 300);
}

function render() {
  const list = $('qnList');
  if (!list) return;
  
  if (notes.length === 0) {
    list.innerHTML = '<div class="qn-empty">Нет заметок. Нажмите + чтобы добавить.</div>';
    return;
  }
  
  list.innerHTML = notes.map(note => `
    <div class="qn-item" data-id="${note.id}">
      <textarea 
        class="qn-text" 
        id="qnText_${note.id}" 
        placeholder="Заметка..."
        rows="1"
      >${escapeHtml(note.text)}</textarea>
      <div class="qn-actions">
        <button class="qn-del" type="button" title="Удалить" data-id="${note.id}">✕</button>
      </div>
    </div>
  `).join('');
  
  // Attach events
  list.querySelectorAll('.qn-text').forEach(el => {
    el.addEventListener('input', handleInput);
    el.addEventListener('keydown', handleKeydown);
    autoResize(el);
  });
  
  list.querySelectorAll('.qn-del').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      deleteNote(id);
    });
  });
}

function handleInput(e) {
  const id = e.target.id.replace('qnText_', '');
  updateNote(id, e.target.value);
  autoResize(e.target);
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // Add new note on Enter
    addNote();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function refresh() {
  render();
}
