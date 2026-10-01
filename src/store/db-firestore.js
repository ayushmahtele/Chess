// Small wrapper around Cloud Firestore so the rest of the app uses simple paths.
import {
  initializeFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, onSnapshot, runTransaction, serverTimestamp, arrayUnion, Timestamp, writeBatch,
} from 'firebase/firestore';

function decode(v) {
  if (v instanceof Timestamp) return v.toMillis();
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o; }
  return v;
}
const SERVER = { __server_time__: true };
// While a server time is still being written, show a local estimate instead of null.
const EST = { serverTimestamps: 'estimate' };
function encode(v) {
  if (v === SERVER) return serverTimestamp();
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object' && v.constructor === Object) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = encode(x); return o; }
  return v;
}

export function createFirestoreDb(app) {
  const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
  const ref = p => doc(fs, p);
  const q = (coll, o = {}) => {
    const parts = [collection(fs, coll)];
    for (const [f, op, val] of o.where || []) parts.push(where(f, op, val));
    if (o.orderBy) parts.push(orderBy(o.orderBy[0], o.orderBy[1] || 'asc'));
    if (o.limit) parts.push(limit(o.limit));
    return query(...parts);
  };
  let offset = 0;
  return {
    SERVER_TIME: SERVER,
    now: () => Date.now() + offset,
    async calibrate(uid) {
      try {
        const r = ref(`users/${uid}/meta/clock`), t0 = Date.now();
        await setDoc(r, { t: serverTimestamp() });
        const s = await getDoc(r); const t1 = Date.now();
        offset = s.data().t.toMillis() - (t0 + t1) / 2;
      } catch (e) { console.warn('clock sync failed', e); }
    },
    newId: coll => doc(collection(fs, coll)).id,
    async get(p) { const s = await getDoc(ref(p)); return s.exists() ? { ...decode(s.data(EST)), id: s.id } : null; },
    set: (p, data, merge = false) => setDoc(ref(p), encode(data), { merge }),
    update: (p, patch) => updateDoc(ref(p), encode(patch)),
    del: p => deleteDoc(ref(p)),
    async add(coll, data) { return (await addDoc(collection(fs, coll), encode(data))).id; },
    push: (p, field, item) => updateDoc(ref(p), { [field]: arrayUnion(encode(item)) }),
    async list(coll, o) { const s = await getDocs(q(coll, o)); return s.docs.map(d => ({ ...decode(d.data()), id: d.id })); },
    async delMany(paths) {
      for (let i = 0; i < paths.length; i += 400) { const b = writeBatch(fs); paths.slice(i, i + 400).forEach(p => b.delete(ref(p))); await b.commit(); }
    },
    watch(p, cb, onErr) { return onSnapshot(ref(p), s => cb(s.exists() ? { ...decode(s.data(EST)), id: s.id } : null), onErr || (e => console.error(e))); },
    watchQuery(coll, o, cb, onErr) { return onSnapshot(q(coll, o), s => cb(s.docs.map(d => ({ ...decode(d.data(EST)), id: d.id }))), onErr || (e => console.error(e))); },
    tx(fn) {
      return runTransaction(fs, t => fn({
        async get(p) { const s = await t.get(ref(p)); return s.exists() ? { ...decode(s.data()), id: s.id } : null; },
        set(p, data) { t.set(ref(p), encode(data)); },
        update(p, patch) { t.update(ref(p), encode(patch)); },
        del(p) { t.delete(ref(p)); },
      }));
    },
  };
}
