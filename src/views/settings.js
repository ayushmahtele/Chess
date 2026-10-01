import { h, clear } from '../dom.js';
import { getPrefs, setPref } from '../prefs.js';
import { createBoard, positionOf } from '../board.js';
import { sfx, playTheme, SOUND_THEMES } from '../audio/sfx.js';
import { Chess } from 'chess.js';

export const SETS_2D = [
  ['cburnett', 'Classic'], ['merida', 'Merida'], ['chessnut', 'Chessnut'], ['celtic', 'Celtic'],
  ['fantasy', 'Fantasy'], ['spatial', 'Spatial'], ['papercut', 'Papercut'], ['rhosgfx', 'Cartoon'], ['original', 'Original'],
];
export const SETS_3D = [
  ['wood', 'Wood'], ['porcelain', 'Porcelain'], ['metal', 'Metal'], ['glass', 'Glass'],
  ['tournament', 'Tournament'], ['modernwood', 'Rosewood'], ['jade', 'Jade'],
];
export const BOARDS_2D = [['green', 'Green'], ['brown', 'Wood'], ['blue', 'Ice'], ['slate', 'Slate'], ['purple', 'Lavender']];
export const BOARDS_3D = [
  ['lightwood', 'Light wood'], ['rosewood', 'Rosewood'], ['woodglass', 'Wood & glass'], ['jade', 'Jade'],
  ['blue', 'Classic blue'], ['goldsilver', 'Gold & silver'], ['aluminium', 'Aluminium'], ['glass', 'Glass'],
];
const SWATCH = { green: ['#ebebd0', '#779556'], brown: ['#f0d9b5', '#b58863'], blue: ['#dee3e6', '#8ca2ad'], slate: ['#c8ccd2', '#6b7380'], purple: ['#e8e2f2', '#8a73b0'] };

// move, capture, castle, check — one after another
function demoSounds(theme) { ['move', 'capture', 'castle', 'check'].forEach((n, i) => setTimeout(() => playTheme(theme, n), i * 520)); }

