/* Matchmaking page: who's here → balanced rounds → start each game live.
   The rules live in js/matchmaker.js; this file is the screen. The night's
   plan is kept on this phone only (localStorage), so nothing new is stored in
   the Sheet; a new day starts a fresh night. */

const MM_STORAGE_KEY = 'pickleballMatchmaking';
const MM_RECENT_DAYS = 21;
const mm$ = (id) => document.getElementById(id);

let mmRoster = [];      // active players from the leaderboard
let mmRatings = {};     // name -> league rating
let mmRecent = [];      // recent games as { a, b } for the light repeat penalty
let mmPicked = null;    // { game: index | 'sit', side: 'a' | 'b' | null, i } during a swap

function mmToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mmDefaultNight() {
  return { day: mmToday(), present: [], courts: 1, format: 'Doubles', mode: 'balanced', target: 11, rounds: [] };
}

function mmLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem(MM_STORAGE_KEY) || 'null');
    if (!saved) return mmDefaultNight();
    // A new day keeps who came and the settings, but starts the rounds over.
    if (saved.day !== mmToday()) return { ...mmDefaultNight(), present: saved.present || [], courts: saved.courts || 1, format: saved.format || 'Doubles', mode: saved.mode || 'balanced', target: saved.target || 11 };
    return { ...mmDefaultNight(), ...saved };
  } catch (e) {
    return mmDefaultNight();
  }
}

let night = mmLoad();

function mmSave() {
  try { localStorage.setItem(MM_STORAGE_KEY, JSON.stringify(night)); } catch (e) { /* private mode: the plan just won't survive a reload */ }
}

function mmEsc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mmFirst(name) { return String(name).trim().split(/\s+/)[0] || ''; }
function mmInitials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function mmTeam(names) { return names.map(mmFirst).join(' & '); }

function mmCurrentRound() {
  return night.rounds.length ? night.rounds[night.rounds.length - 1] : null;
}

// ---------- rendering ----------

function renderRoster() {
  const present = new Set(night.present);
  mm$('mm-roster').innerHTML = mmRoster.map((p) => {
    const on = present.has(p.Name);
    return `<button type="button" class="player-chip${on ? ' picked' : ''}" data-player="${mmEsc(p.Name)}" aria-pressed="${on}">`
      + `<span class="chip-slot">${on ? '✓' : ''}</span><span class="chip-name">${mmEsc(p.Name)}</span>`
      + `<span class="chip-elo">${Math.round(Number(p.Elo) || 1000)}</span></button>`;
  }).join('');
  mm$('mm-count').textContent = `${night.present.length} here`;
}

function renderSettings() {
  mm$('mm-courts').textContent = night.courts;
  document.querySelectorAll('#mm-format button').forEach((b) => b.classList.toggle('active', b.dataset.format === night.format));
  document.querySelectorAll('#mm-target button').forEach((b) => b.classList.toggle('active', Number(b.dataset.target) === night.target));
  mm$('mm-mode').innerHTML = Object.keys(MATCHMAKING_MODES).map((k) => `<button type="button" data-mode="${k}" class="${k === night.mode ? 'active' : ''}">${mmEsc(MATCHMAKING_MODES[k].label)}</button>`).join('');
  mm$('mm-mode-help').textContent = MATCHMAKING_MODES[night.mode].explain;
}

function nameButton(name, where) {
  const picked = mmPicked && mmPicked.name === name;
  return `<button type="button" class="mm-name${picked ? ' picked' : ''}" data-name="${mmEsc(name)}" data-where="${where}">`
    + `<span class="mm-av">${mmEsc(mmInitials(name))}</span>${mmEsc(name)}</button>`;
}

function liveLink(game) {
  const q = new URLSearchParams({ from: 'mm', format: game.a.length === 2 ? 'Doubles' : 'Singles', target: String(night.target) });
  q.set('a', game.a[0]); q.set('b', game.b[0]);
  if (game.a.length === 2) { q.set('a2', game.a[1]); q.set('b2', game.b[1]); }
  return 'live-game.html?' + q.toString();
}

function logLink(game) {
  const q = new URLSearchParams({ format: game.a.length === 2 ? 'Doubles' : 'Singles' });
  q.set('a', game.a[0]); q.set('b', game.b[0]);
  if (game.a.length === 2) { q.set('a2', game.a[1]); q.set('b2', game.b[1]); }
  return 'log-game.html?' + q.toString();
}

function renderRound() {
  const round = mmCurrentRound();
  mm$('mm-make').textContent = `Make round ${night.rounds.length + 1}`;
  mm$('mm-round').style.display = round ? 'block' : 'none';
  if (!round) { renderEarlier(); return; }
  mm$('mm-round-title').textContent = `Round ${night.rounds.length}`;
  mm$('mm-swap-hint').textContent = mmPicked ? `Now tap who ${mmFirst(mmPicked.name)} swaps with.` : 'Tap a name, then another, to swap them.';
  mm$('mm-swap-hint').classList.toggle('active', Boolean(mmPicked));
  mm$('mm-games').innerHTML = round.games.map((g, gi) => {
    const pA = Math.round(g.chanceA * 100);
    return `<div class="mm-game">`
      + `<div class="mm-game-head"><span>Court ${gi + 1} · ${g.a.length === 2 ? 'Doubles' : 'Singles'}</span><span>${pA}% · ${100 - pA}%</span></div>`
      + `<div class="mm-team side-a">${g.a.map((n) => nameButton(n, `${gi}:a`)).join('')}</div>`
      + `<div class="mm-vs"><i style="width:${pA}%"></i></div>`
      + `<div class="mm-team side-b">${g.b.map((n) => nameButton(n, `${gi}:b`)).join('')}</div>`
      + `<div class="mm-actions"><a class="btn mm-play" href="${mmEsc(liveLink(g))}">Play live</a><a class="btn secondary mm-log" href="${mmEsc(logLink(g))}">Log score</a></div>`
      + `</div>`;
  }).join('');
  mm$('mm-sitout').innerHTML = round.sitOut.length
    ? `<span class="live-option-label">Sitting out</span><div class="mm-sitout-names">${round.sitOut.map((n) => nameButton(n, 'sit')).join('')}</div>`
    : '';
  renderEarlier();
}

