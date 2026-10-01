// In-browser stand-in for Firestore, used only for local testing (VITE_USE_EMULATOR=1).
// Shared between tabs through localStorage + BroadcastChannel.
const KEY = 'chessarena:fakedb';
const SERVER = { __server_time__: true };
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chessarena-fakedb') : null;
const listeners = new Set();
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
function fire() { listeners.forEach(f => f()); }
if (chan) chan.onmessage = () => fire();
window.addEventListener('storage', e => { if (e.key === KEY) fire(); });
function commit(s) { save(s); chan?.postMessage(1); setTimeout(fire, 0); }
// Cross-tab lock so two windows can't overwrite each other's writes (real Firestore does this on the server).
const locked = fn => navigator.locks ? navigator.locks.request('chessarena-fakedb', fn) : Promise.resolve(fn());
function enc(v) {
  if (v === SERVER || (v && v.__server_time__)) return Date.now();
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = enc(x); return o; }
  return v;
}
function applyPatch(data, patch) {
  const out = clone(data) || {};
  for (const [k, v] of Object.entries(enc(patch))) {
    const parts = k.split('.'); let o = out;
    for (const p of parts.slice(0, -1)) { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p]; }
    o[parts.at(-1)] = v;
  }
  return out;
}
const idOf = p => p.split('/').at(-1);
const inColl = (p, coll) => p.startsWith(coll + '/') && !p.slice(coll.length + 1).includes('/');
function runQuery(s, coll, o = {}) {
  let rows = Object.entries(s).filter(([p]) => inColl(p, coll)).map(([p, d]) => ({ ...clone(d.data), id: idOf(p) }));
  for (const [f, op, val] of o.where || []) rows = rows.filter(r => op === '==' ? r[f] === val : op === 'array-contains' ? (r[f] || []).includes(val) : op === '>' ? r[f] > val : true);
  if (o.orderBy) { const [f, dir] = o.orderBy; rows.sort((a, b) => (a[f] > b[f] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
  if (o.limit) rows = rows.slice(0, o.limit);
  return rows;
}

export function createFakeDb() {
  return {
    SERVER_TIME: SERVER,
    now: () => Date.now(),
    async calibrate() {},
    newId: () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    async get(p) { const d = load()[p]; return d ? { ...clone(d.data), id: idOf(p) } : null; },
    async set(p, data, merge = false) { return locked(() => { const s = load(); s[p] = { v: (s[p]?.v || 0) + 1, data: merge ? applyPatch(s[p]?.data, data) : enc(clone(data)) }; commit(s); }); },
    async update(p, patch) { return locked(() => { const s = load(); if (!s[p]) throw new Error('No document to update: ' + p); s[p] = { v: s[p].v + 1, data: applyPatch(s[p].data, patch) }; commit(s); }); },
    async del(p) { return locked(() => { const s = load(); delete s[p]; commit(s); }); },
    async add(coll, data) { const id = this.newId(); await this.set(`${coll}/${id}`, data); return id; },
    async push(p, field, item) { return locked(() => { const s = load(); const d = s[p]; if (!d) throw new Error('No document'); d.data[field] = [...(d.data[field] || []), enc(item)]; d.v++; commit(s); }); },
    async list(coll, o) { return runQuery(load(), coll, o); },
    async delMany(paths) { return locked(() => { const s = load(); paths.forEach(p => delete s[p]); commit(s); }); },
    watch(p, cb) {
      let last = '__init__';
      const f = () => { const d = load()[p]; const j = JSON.stringify(d || null); if (j !== last) { last = j; cb(d ? { ...clone(d.data), id: idOf(p) } : null); } };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    watchQuery(coll, o, cb) {
      let last = '__init__';
      const f = () => { const r = runQuery(load(), coll, o); const j = JSON.stringify(r); if (j !== last) { last = j; cb(r); } };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async tx(fn) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const snap = load(), seen = {}, writes = [];
        const result = await fn({
          async get(p) { seen[p] = snap[p]?.v || 0; const d = snap[p]; return d ? { ...clone(d.data), id: idOf(p) } : null; },
          set(p, data) { writes.push(['set', p, data]); },
          update(p, patch) { writes.push(['update', p, patch]); },
          del(p) { writes.push(['del', p]); },
        });
        const ok = await locked(() => {
          const s = load();
          if (Object.entries(seen).some(([p, v]) => (s[p]?.v || 0) !== v)) return false;   // conflict: retry
          for (const [op, p, d] of writes) {
            if (op === 'set') s[p] = { v: (s[p]?.v || 0) + 1, data: enc(clone(d)) };
            else if (op === 'update') { if (!s[p]) throw new Error('No document to update: ' + p); s[p] = { v: s[p].v + 1, data: applyPatch(s[p].data, d) }; }
            else delete s[p];
          }
          commit(s); return true;
        });
        if (ok) return result;
      }
      throw new Error('Transaction failed after retries');
    },
  };
}