export async function settingsView(main) {
  const preview = createBoard({ canSelect: () => false, legalFrom: () => [], autoQueen: () => true, onMove: () => {} });
  const demo = new Chess(); ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].forEach(m => demo.move(m));
  const wrap = h('div.preview-wrap', { style: { '--b': 'min(340px, calc(100vw - 72px))' } }, preview.el);
  const body = h('div.side-stack');

  const sw = (key, title, sub) => h('label.switch', h('span', h('b', title), sub && h('small', sub)),
    h('input.toggle', { type: 'checkbox', checked: getPrefs()[key], on: { change: e => { setPref(key, e.target.checked); paint(); } } }));
  const sel = (key, title, opts) => h('label.switch', h('b', title), h('select.select', { on: { change: e => { setPref(key, e.target.value); paint(); render(); } } },
    opts.map(([v, l]) => h('option', { value: v, selected: getPrefs()[key] === v }, l))));
  const pick = (key, value, label, visual) => h('button.pick', { 'aria-pressed': String(getPrefs()[key] === value), on: { click: () => { setPref(key, value); render(); } } }, visual, label);

  function render() {
    const p = getPrefs(), is3d = p.view === '3d';
    clear(body).append(
      h('div.card', h('h2', 'Board & pieces'),
        h('div.seg', { style: { marginBottom: '16px' } },
          h('button', { 'aria-pressed': String(!is3d), on: { click: () => { setPref('view', '2d'); render(); } } }, 'Flat (2D)'),
          h('button', { 'aria-pressed': String(is3d), on: { click: () => { setPref('view', '3d'); render(); } } }, '3D')),
        h('div.field', h('span.lbl', is3d ? 'Piece material' : 'Piece style'),
          h('div.pick-grid', is3d
            ? SETS_3D.map(([v, l]) => pick('set3d', v, l, h('span.imgs', h('img', { src: `/pieces3d/${v}/wK.webp`, alt: '' }), h('img', { src: `/pieces3d/${v}/bN.webp`, alt: '' }))))
            : SETS_2D.map(([v, l]) => pick('set2d', v, l, h('span.imgs', h('img', { src: v === 'original' ? '/pieces/wK.png' : `/pieces2d/${v}/wK.svg`, alt: '' }), h('img', { src: v === 'original' ? '/pieces/bN.png' : `/pieces2d/${v}/bN.svg`, alt: '' })))))),
        h('div.field', h('span.lbl', 'Board'),
          h('div.pick-grid', is3d
            ? BOARDS_3D.map(([v, l]) => pick('board3d', v, l, h('img.bthumb', { src: `/boards3d/${v}-thumb.webp`, alt: '' })))
            : BOARDS_2D.map(([v, l]) => pick('boardTheme', v, l, h('span.swatch', { style: { '--l': SWATCH[v][0], '--d': SWATCH[v][1] } }))))),
        !is3d && sw('coords', 'Show coordinates'),
        sw('highlightLast', 'Highlight last move'), sw('animate', 'Animate pieces')),
      h('div.card', h('h2', 'Gameplay'),
        sw('legalHints', 'Show legal moves', 'Dots on the squares a selected piece can move to'),
        sw('autoQueen', 'Always promote to queen', 'Skip the promotion picker'),
        sw('autoFlip', 'Flip board each turn', 'In same-device games, the side to move is always at the bottom'),
        sw('evalBar', 'Evaluation bar in casual games', 'Rated games never show it until the game ends'),
        sw('confirmResign', 'Ask before resigning')),
      h('div.card', h('h2', 'Sound'),
        h('div.field', h('span.lbl', 'Move sounds'),
          h('div.sound-list', SOUND_THEMES.map(([v, name, about]) => h('div.sound-opt', { class: p.soundTheme === v ? 'on' : '' },
            h('button.sound-pick', { 'aria-pressed': String(p.soundTheme === v), on: { click: () => { setPref('soundTheme', v); demoSounds(v); render(); } } },
              h('span.radio'), h('span', h('b', name), h('small', about))),
            h('button.icon-btn', { title: 'Listen to ' + name, 'aria-label': 'Listen to ' + name, on: { click: () => demoSounds(v) } }, '▶'))))),
        h('div.vol', h('label', { for: 'sv' }, 'Effects'), h('input.range', { id: 'sv', type: 'range', min: 0, max: 1, step: .01, value: p.sfxVolume, on: { input: e => setPref('sfxVolume', +e.target.value), change: () => sfx.move() } })),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '8px 0' } },
          [['Move', 'move'], ['Capture', 'capture'], ['Castle', 'castle'], ['Check', 'check'], ['Win', 'win']].map(([l, f]) => h('button.chip', { on: { click: () => sfx[f]() } }, '▶ ' + l))),
        h('p.note', 'Background music, its volume and your own songs are in the music button at the top of every page.')),
      h('div.card', h('h2', 'Appearance'),
        sel('theme', 'Theme', [['system', 'Match my device'], ['dark', 'Dark'], ['light', 'Light']])),
      h('div.card.credits', h('h2', 'Credits'),
        h('p', '3D pieces and boards: Staunton renders by James Clarke (MIT). Piece sets from the open-source lichess project: Classic by Colin M.L. Burnett (GPLv2+), Merida by Armando Hernández Marroquín (GPLv2+), Chessnut by Alexis Luengas (Apache 2.0), Celtic, Fantasy and Spatial by Maurizio Monge (MIT), Papercut by Nikolay Anzarov (CC BY 4.0), Cartoon by RhosGFX (CC0). Full details in CREDITS.md.')));
    paint();
  }
  function paint() {
    const p = getPrefs();
    preview.set({ position: positionOf(demo), lastMove: ['a7', 'a6'], theme: p.boardTheme, showCoords: p.coords, showLast: p.highlightLast, interactive: false });
  }
  main.append(h('div.page-head', h('h1', 'Settings')),
    h('div.profile', { style: { marginTop: '18px' } }, body, h('div.card.sticky-preview', h('h2', 'Preview'), wrap)));
  render();
}
