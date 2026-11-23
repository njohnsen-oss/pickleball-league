/* Brackets page: the list of brackets, the New bracket form, and one
   bracket's board (tree or round robin), with a sheet per match to live
   score it, enter a final score, or undo a game. The rules are in
   js/bracket-engine.js; saving goes through js/bracket-sync.js. */

const bk = {
  leaderboard: null, games: null, teams: null, list: null,
  cur: null,          // { id, version, bracket } for the open bracket
  sheet: null,        // { matchId, requestId }
  create: { format: 'single', target: 11, bestOf: 1, final3: false, counts: true, seeding: 'rating', entrants: [], pending: '', order: [] },
};
const $b = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const viewId = params.get('id');
const wantsNew = params.get('new') === '1';

function escB(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initialsB(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

function shortB() {
  const names = new Set((bk.leaderboard || []).map((p) => p.Name).concat(bk.cur ? bk.cur.bracket.entrants.flatMap((e) => e.players) : []));
  return shortNamer([...names]);
}

function labelB(entrant) {
  return entrantLabel(entrant, shortB());
}

function dotB(entrant) {
  return entrant && entrant.color ? `<i class="bk-dot" style="--c:${escB(entrant.color)}"></i>` : '<i class="bk-dot"></i>';
}

function showStatusB(id, kind, text) {
  const el = $b(id);
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function formatName(f) {
  return f === 'roundrobin' ? 'Round robin' : 'Single elimination';
}

function matchLengthText(b) {
  let t = `Games to ${b.target}`;
  if (b.bestOf === 3) t += ' · best of 3';
  else if (b.format === 'single' && b.finalBestOf === 3) t += ' · final best of 3';
  return t;
}

function showView(which) {
  $b('bk-loading').style.display = 'none';
  $b('bk-list-view').hidden = which !== 'list';
  $b('bk-create-view').hidden = which !== 'create';
  $b('bk-view').hidden = which !== 'bracket';
}

/* ---------- list ---------- */

function renderList() {
  const list = bk.list || [];
  const card = (x) => `<a class="bk-card${x.status === 'done' ? ' done' : ''}" href="brackets.html?id=${encodeURIComponent(x.id)}">`
    + `<span class="bk-card-top"><b>${escB(x.name)}</b><span class="bk-pill ${x.status === 'done' ? 'done' : 'live'}">${x.status === 'done' ? 'Done' : 'In progress'}</span></span>`
    + `<span class="bk-card-meta">${formatName(x.format)} · ${x.entrants} teams${x.counts ? '' : ' · ratings off'}</span></a>`;
  const active = list.filter((x) => x.status !== 'done');
  const done = list.filter((x) => x.status === 'done');
  $b('bk-list').innerHTML = list.length
    ? (active.length ? '<h3 class="bk-sub">In progress</h3>' + active.map(card).join('') : '')
      + (done.length ? '<h3 class="bk-sub">Finished</h3>' + done.map(card).join('') : '')
    : '<div class="team-empty"><h2>No brackets yet</h2><p>Single elimination or round robin, with set teams or any pairs.</p></div>';
}

/* ---------- new bracket ---------- */

function pairRating(players) {
  const ratingOf = ratingLookup(bk.leaderboard);
  const pairs = pairGames(bk.games || []);
  return teamStats(players[0], players[1], pairs[teamKey(players[0], players[1])], ratingOf).rating;
}

function entrantKey(e) {
  return teamKey(e.players[0], e.players[1]);
}

function orderedEntrants() {
  const c = bk.create;
  const list = c.entrants.map((e) => ({ ...e, rating: pairRating(e.players) }));
  if (c.seeding === 'random') {
    const pos = (e) => { const i = c.order.indexOf(entrantKey(e)); return i === -1 ? 1e9 : i; };
    return list.sort((x, y) => pos(x) - pos(y));
  }
  return list.sort((x, y) => y.rating - x.rating);
}

function shuffleOrder() {
  const keys = bk.create.entrants.map(entrantKey);
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  bk.create.order = keys;
}

function usedPlayers() {
  return new Set(bk.create.entrants.flatMap((e) => e.players));
}

function addEntrant(players) {
  const team = findSetTeam(bk.teams || [], players[0], players[1]);
  bk.create.entrants.push(team
    ? { players: [team.Player1, team.Player2], teamId: team.TeamId, name: team.Name || '', color: team.Color || '' }
    : { players: players.slice(), teamId: '', name: '', color: '' });
  bk.create.order.push(entrantKey(bk.create.entrants[bk.create.entrants.length - 1]));
}

function renderCreate() {
  const c = bk.create;
  const paint = (id, value) => $b(id).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === String(value)));
  paint('bk-format', c.format);
  paint('bk-target', c.target);
  paint('bk-bestof', c.bestOf);
  paint('bk-seeding', c.seeding);
  const max = c.format === 'roundrobin' ? BRACKET_MAX_ROUND_ROBIN : BRACKET_MAX_SINGLE;
  $b('bk-format-help').textContent = c.format === 'roundrobin'
    ? `Everyone plays everyone once; most wins takes it. Up to ${max} teams.`
    : `Lose once and you’re out. Top seeds get byes when the count isn’t 4, 8, 16 or 32. Up to ${max} teams.`;
  $b('bk-final-row').hidden = !(c.format === 'single' && c.bestOf === 1);
  [['bk-final', c.final3], ['bk-counts', c.counts]].forEach(([id, on]) => { $b(id).classList.toggle('on', on); $b(id).setAttribute('aria-checked', String(on)); });

  const used = usedPlayers();
  const names = new Set((bk.leaderboard || []).map((p) => p.Name));
  const short = shortB();
  // Set teams: one tap adds or removes the pair.
  const teams = (bk.teams || []).filter((t) => names.has(t.Player1) && names.has(t.Player2));
  $b('bk-team-picks').hidden = !teams.length;
  $b('bk-team-row').innerHTML = teams.map((t) => {
    const inIt = c.entrants.some((e) => entrantKey(e) === teamKey(t.Player1, t.Player2));
    const blocked = !inIt && (used.has(t.Player1) || used.has(t.Player2));
    const style = t.Color ? ` style="--tm:${escB(t.Color)};--tm-ink:${teamInkFor(t.Color)}"` : '';
    return `<button type="button" class="team-pick${inIt ? ' picked' : ''}" data-team="${escB(t.TeamId)}" aria-pressed="${inIt}"${blocked ? ' disabled' : ''}${style}>`
      + `<span class="team-avs" aria-hidden="true"><span>${escB(initialsB(t.Player1))}</span><span>${escB(initialsB(t.Player2))}</span></span>`
      + `<span class="team-pick-name">${escB(teamLabelFor(t, short))}</span></button>`;
  }).join('');
  // Any pair: tap two players.
  $b('bk-player-grid').innerHTML = (bk.leaderboard || []).map((p) => {
    const isUsed = used.has(p.Name);
    const pending = c.pending === p.Name;
    const cls = ['player-chip'];
    if (pending) cls.push('picked');
    if (isUsed) cls.push('is-disabled');
    return `<button type="button" class="${cls.join(' ')}" data-player="${escB(p.Name)}" aria-pressed="${pending}"${isUsed ? ' disabled' : ''}>`
      + `<span class="chip-slot">${pending ? '1' : ''}</span><span class="chip-name">${escB(p.Name)}</span><span class="chip-elo">${Math.round(Number(p.Elo) || 0)}</span></button>`;
  }).join('');

  const ordered = orderedEntrants();
  $b('bk-count').textContent = c.entrants.length ? `(${c.entrants.length})` : '';
  $b('bk-entrants').innerHTML = ordered.map((e, i) => `<li>
      <span class="bk-seed">${i + 1}</span>${dotB(e)}
      <span class="bk-ent-name"><b>${escB(labelB(e))}</b><small>${escB(e.players.join(' & '))}</small></span>
      <span class="bk-ent-rating">${Math.round(e.rating)}</span>
      <button type="button" class="bk-x" data-remove="${escB(entrantKey(e))}" aria-label="Remove ${escB(labelB(e))}">×</button>
    </li>`).join('');
  $b('bk-shuffle').hidden = !(c.seeding === 'random' && c.entrants.length > 1);
  $b('bk-create').disabled = c.entrants.length < 2 || c.entrants.length > max;
}

async function createBracketNow() {
  const c = bk.create;
  const name = $b('bk-name').value.trim();
  if (!name) { showStatusB('bk-create-status', 'error', 'Give the bracket a name.'); $b('bk-name').focus(); return; }
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  let bracket;
  try {
    bracket = createBracketFrom({ name, format: c.format, target: c.target, bestOf: c.bestOf, finalBestOf: c.final3 || c.bestOf === 3 ? 3 : 1, counts: c.counts, seeding: c.seeding }, orderedEntrants());
  } catch (err) { showStatusB('bk-create-status', 'error', err.message); return; }
  const btn = $b('bk-create');
  btn.disabled = true;
  showStatusB('bk-create-status', '', 'Creating…');
  try {
    const res = await apiPost('createBracket', { passcode, bracket });
    invalidateAllCache();
    window.location.href = 'brackets.html?id=' + encodeURIComponent(res.id);
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showStatusB('bk-create-status', 'error', 'Not created: ' + err.message);
    btn.disabled = false;
  }
}

/* ---------- one bracket ---------- */

function scoreCell(bracket, m, side) {
  if (!m.games.length) return '';
  if (m.bestOf > 1) return String(seriesScore(m)[side]);
  return String(m.games[m.games.length - 1][side]);
}

function matchRowHtml(bracket, m, side) {
  const id = m[side];
  const e = id ? bracketEntrant(bracket, id) : null;
  const cls = ['bk-mrow'];
  if (m.winner === side) cls.push('win');
  if (m.winner && m.winner !== side) cls.push('lose');
  if (!e) cls.push('tbd');
  const name = e ? labelB(e) : (m.bye ? 'Bye' : 'TBD');
  return `<span class="${cls.join(' ')}">${dotB(e)}<span class="bk-seed">${e ? e.seed : ''}</span><span class="bk-mname">${escB(name)}</span><b>${scoreCell(bracket, m, side)}</b></span>`;
}

function matchCardHtml(bracket, m) {
  const cls = ['bk-match'];
  if (matchReady(m)) cls.push('ready');
  if (m.winner) cls.push('done');
  if (m.bye) cls.push('bye');
  const series = m.bestOf > 1 ? `<span class="bk-mtag">Best of ${m.bestOf}</span>` : '';
  return `<button type="button" class="${cls.join(' ')}" data-match="${m.id}"${m.bye ? ' disabled' : ''}>${matchRowHtml(bracket, m, 'a')}${matchRowHtml(bracket, m, 'b')}${series}</button>`;
}

function renderBracket() {
  const { bracket } = bk.cur;
  $b('bk-title').textContent = bracket.name;
  $b('bk-meta').textContent = `${formatName(bracket.format)} · ${bracket.entrants.length} teams · ${matchLengthText(bracket)} · ${bracket.counts ? 'Counts toward ratings' : 'Ratings off'}`;

  const champ = champion(bracket);
  $b('bk-champ').hidden = !champ;
  if (champ) {
    $b('bk-champ').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      + `<span><small>Champion</small><b>${escB(labelB(champ))}</b><em>${escB(champ.players.join(' & '))}</em></span>`;
  }

  const next = upNext(bracket);
  $b('bk-next').innerHTML = next.length
    ? '<h3 class="bk-sub">Up next</h3>' + next.map((m) => `<div class="bk-next-row"><span class="bk-round-tag">${escB(bracketRoundName(bracket, m.round))}</span>${matchCardHtml(bracket, m)}</div>`).join('')
    : '';

  if (bracket.format === 'roundrobin') {
    const table = roundRobinStandings(bracket);
    $b('bk-standings').innerHTML = `<h3 class="bk-sub">Standings</h3><table class="bk-table"><thead><tr><th>#</th><th>Team</th><th>W-L</th><th>+/−</th></tr></thead><tbody>`
      + table.map((r, i) => { const e = bracketEntrant(bracket, r.id); return `<tr><td>${i + 1}</td><td>${dotB(e)}${escB(labelB(e))}</td><td>${r.wins}-${r.losses}</td><td>${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${Math.abs(r.diff)}</td></tr>`; }).join('')
      + '</tbody></table>';
    const rounds = [...new Set(bracket.matches.map((m) => m.round))];
    $b('bk-board').innerHTML = '<h3 class="bk-sub">Matches</h3>' + rounds.map((r) => `<div class="bk-rr-round"><div class="bk-round-tag">Round ${r}</div><div class="bk-rr-matches">${bracket.matches.filter((m) => m.round === r).map((m) => matchCardHtml(bracket, m)).join('')}</div></div>`).join('');
  } else {
    $b('bk-standings').innerHTML = '';
    const rounds = Math.max(...bracket.matches.map((m) => m.round));
    let cols = '';
    for (let r = 1; r <= rounds; r += 1) {
      cols += `<div class="bk-col"><div class="bk-round-tag">${escB(bracketRoundName(bracket, r))}</div><div class="bk-col-matches">${bracket.matches.filter((m) => m.round === r).map((m) => matchCardHtml(bracket, m)).join('')}</div></div>`;
    }
    $b('bk-board').innerHTML = `<h3 class="bk-sub">Bracket</h3><div class="bk-tree">${cols}</div>`;
  }
  if (bk.sheet) renderSheet();
}

async function loadBracket(id, quiet) {
  try {
    bk.cur = await apiGet('getBracket', { id });
    showView('bracket');
    renderBracket();
  } catch (err) {
    if (quiet) return;
    $b('bk-loading').className = 'status error';
    $b('bk-loading').textContent = 'Couldn’t load that bracket: ' + err.message;
  }
}

/* ---------- match sheet ---------- */

function openSheet(matchId) {
  bk.sheet = { matchId, requestId: bracketNewRequestId() };
  $b('bk-enter-a').value = '';
  $b('bk-enter-b').value = '';
  showStatusB('bk-sheet-status', '', '');
  renderSheet();
  $b('bk-sheet').hidden = false;
  requestAnimationFrame(() => $b('bk-sheet').classList.add('open'));
}

function closeSheet() {
  $b('bk-sheet').classList.remove('open');
  setTimeout(() => { $b('bk-sheet').hidden = true; }, 200);
  bk.sheet = null;
}

function renderSheet() {
  const { bracket } = bk.cur;
  const m = bracketMatch(bracket, bk.sheet.matchId);
  const ea = bracketEntrant(bracket, m.a);
  const eb = bracketEntrant(bracket, m.b);
  const s = seriesScore(m);
  $b('bk-sheet-title').textContent = bracketRoundName(bracket, m.round);
  let sub = m.bestOf > 1 ? `Best of ${m.bestOf} · ${s.a}–${s.b} in games` : `One game to ${bracket.target}`;
  if (!ea || !eb) sub = 'Waiting on earlier results';
  if (m.winner) sub = `Won by ${labelB(m.winner === 'a' ? ea : eb)}`;
  $b('bk-sheet-sub').textContent = sub;
  const team = (e) => (e ? `<div class="bk-sheet-team">${dotB(e)}<b>${escB(labelB(e))}</b><small>${escB(e.players.join(' & '))}</small></div>` : '<div class="bk-sheet-team tbd"><b>TBD</b></div>');
  $b('bk-sheet-teams').innerHTML = team(ea) + '<span class="bk-vs">vs</span>' + team(eb);
  $b('bk-sheet-games').innerHTML = m.games.map((g, i) => `<div class="bk-game"><span>Game ${i + 1}</span><b>${g.a} – ${g.b}</b><small>${escB(labelB(g.a > g.b ? ea : eb))}${g.gameId ? ' · ' + escB(g.gameId) : ''}</small></div>`).join('');
  const ready = matchReady(m);
  $b('bk-live-btn').style.display = ready ? '' : 'none';
  $b('bk-enter').style.display = ready ? '' : 'none';
  if (ready) {
    $b('bk-live-btn').href = bracketLiveUrl(bk.cur.id, bracket, m);
    $b('bk-live-btn').textContent = m.games.length ? `Live score game ${m.games.length + 1}` : 'Live score this game';
    $b('bk-enter-a-label').textContent = labelB(ea);
    $b('bk-enter-b-label').textContent = labelB(eb);
  }
  const nextStarted = m.winner && m.next && bracketMatch(bracket, m.next).games.length;
  $b('bk-undo').hidden = !m.games.length || Boolean(nextStarted);
}

async function saveEnteredScore() {
  const { bracket } = bk.cur;
  const m = bracketMatch(bracket, bk.sheet.matchId);
  const ea = bracketEntrant(bracket, m.a);
  const eb = bracketEntrant(bracket, m.b);
  let score;
  try { score = checkGameScore($b('bk-enter-a').value, $b('bk-enter-b').value, bracket.target); } catch (err) { showStatusB('bk-sheet-status', 'error', err.message); return; }
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  const btn = $b('bk-enter-save');
  btn.disabled = true;
  showStatusB('bk-sheet-status', '', 'Saving…');
  const requestId = bk.sheet.requestId;
  try {
    let gameId = '';
    if (bracket.counts) {
      const res = await apiPost('logGame', { passcode, requestId, date: new Date().toISOString(), format: 'Doubles', sideAPlayers: ea.players, sideBPlayers: eb.players, scoreA: score.a, scoreB: score.b });
      gameId = res.game.GameId;
    }
    bk.cur = await recordBracketGame({ id: bk.cur.id, matchId: m.id, passcode, sideAPlayers: ea.players, scoreA: score.a, scoreB: score.b, gameId, requestId });
    invalidateAllCache();
    closeSheet();
    renderBracket();
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showStatusB('bk-sheet-status', 'error', 'Not saved: ' + err.message + ' Try again; it won’t count twice.');
  } finally {
    btn.disabled = false;
  }
}

async function undoLastGame() {
  const { bracket } = bk.cur;
  const m = bracketMatch(bracket, bk.sheet.matchId);
  const last = m.games[m.games.length - 1];
  const fromLeague = bracket.counts && last.gameId;
  if (!window.confirm(`Undo game ${m.games.length} (${last.a}–${last.b})?${fromLeague ? ` It’s also removed from the league (${last.gameId}).` : ''}`)) return;
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  const btn = $b('bk-undo');
  btn.disabled = true;
  try {
    bk.cur = await changeBracket(bk.cur.id, passcode, (br) => undoBracketGame(br, m.id), bk.cur);
    if (fromLeague) await apiPost('deleteGame', { passcode, gameId: last.gameId }).catch((err) => { if (!/not found/i.test(err.message)) throw err; });
    invalidateAllCache();
    renderBracket();
    showStatusB('bk-sheet-status', 'success', 'Game undone.');
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showStatusB('bk-sheet-status', 'error', 'Not undone: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function removeThisBracket() {
  if (!window.confirm(`Remove “${bk.cur.bracket.name}”? Games already saved to the league stay there.`)) return;
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  try {
    await apiPost('removeBracket', { passcode, id: bk.cur.id });
    invalidateAllCache();
    window.location.href = 'brackets.html';
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showStatusB('bk-view-status', 'error', 'Not removed: ' + err.message);
  }
}

/* ---------- wiring ---------- */

['bk-format', 'bk-target', 'bk-bestof', 'bk-seeding'].forEach((id) => {
  $b(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    const key = { 'bk-format': 'format', 'bk-target': 'target', 'bk-bestof': 'bestOf', 'bk-seeding': 'seeding' }[id];
    bk.create[key] = key === 'target' || key === 'bestOf' ? Number(btn.dataset.value) : btn.dataset.value;
    if (key === 'seeding' && bk.create.seeding === 'random') shuffleOrder();
    renderCreate();
  });
});
$b('bk-final').addEventListener('click', () => { bk.create.final3 = !bk.create.final3; renderCreate(); });
$b('bk-counts').addEventListener('click', () => { bk.create.counts = !bk.create.counts; renderCreate(); });
$b('bk-shuffle').addEventListener('click', () => { shuffleOrder(); renderCreate(); });
$b('bk-team-row').addEventListener('click', (e) => {
  const btn = e.target.closest('.team-pick');
  if (!btn || btn.disabled) return;
  const t = bk.teams.find((x) => x.TeamId === btn.dataset.team);
  const key = teamKey(t.Player1, t.Player2);
  const i = bk.create.entrants.findIndex((x) => entrantKey(x) === key);
  if (i >= 0) bk.create.entrants.splice(i, 1);
  else { bk.create.pending = ''; addEntrant([t.Player1, t.Player2]); }
  renderCreate();
});
$b('bk-player-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.player-chip');
  if (!btn || btn.disabled) return;
  const name = btn.dataset.player;
  const c = bk.create;
  if (c.pending === name) c.pending = '';
  else if (!c.pending) c.pending = name;
  else { addEntrant([c.pending, name]); c.pending = ''; }
  renderCreate();
});
$b('bk-entrants').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  bk.create.entrants = bk.create.entrants.filter((x) => entrantKey(x) !== btn.dataset.remove);
  renderCreate();
});
$b('bk-create').addEventListener('click', createBracketNow);
$b('bk-new').addEventListener('click', () => { window.location.href = 'brackets.html?new=1'; });

