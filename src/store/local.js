// Guest storage: everything lives in this browser's localStorage.
const K = 'chessarena:guest:';
const read = (k, d) => { try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) { console.warn('Storage full or blocked', e); } };

export const localStore = {
  kind: 'guest',
  async exportAll() { return { profile: read('profile', null), games: read('games', []) }; },
  async getProfile() { return read('profile', null); },
  async saveProfile(p) { write('profile', p); },
  async addGame(g) {
    const games = read('games', []);
    const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    games.unshift({ ...g, id });
    write('games', games.slice(0, 500));
    return id;
  },
  async listGames() { return read('games', []); },
  async getGame(id) { return read('games', []).find(g => g.id === id) || null; },
  async deleteGame(id) { write('games', read('games', []).filter(g => g.id !== id)); },
  async deleteAllGames() { write('games', []); },
  async deleteAccountData() { localStorage.removeItem(K + 'games'); localStorage.removeItem(K + 'profile'); },
};
