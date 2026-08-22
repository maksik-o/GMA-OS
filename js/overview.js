import { state, visibleTasks, sortTasks, today, addDays, esc, getTagColor } from './store.js';
import { openSheet } from './sheet.js';

const $ = id => document.getElementById(id);

export function renderOverview(){
  const t0 = today();
  const vis = visibleTasks();
  const has = (t,p) => Object.entries(t.days||{}).some(([d,s]) => p(d,s));

  const overdue  = sortTasks(vis.filter(t => has(t,(d,s)=> d<t0 && (s==='todo'||s==='started'))));
  // «Сегодня»: есть квадрат на сегодня и он НЕ «перенесено»
  const todayRows= sortTasks(vis.filter(t => { const st=(t.days||{})[t0]; return !!st && st!=='postponed'; }));
  const upcoming = sortTasks(vis.filter(t => has(t,(d,s)=> d>t0 && d<=addDays(t0,7) && s==='todo')));

  const row = t => {
    const tags=(t.tags||[]).slice(0,2).map(tg=>{ const c=getTagColor(tg); return `<span class="tag-pill"${c?` style="--tc:${c}"`:''}>${esc(tg)}</span>`; }).join('');
    return `<button type="button" class="s-row m-${t.mode}" data-id="${t.id}">
      <i class="prio p${t.priority}"></i>
      <span class="s-body"><span class="s-title">${esc(t.title)}</span><span class="s-meta">${tags}</span></span>
      <span class="chev">›</span>
    </button>`;
  };
  const sec=(title,rows,cls)=> rows.length ? `<section class="ov-pane glass ${cls||''}"><h3 class="ov-h ${cls||''}">${title} · ${rows.length}</h3>${rows.map(row).join('')}</section>` : '';

  $('overview').innerHTML =
    sec('Просрочено', overdue, 'ov-overdue') +
    sec('Сегодня', todayRows) +
    sec('Ближайшие 7 дней', upcoming) ||
    '<p class="hint" style="text-align:center">Пока пусто.</p>';

  $('overview').querySelectorAll('.s-row').forEach(b => b.onclick = () => {
    const t = state.tasks.find(x => x.id === b.dataset.id);
    if (t) openSheet(t);
  });
}
