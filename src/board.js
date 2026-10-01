// Interactive chess board: click or drag to move, right-click to mark squares
// and draw arrows, promotion picker, move animation.
import { h } from './dom.js';
import { getPrefs } from './prefs.js';

const FILES = 'abcdefgh';

/** Piece image for the current preferences. small = for captured-piece icons and menus (always flat). */
export function pieceUrl(p, { small = false, orientation = 'w' } = {}) {
  const pr = getPrefs(), code = p.color + p.type.toUpperCase();
  if (!small && pr.view === '3d') {
    const flip = orientation === 'b' && (p.type === 'n' || p.type === 'b') ? 'f' : '';
    return `/pieces3d/${pr.set3d}/${code}${flip}.webp`;
  }
  const set = pr.set2d || 'cburnett';
  return set === 'original' ? `/pieces/${code}.png` : `/pieces2d/${set}/${code}.svg`;
}
const PIECE_IMG = (p, o) => pieceUrl(p, { orientation: o });
const sqXY = (sq, orient) => {
  const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
  return orient === 'w' ? [f, 7 - r] : [7 - f, r];
};

export function createBoard(opts) {
  const st = {
    position: null, orientation: 'w', selected: null, targets: [], lastMove: null,
    check: null, hint: null, badge: null, marks: new Set(), arrows: [], interactive: false,
    showCoords: true, showHints: true, showLast: true, animate: true, theme: 'green',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 8 8'); svg.classList.add('arrows');
  svg.innerHTML = `<defs>
    <marker id="ah-user" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="rgba(255,170,0,.85)"/></marker>
    <marker id="ah-hint" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="rgba(80,160,255,.9)"/></marker></defs><g></g>`;
  const grid = h('div.grid');
  const field = h('div.playfield', grid, svg);
  const surface = h('div.surface', field);
  const el = h('div.board', { role: 'grid', 'aria-label': 'Chess board' }, surface);
  const squares = {};

  function build() {
    grid.innerHTML = '';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const file = st.orientation === 'w' ? col : 7 - col;
      const rank = st.orientation === 'w' ? 7 - row : row;
      const sq = FILES[file] + (rank + 1);
      const d = h('div.sq', { 'data-sq': sq, class: (file + rank) % 2 ? 'light' : 'dark', role: 'gridcell' });
      squares[sq] = d; grid.append(d);
    }
  }
  build();

  function render(animateMove) {
    const pr = getPrefs(), is3d = pr.view === '3d';
    el.className = 'board theme-' + st.theme + (st.interactive ? ' interactive' : '') + (is3d ? ' is3d' : '');
    surface.style.backgroundImage = is3d ? `url(/boards3d/${pr.board3d || 'lightwood'}.webp)` : '';
    for (const [sq, d] of Object.entries(squares)) {
      const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
      const cls = ['sq', (f + r) % 2 ? 'light' : 'dark'];
      if (st.showLast && st.lastMove && (st.lastMove[0] === sq || st.lastMove[1] === sq)) cls.push('last');
      if (st.selected === sq) cls.push('selected');
      const t = st.targets.find(m => m.to === sq);
      if (t && st.showHints) cls.push(t.captured || t.flags?.includes('e') ? 'target-cap' : 'target');
      if (st.check === sq) cls.push('check');
      if (st.marks.has(sq)) cls.push('marked');
      if (st.hint && (st.hint[0] === sq || st.hint[1] === sq)) cls.push('hinted');
      d.className = cls.join(' ');
      d.textContent = '';
      const p = st.position?.[sq];
      const [x, y] = sqXY(sq, st.orientation);
      if (p) d.append(h('img.piece', { src: PIECE_IMG(p, st.orientation), alt: '', draggable: false, style: is3d ? { zIndex: 3 + y } : null }));
      if (st.badge && st.badge.sq === sq) d.append(h('span.move-badge', { class: st.badge.cls, title: st.badge.title || '' }, st.badge.sym));
      if (st.showCoords && x === 0) d.append(h('span.coord.rank', sq[1]));
      if (st.showCoords && y === 7) d.append(h('span.coord.file', sq[0]));
      d.setAttribute('aria-label', sq + (p ? ` ${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}` : ''));
    }
    drawArrows();
    if (animateMove && st.animate) animate(animateMove[0], animateMove[1]);
  }
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  function animate(from, to) {
    const img = squares[to]?.querySelector('img.piece'); if (!img) return;
    const [fx, fy] = sqXY(from, st.orientation), [tx, ty] = sqXY(to, st.orientation);
    const cw = squares[to].offsetWidth, ch = squares[to].offsetHeight;
    img.style.transition = 'none';
    img.style.transform = `translate(${(fx - tx) * cw}px, ${(fy - ty) * ch}px)`;
    const z = img.style.zIndex; img.style.zIndex = 30;
    img.getBoundingClientRect();
    img.style.transition = 'transform 170ms cubic-bezier(.3,.7,.4,1)';
    img.style.transform = '';
    setTimeout(() => { img.style.zIndex = z; }, 180);
  }

  function drawArrows() {
    const g = svg.querySelector('g'); g.innerHTML = '';
    const list = st.arrows.map(a => ({ ...a, kind: 'user' }));
    if (st.hint) list.push({ from: st.hint[0], to: st.hint[1], kind: 'hint' });
    for (const a of list) {
      const [x1, y1] = sqXY(a.from, st.orientation), [x2, y2] = sqXY(a.to, st.orientation);
      const cx1 = x1 + .5, cy1 = y1 + .5, cx2 = x2 + .5, cy2 = y2 + .5;
      const len = Math.hypot(cx2 - cx1, cy2 - cy1), sh = 0.38 / len;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx1); line.setAttribute('y1', cy1);
      line.setAttribute('x2', cx2 - (cx2 - cx1) * sh); line.setAttribute('y2', cy2 - (cy2 - cy1) * sh);
      line.setAttribute('class', 'arrow ' + a.kind);
      line.setAttribute('marker-end', `url(#ah-${a.kind})`);
      g.append(line);
    }
  }

  /* ---------- pointer handling ---------- */
  let drag = null, rightStart = null;
  const sqFromPoint = (x, y) => document.elementsFromPoint(x, y).find(n => n.classList?.contains('sq') && el.contains(n))?.dataset.sq || null;

  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    const sq = sqFromPoint(e.clientX, e.clientY); if (!sq) return;
    if (e.button === 2) { rightStart = sq; return; }
    if (e.button !== 0) return;
    if (st.marks.size || st.arrows.length) { st.marks.clear(); st.arrows = []; render(); }
    if (!st.interactive) return;
    // click-to-move
    if (st.selected && st.targets.some(m => m.to === sq)) { tryMove(st.selected, sq); return; }
    const p = st.position?.[sq];
    if (p && opts.canSelect(sq, p)) {
      const wasSelected = st.selected === sq;
      select(sq);
      const img = squares[sq].querySelector('img.piece');
      const size = squares[sq].offsetWidth, gh = img.offsetHeight || size;
      const ghost = h('img.ghost', { src: img.src, alt: '', style: { width: size + 'px', height: gh + 'px' } });
      document.body.append(ghost);
      drag = { from: sq, ghost, img, wasSelected, moved: false, startX: e.clientX, startY: e.clientY, size, gh };
      moveGhost(e.clientX, e.clientY);
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else { deselect(); }
  });
  function moveGhost(x, y) { drag.ghost.style.left = x - drag.size / 2 + 'px'; drag.ghost.style.top = y - drag.gh * 0.62 + 'px'; }
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) { drag.moved = true; drag.img.style.opacity = '.25'; drag.ghost.classList.add('on'); }
    if (drag.moved) {
      moveGhost(e.clientX, e.clientY);
      const over = sqFromPoint(e.clientX, e.clientY);
      el.querySelectorAll('.sq.hover').forEach(n => n.classList.remove('hover'));
      if (over && st.targets.some(m => m.to === over)) squares[over].classList.add('hover');
    }
  });
  el.addEventListener('pointerup', e => {
    if (e.button === 2 && rightStart) {
      const sq = sqFromPoint(e.clientX, e.clientY);
      if (sq === rightStart) { st.marks.has(sq) ? st.marks.delete(sq) : st.marks.add(sq); }
      else if (sq) {
        const i = st.arrows.findIndex(a => a.from === rightStart && a.to === sq);
        if (i >= 0) st.arrows.splice(i, 1); else st.arrows.push({ from: rightStart, to: sq });
      }
      rightStart = null; render(); return;
    }
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost.remove(); d.img.style.opacity = '';
    el.querySelectorAll('.sq.hover').forEach(n => n.classList.remove('hover'));
    const sq = sqFromPoint(e.clientX, e.clientY);
    if (d.moved) {
      if (sq && sq !== d.from && st.targets.some(m => m.to === sq)) tryMove(d.from, sq, true);
      else if (sq !== d.from) deselect();
    } else if (d.wasSelected) deselect();
  });
  el.addEventListener('pointercancel', () => { if (drag) { drag.ghost.remove(); drag.img.style.opacity = ''; drag = null; } });

  function select(sq) { st.selected = sq; st.targets = opts.legalFrom(sq); render(); }
  function deselect() { if (!st.selected) return; st.selected = null; st.targets = []; render(); }

  async function tryMove(from, to, dragged) {
    const cands = st.targets.filter(m => m.to === to);
    let promotion;
    if (cands.some(m => m.promotion)) {
      promotion = opts.autoQueen() ? 'q' : await pickPromotion(to, st.position[from].color);
      if (!promotion) { deselect(); return; }
    }
    st.selected = null; st.targets = [];
    opts.onMove(from, to, promotion, dragged);
  }

  function pickPromotion(sq, color) {
    return new Promise(res => {
      const [x, y] = sqXY(sq, st.orientation);
      const down = y === 0;
      const box = h('div.promo', { style: { left: x * 12.5 + '%', [down ? 'top' : 'bottom']: '0' } },
        ['q', 'n', 'r', 'b'].map(t => h('button', { 'aria-label': 'Promote to ' + NAMES[t], on: { click: ev => { ev.stopPropagation(); done(t); } } },
          h('img', { src: pieceUrl({ color, type: t }, { small: true }), alt: '' }))));
      const shade = h('div.promo-shade', { on: { pointerdown: ev => { ev.stopPropagation(); done(null); } } });
      const done = v => { box.remove(); shade.remove(); res(v); };
      field.append(shade, box);
      box.querySelector('button').focus();
    });
  }

  return {
    el,
    set(patch, animateMove) {
      const reorient = patch.orientation && patch.orientation !== st.orientation;
      Object.assign(st, patch);
      if ('position' in patch || 'interactive' in patch) { if (!st.interactive) { st.selected = null; st.targets = []; } }
      if (reorient) build();
      render(animateMove);
    },
    clearSelection() { st.selected = null; st.targets = []; render(); },
    clearMarks() { st.marks.clear(); st.arrows = []; render(); },
    get orientation() { return st.orientation; },
  };
}

/** Convert chess.js board() to {square: {type,color}} */
export function positionOf(chess) {
  const out = {};
  for (const row of chess.board()) for (const p of row) if (p) out[p.square] = { type: p.type, color: p.color };
  return out;
}
