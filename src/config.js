// Change the site name here.
export const APP_NAME = 'Chess Arena';

export const TIME_CONTROLS = [
  { id: 'none', label: 'No clock', base: 0, inc: 0, group: 'Casual' },
  { id: '1+0', label: '1 min', base: 60, inc: 0, group: 'Bullet' },
  { id: '2+1', label: '2 | 1', base: 120, inc: 1, group: 'Bullet' },
  { id: '3+0', label: '3 min', base: 180, inc: 0, group: 'Blitz' },
  { id: '3+2', label: '3 | 2', base: 180, inc: 2, group: 'Blitz' },
  { id: '5+0', label: '5 min', base: 300, inc: 0, group: 'Blitz' },
  { id: '10+0', label: '10 min', base: 600, inc: 0, group: 'Rapid' },
  { id: '15+10', label: '15 | 10', base: 900, inc: 10, group: 'Rapid' },
  { id: '30+0', label: '30 min', base: 1800, inc: 0, group: 'Rapid' },
];

export const BOT_LEVELS = [
  { elo: 400, name: 'Pawnstorm' }, { elo: 600, name: 'Rookie' }, { elo: 800, name: 'Club Kid' },
  { elo: 1000, name: 'Weekend Player' }, { elo: 1200, name: 'Tactician' }, { elo: 1400, name: 'Strategist' },
  { elo: 1600, name: 'Candidate' }, { elo: 1800, name: 'Expert' }, { elo: 2000, name: 'Engine Max' },
];
export const botName = elo => (BOT_LEVELS.slice().reverse().find(b => elo >= b.elo) || BOT_LEVELS[0]).name;