function renderEarlier() {
  const earlier = night.rounds.slice(0, -1);
  mm$('mm-earlier').style.display = earlier.length ? 'block' : 'none';
  mm$('mm-earlier-list').innerHTML = earlier.map((r, i) => `<li><b>Round ${i + 1}</b> `
    + r.games.map((g) => `${mmEsc(mmTeam(g.a))} vs ${mmEsc(mmTeam(g.b))}`).join(' · ')
    + (r.sitOut.length ? ` <span class="muted">· ${mmEsc(r.sitOut.map(mmFirst).join(', '))} sat</span>` : '') + '</li>').reverse().join('');
}

function renderAll() {
  renderRoster();
  renderSettings();
  renderRound();
}

function status(kind, text) {
  const el = mm$('mm-status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

// ---------- actions ----------

function makeNextRound(replaceLast) {
  const present = night.present.filter((n) => mmRoster.some((p) => p.Name === n));
  const needed = night.format === 'Doubles' ? 2 : 2;
  if (present.length < needed) { status('error', 'Tap at least 2 players who are here.'); return; }
  status('', '');
  const earlier = replaceLast ? night.rounds.slice(0, -1) : night.rounds;
  const round = makeRound({
    present, ratings: mmRatings, courts: night.courts, format: night.format, mode: night.mode,
    rounds: earlier, recentGames: mmRecent, seed: Date.now() % 2147483647,
  });
  if (!round.games.length) { status('error', 'Not enough players for a game yet.'); return; }
  night.rounds = earlier.concat([{ games: round.games, sitOut: round.sitOut }]);
  mmPicked = null;
  mmSave();
  renderRound();
  mm$('mm-round').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Swap two names inside the current round (between games, teams or the bench).
function swapNames(x, y) {
  const round = mmCurrentRound();
  if (!round || x === y) return;
  const sub = (n) => (n === x ? y : n === y ? x : n);
  round.games = round.games.map((g) => mmRefreshGame({ a: g.a.map(sub), b: g.b.map(sub) }, mmRatings));
  round.sitOut = round.sitOut.map(sub);
  mmSave();
}

function onNameTap(name) {
  if (!mmPicked) { mmPicked = { name }; renderRound(); return; }
  if (mmPicked.name !== name) swapNames(mmPicked.name, name);
  mmPicked = null;
  renderRound();
}

// ---------- wiring ----------

mm$('mm-roster').addEventListener('click', (e) => {
  const btn = e.target.closest('.player-chip');
  if (!btn) return;
  const name = btn.dataset.player;
  night.present = night.present.includes(name) ? night.present.filter((n) => n !== name) : night.present.concat([name]);
  mmSave();
  renderRoster();
});
mm$('mm-all').addEventListener('click', () => { night.present = mmRoster.map((p) => p.Name); mmSave(); renderRoster(); });
mm$('mm-none').addEventListener('click', () => { night.present = []; mmSave(); renderRoster(); });
mm$('mm-courts-down').addEventListener('click', () => { night.courts = Math.max(1, night.courts - 1); mmSave(); renderSettings(); });
mm$('mm-courts-up').addEventListener('click', () => { night.courts = Math.min(6, night.courts + 1); mmSave(); renderSettings(); });
mm$('mm-format').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-format]');
  if (b) { night.format = b.dataset.format; mmSave(); renderSettings(); }
});
mm$('mm-target').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-target]');
  if (b) { night.target = Number(b.dataset.target); mmSave(); renderSettings(); }
});
mm$('mm-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) { night.mode = b.dataset.mode; mmSave(); renderSettings(); }
});
mm$('mm-make').addEventListener('click', () => makeNextRound(false));
mm$('mm-reshuffle').addEventListener('click', () => makeNextRound(true));
mm$('mm-round').addEventListener('click', (e) => {
  const btn = e.target.closest('.mm-name');
  if (btn) onNameTap(btn.dataset.name);
});
mm$('mm-new-night').addEventListener('click', () => {
  if (night.rounds.length && !window.confirm('Start a new night? Tonight’s rounds will be cleared; who’s here stays ticked.')) return;
  night = { ...mmDefaultNight(), present: night.present, courts: night.courts, format: night.format, mode: night.mode, target: night.target };
  mmPicked = null;
  mmSave();
  renderAll();
});

async function loadMatchmaking() {
  const loading = mm$('loading');
  try {
    await apiGetCached('getLeaderboard', null, (players) => {
      mmRoster = players.filter((p) => !p.Archived);
      mmRatings = {};
      mmRoster.forEach((p) => { mmRatings[p.Name] = Number(p.Elo) || 1000; });
      loading.style.display = 'none';
      mm$('mm-content').style.display = 'block';
      renderAll();
    });
  } catch (err) {
    loading.className = 'status error';
    loading.textContent = 'Could not load players: ' + err.message;
  }
  apiGetCached('getGames', null, (games) => {
    const since = Date.now() - MM_RECENT_DAYS * 86400000;
    mmRecent = (games || []).filter((g) => new Date(g.Date).getTime() >= since).map((g) => ({
      a: [g.SideA_Player1, g.SideA_Player2].filter(Boolean),
      b: [g.SideB_Player1, g.SideB_Player2].filter(Boolean),
    }));
  }).catch(() => {});
}

loadMatchmaking();
