import { h, clear, confirmBox, toast, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { session } from '../store/index.js';
import { TIME_CONTROLS } from '../config.js';
import { categoryOfTc } from '../rating.js';

const tcName = id => TIME_CONTROLS.find(t => t.id === id)?.label || 'No clock';

export function gameRow(g, onDelete) {
  const badge = { win: ['win', 'W'], loss: ['loss', 'L'], draw: ['draw', '½'], aborted: ['aborted', '—'], white: ['local', '1-0'], black: ['local', '0-1'] }[g.outcome] || ['draw', '?'];
  const opp = g.mode === 'bot' ? (g.color === 'w' ? g.black : g.white) : g.mode === 'online' ? `@${g.opponent} (online)` : 'Two players';
  const delta = g.ratingAfter != null ? g.ratingAfter - g.ratingBefore : null;
  const reason = g.outcome === 'aborted' ? 'Aborted' : g.reason[0].toUpperCase() + g.reason.slice(1);
  return h('a.grow', { href: '#/review/' + g.id },
    h('span.badge', { class: badge[0], 'aria-label': g.outcome }, badge[1]),
    h('div', { style: { minWidth: 0 } },
      h('div.t', g.mode !== 'local' ? `vs ${opp}` : opp),
      h('div.s', `${reason} · ${Math.ceil((g.plies || 0) / 2)} moves · ${tcName(g.timeControl)} · ${g.rated ? 'Rated' : 'Casual'} · ${fmtDate(g.endedAt)}`)),
    delta != null ? h('span.delta', { class: delta >= 0 ? 'up' : 'down' }, (delta >= 0 ? '+' : '') + delta) : h('span'),
    onDelete ? h('button.trash', { title: 'Delete game', 'aria-label': 'Delete game', on: { click: e => { e.preventDefault(); e.stopPropagation(); onDelete(g); } } }, icon('trash')) : null);
}

export async function historyView(main) {
  const store = session().store;
  let games = [], filter = 'all', time = 'all';
  const list = h('div.glist', h('p.muted', 'Loading your games…'));
  const filters = h('div.filters');
  const FILTERS = [['all', 'All'], ['win', 'Wins'], ['loss', 'Losses'], ['draw', 'Draws'], ['aborted', 'Aborted'], ['online', 'Online'], ['bot', 'vs Computer'], ['local', 'Same device'], ['rated', 'Rated']];
  const delAll = h('button.btn', { on: { click: deleteAll } }, icon('trash'), 'Delete all');

  function match(g) {
    if (time !== 'all') { if (time === 'computer' ? g.mode !== 'bot' : (g.mode === 'bot' || categoryOfTc(g.timeControl) !== time)) return false; }
    if (filter === 'all') return true;
    if (filter === 'bot' || filter === 'local' || filter === 'online') return g.mode === filter;
    if (filter === 'rated') return g.rated;
    return g.outcome === filter;
  }
  function render() {
    const TIMES = [['all', 'All times'], ['bullet', '⚡ Bullet'], ['blitz', '🔥 Blitz'], ['rapid', '⏱ Rapid'], ['noclock', '♾ No clock'], ['computer', '🤖 vs Computer']];
    clear(filters).append(
      h('div.frow', h('span.flabel', 'Time'), TIMES.map(([k, l]) => h('button.chip', { 'aria-pressed': String(time === k), on: { click: () => { time = k; render(); } } }, l))),
      h('div.frow', h('span.flabel', 'Show'), FILTERS.map(([k, l]) => h('button.chip', { 'aria-pressed': String(filter === k), on: { click: () => { filter = k; render(); } } }, l))));
    const shown = games.filter(match);
    delAll.disabled = !games.length;
    clear(list);
    if (!games.length) list.append(h('div.empty', h('p', 'No games yet. Every game you finish or abort is saved here.'), h('a.btn.primary', { href: '#/' }, 'Play a game')));
    else if (!shown.length) list.append(h('div.empty', 'No games match this filter.'));
    else list.append(...shown.map(g => gameRow(g, del)));
  }
  async function del(g) {
    if (!(await confirmBox('Delete this game?', 'It will be removed from your history. Your rating stays the same.', 'Delete', true))) return;
    try { await store.deleteGame(g.id); games = games.filter(x => x.id !== g.id); render(); toast('Game deleted'); }
    catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  }
  async function deleteAll() {
    if (!(await confirmBox('Delete all games?', `All ${games.length} saved games will be permanently removed. Your rating stays the same.`, 'Delete all', true))) return;
    try { await store.deleteAllGames(); games = []; render(); toast('All games deleted'); }
    catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  }

  main.append(h('div.page-head', h('div', h('h1', 'Game history'), h('p.muted', { style: { margin: '6px 0 0' } }, 'Open a game to replay it move by move or download its PGN.')), delAll), filters, list);
  render();
  try { games = await store.listGames(); render(); }
  catch (e) { clear(list).append(h('div.empty', 'Could not load your games: ' + e.message)); }
}