['bk-next', 'bk-board'].forEach((id) => $b(id).addEventListener('click', (e) => {
  const btn = e.target.closest('.bk-match');
  if (btn && !btn.disabled) openSheet(btn.dataset.match);
}));
$b('bk-sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bk.sheet) closeSheet(); });
$b('bk-enter-save').addEventListener('click', saveEnteredScore);
$b('bk-undo').addEventListener('click', undoLastGame);
$b('bk-remove').addEventListener('click', removeThisBracket);

// Another phone (or the scorer) may record results: refresh while open.
let bkPoll = null;
function pollBracket() {
  clearTimeout(bkPoll);
  bkPoll = setTimeout(async () => {
    if (document.visibilityState === 'visible' && bk.cur && !bk.sheet) await loadBracket(bk.cur.id, true);
    pollBracket();
  }, 20000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && bk.cur && !bk.sheet) loadBracket(bk.cur.id, true); });

function bootBrackets() {
  if (viewId) {
    loadBracket(viewId).then(pollBracket);
    apiGetCached('getLeaderboard', null, (p) => { bk.leaderboard = p || []; if (bk.cur) renderBracket(); }).catch(() => {});
    return;
  }
  if (wantsNew && isAdminUnlocked()) {
    showView('create');
    const ready = () => bk.leaderboard && bk.games && bk.teams;
    apiGetCached('getLeaderboard', null, (p) => { bk.leaderboard = p || []; if (ready()) renderCreate(); }).catch(() => {});
    apiGetCached('getGames', null, (g) => { bk.games = g || []; if (ready()) renderCreate(); }).catch(() => {});
    apiGetCached('getTeams', null, (d) => { bk.teams = (d && d.teams) || []; if (ready()) renderCreate(); }).catch(() => { bk.teams = []; if (ready()) renderCreate(); });
    return;
  }
  apiGetCached('getBrackets', null, (d) => { bk.list = (d && d.brackets) || []; showView('list'); renderList(); }).catch((err) => {
    $b('bk-loading').className = 'status error';
    $b('bk-loading').textContent = 'Couldn’t load brackets: ' + err.message;
  });
}

bootBrackets();
