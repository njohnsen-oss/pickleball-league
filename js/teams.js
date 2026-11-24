/* Teams page: the set-team leaderboard, plus (Admin) suggested pairs to turn
   into teams and a sheet to name, color or remove one. The numbers come from
   js/teams-model.js; this file only draws them and talks to the backend. */

const TEAM_VIEW_KEY = 'pickleballTeamView';
const teamState = { teams: null, leaderboard: null, games: null };
let teamView = (() => {
  try { const v = localStorage.getItem(TEAM_VIEW_KEY); return v && TEAM_RANKINGS[v] ? v : 'rating'; } catch (e) { return 'rating'; }
})();
let teamSheet = null; // { mode: 'add' | 'edit', p1, p2, team, color, games }

const $t = (id) => document.getElementById(id);

function escT(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

function teamColorStyle(color) {
  if (!color || typeof teamInkFor !== 'function') return '';
  return ` style="--tm:${escT(color)};--tm-ink:${teamInkFor(color)}"`;
}

function pairAvatars(p1, p2) {
  return `<span class="team-avs" aria-hidden="true"><span>${escT(initialsOf(p1))}</span><span>${escT(initialsOf(p2))}</span></span>`;
}

function formDots(form) {
  if (!form.length) return '';
  const label = form.map((w) => (w ? 'Win' : 'Loss')).join(', ');
  return `<span class="form-dots pc-form" aria-label="Last games together: ${label}" title="${label}">${form.map((w) => `<span class="form-dot ${w ? 'win' : 'loss'}" aria-hidden="true"></span>`).join('')}</span>`;
}

function streakText(streak) {
  if (!streak) return '–';
  return `${streak > 0 ? 'W' : 'L'}${Math.abs(streak)}`;
}

function computeTeamRows() {
  const ratingOf = ratingLookup(teamState.leaderboard);
  const short = shortNamer(teamState.leaderboard.map((p) => p.Name));
  const pairs = pairGames(teamState.games);
  const method = TEAM_RANKINGS[teamView];
  const rows = teamState.teams.map((t) => {
    const stats = teamStats(t.Player1, t.Player2, pairs[teamKey(t.Player1, t.Player2)], ratingOf);
    return { team: t, stats, label: teamLabelFor(t, short), metric: method.value(stats) };
  });
  const val = (r) => (Number.isFinite(r.metric) ? r.metric : -Infinity);
  rows.sort((a, b) => (a.stats.provisional - b.stats.provisional) || (val(b) - val(a)) || (b.stats.games - a.stats.games));
  let rank = 0;
  rows.forEach((r) => { if (!r.stats.provisional) rank += 1; r.rank = r.stats.provisional ? 'P' : rank; });
  return { rows, pairs, short };
}

function teamCardHtml(r, open) {
  const { team: t, stats: s } = r;
  const method = TEAM_RANKINGS[teamView];
  const metricText = Number.isFinite(r.metric) ? method.format(r.metric) : '–';
  const named = t.Name ? `<div class="team-players">${escT(t.Player1)} &amp; ${escT(t.Player2)}</div>` : '';
  const cls = ['player-card', 'team-card'];
  if (r.rank === 1) cls.push('rank-1');
  if (s.provisional) cls.push('provisional-row');
  return `<details class="${cls.join(' ')}" data-team="${escT(t.TeamId)}"${open ? ' open' : ''}${teamColorStyle(t.Color)}>
    <summary class="pc-head">
      <span class="pc-rank">${r.rank}</span>
      ${pairAvatars(t.Player1, t.Player2)}
      <span class="pc-identity">
        <span class="pc-name">${escT(r.label)}${s.provisional ? '<span class="provisional-badge">PROVISIONAL</span>' : ''}</span>
        <span class="pc-line"><span class="pc-record">${s.wins}-${s.losses}</span>${s.games ? '<span class="pc-sep" aria-hidden="true">·</span>' : ''}${formDots(s.form)}</span>
      </span>
      <span class="pc-rating"><span class="pc-rating-value">${metricText}</span><span class="pc-rating-label">${method.unit}</span></span>
      <svg class="pc-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </summary>
    <div class="pc-body">
      ${named}
      <div class="pc-stats">
        <div class="pc-stat"><span class="pc-stat-label">Games together</span><span class="pc-stat-value">${s.games}</span></div>
        <div class="pc-stat"><span class="pc-stat-label">Win %</span><span class="pc-stat-value">${s.games ? TEAM_RANKINGS.winpct.format(s.winPct) : '–'}</span></div>
        <div class="pc-stat"><span class="pc-stat-label">+/− per game</span><span class="pc-stat-value">${s.games ? TEAM_RANKINGS.pointdiff.format(s.pointDiff) : '–'}</span></div>
      </div>
      <div class="pc-stats">
        <div class="pc-stat"><span class="pc-stat-label">Team rating</span><span class="pc-stat-value">${Math.round(s.rating)}</span></div>
        <div class="pc-stat"><span class="pc-stat-label">Players’ avg</span><span class="pc-stat-value">${Math.round(s.prior)}</span></div>
        <div class="pc-stat"><span class="pc-stat-label">Streak</span><span class="pc-stat-value">${streakText(s.streak)}</span></div>
      </div>
      <button type="button" class="btn secondary admin-only team-edit" data-edit="${escT(t.TeamId)}">Edit team</button>
    </div>
  </details>`;
}

function suggestionHtml(sug, short) {
  return `<div class="suggest-row">
    ${pairAvatars(sug.p1, sug.p2)}
    <span class="suggest-id"><b>${escT(short(sug.p1))} &amp; ${escT(short(sug.p2))}</b><span>${sug.games} games together · ${sug.wins}-${sug.losses}</span></span>
    <button type="button" class="small" data-make="${escT(sug.key)}">Make team</button>
  </div>`;
}

function renderTeams() {
  if (!teamState.teams || !teamState.leaderboard || !teamState.games) return;
  const cards = $t('team-cards');
  const open = new Set(Array.from(cards.querySelectorAll('details[open]')).map((d) => d.dataset.team));
  const { rows, pairs, short } = computeTeamRows();
  cards.innerHTML = rows.map((r) => teamCardHtml(r, open.has(r.team.TeamId))).join('');
  $t('teams-empty').hidden = rows.length > 0;

  const suggestions = suggestTeams(pairs, teamState.teams, teamState.leaderboard.map((p) => p.Name));
  teamState.suggestions = suggestions;
  $t('suggest-list').innerHTML = suggestions.length
    ? suggestions.map((s) => suggestionHtml(s, short)).join('')
    : '<p class="field-help">No other pairs have 5 or more games together yet.</p>';

  $t('loading').style.display = 'none';
  $t('teams-views').hidden = false;
}

function paintTeamToggle() {
  $t('team-view').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === teamView));
  $t('team-view-help').textContent = TEAM_RANKINGS[teamView].explain;
}

/* ---------- make / edit sheet ---------- */

function defaultTeamColor(exceptTeamId) {
  const used = new Set((teamState.teams || []).filter((t) => t.TeamId !== exceptTeamId).map((t) => String(t.Color).toUpperCase()));
  const pick = TEAM_COLOR_PRESETS.find((p) => p.name !== 'Cream' && !used.has(p.hex) && checkTeamColor(p.hex, null).ok);
  return pick ? pick.hex : '#F25C43';
}

function renderTeamSwatches() {
  const mine = teamSheet.color;
  const isPreset = TEAM_COLOR_PRESETS.some((p) => p.hex === mine);
  const swatches = TEAM_COLOR_PRESETS.map((p) => {
    const blocked = !checkTeamColor(p.hex, null).ok;
    const cls = ['live-swatch'];
    if (p.hex === mine) cls.push('selected');
    if (blocked) cls.push('blocked');
    return `<button type="button" class="${cls.join(' ')}" data-hex="${p.hex}" style="--sw:${p.hex};--sw-ink:${teamInkFor(p.hex)}" aria-pressed="${p.hex === mine}" aria-label="${p.name}">${p.name}</button>`;
  }).join('');
  const custom = `<label class="live-swatch custom${isPreset ? '' : ' selected'}"${isPreset ? '' : ` style="--sw:${mine};--sw-ink:${teamInkFor(mine)}"`}>`
    + `<span>Custom</span><input type="color" value="${mine.toLowerCase()}" aria-label="Custom color"></label>`;
  $t('team-swatches').innerHTML = swatches + custom;
}

function setTeamColor(hex) {
  const check = checkTeamColor(hex, null);
  const msg = $t('team-color-msg');
  if (!check.ok) { msg.textContent = check.reason; msg.hidden = false; return; }
  msg.hidden = true;
  teamSheet.color = teamNormalizeHex(hex);
  renderTeamSwatches();
}

// "New team": any two active players. Pairs already on a team are refused.
function renderTeamPlayerPicks() {
  const picked = [teamSheet.p1, teamSheet.p2].filter(Boolean);
  $t('team-player-grid').innerHTML = teamState.leaderboard.map((p) => {
    const on = picked.includes(p.Name);
    const full = picked.length === 2 && !on;
    return `<button type="button" class="player-chip${on ? ' picked' : ''}${full ? ' is-disabled' : ''}" data-player="${escT(p.Name)}" aria-pressed="${on}"${full ? ' disabled' : ''}>`
      + `<span class="chip-slot">${on ? picked.indexOf(p.Name) + 1 : ''}</span><span class="chip-name">${escT(p.Name)}</span><span class="chip-elo">${Math.round(Number(p.Elo) || 0)}</span></button>`;
  }).join('');
  const short = shortNamer(teamState.leaderboard.map((p) => p.Name));
  let sub = 'Pick two players';
  let blocked = picked.length < 2;
  if (picked.length === 2) {
    const games = (pairGames(teamState.games)[teamKey(picked[0], picked[1])] || []).length;
    const existing = findSetTeam(teamState.teams, picked[0], picked[1]);
    sub = `${picked[0]} & ${picked[1]} · ${games ? `${games} game${games === 1 ? '' : 's'} together` : 'no games together yet'}`;
    if (existing) { sub = `${teamLabelFor(existing, short)} is already a team`; blocked = true; }
    $t('team-name').placeholder = `${short(picked[0])} & ${short(picked[1])}`;
  }
  $t('team-sheet-sub').textContent = sub;
  $t('team-save').disabled = blocked;
}

function openTeamSheet(sheetState) {
  teamSheet = sheetState;
  const short = shortNamer(teamState.leaderboard.map((p) => p.Name));
  const editing = sheetState.mode === 'edit';
  const choosing = sheetState.mode === 'new';
  $t('team-sheet-title').textContent = editing ? 'Edit team' : 'Make a team';
  $t('team-pick-players').hidden = !choosing;
  $t('team-save').disabled = false;
  if (!choosing) $t('team-sheet-sub').textContent = `${sheetState.p1} & ${sheetState.p2}${sheetState.games != null ? ` · ${sheetState.games} games together` : ''}`;
  const name = $t('team-name');
  name.value = editing ? (sheetState.team.Name || '') : '';
  name.placeholder = choosing ? 'Team name' : `${short(sheetState.p1)} & ${short(sheetState.p2)}`;
  if (choosing) renderTeamPlayerPicks();
  $t('team-remove').hidden = !editing;
  $t('team-save').textContent = editing ? 'Save changes' : 'Save team';
  $t('team-color-msg').hidden = true;
  showTeamStatus('', '');
  renderTeamSwatches();
  $t('team-sheet').hidden = false;
  requestAnimationFrame(() => $t('team-sheet').classList.add('open'));
}

function closeTeamSheet() {
  const el = $t('team-sheet');
  el.classList.remove('open');
  setTimeout(() => { el.hidden = true; }, 200);
  teamSheet = null;
}

function showTeamStatus(kind, text) {
  const el = $t('team-sheet-status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

async function saveTeamSheet() {
  if (!teamSheet || !teamSheet.p1 || !teamSheet.p2) return;
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  const btn = $t('team-save');
  btn.disabled = true;
  showTeamStatus('', 'Saving…');
  const name = $t('team-name').value.trim();
  try {
    if (teamSheet.mode === 'edit') {
      const res = await apiPost('updateTeam', { passcode, teamId: teamSheet.team.TeamId, name, color: teamSheet.color });
      teamState.teams = teamState.teams.map((t) => (t.TeamId === res.team.TeamId ? res.team : t));
    } else {
      const res = await apiPost('addTeam', { passcode, player1: teamSheet.p1, player2: teamSheet.p2, name, color: teamSheet.color });
      teamState.teams = teamState.teams.concat([res.team]);
    }
    invalidateAllCache();
    closeTeamSheet();
    renderTeams();
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showTeamStatus('error', 'Not saved: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function removeTeamFromSheet() {
  if (!teamSheet || teamSheet.mode !== 'edit') return;
  const label = teamSheet.team.Name || `${teamSheet.p1} & ${teamSheet.p2}`;
  if (!window.confirm(`Remove ${label} as a set team? Their games stay in the league.`)) return;
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  const btn = $t('team-remove');
  btn.disabled = true;
  try {
    await apiPost('removeTeam', { passcode, teamId: teamSheet.team.TeamId });
    teamState.teams = teamState.teams.filter((t) => t.TeamId !== teamSheet.team.TeamId);
    invalidateAllCache();
    closeTeamSheet();
    renderTeams();
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showTeamStatus('error', 'Not removed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- wiring ---------- */

$t('team-view').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn || btn.dataset.view === teamView) return;
  teamView = btn.dataset.view;
  try { localStorage.setItem(TEAM_VIEW_KEY, teamView); } catch (err) { /* private mode */ }
  paintTeamToggle();
  renderTeams();
});

$t('suggest-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-make]');
  if (!btn) return;
  const sug = (teamState.suggestions || []).find((s) => s.key === btn.dataset.make);
  if (sug) openTeamSheet({ mode: 'add', p1: sug.p1, p2: sug.p2, games: sug.games, color: defaultTeamColor(null) });
});

$t('team-new').addEventListener('click', () => {
  openTeamSheet({ mode: 'new', p1: '', p2: '', games: null, color: defaultTeamColor(null) });
});

$t('team-player-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.player-chip');
  if (!btn || btn.disabled || !teamSheet) return;
  const name = btn.dataset.player;
  if (teamSheet.p1 === name) { teamSheet.p1 = teamSheet.p2; teamSheet.p2 = ''; }
  else if (teamSheet.p2 === name) teamSheet.p2 = '';
  else if (!teamSheet.p1) teamSheet.p1 = name;
  else if (!teamSheet.p2) teamSheet.p2 = name;
  renderTeamPlayerPicks();
});

$t('team-cards').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-edit]');
  if (!btn) return;
  const team = teamState.teams.find((t) => t.TeamId === btn.dataset.edit);
  if (!team) return;
  const pairs = pairGames(teamState.games);
  const list = pairs[teamKey(team.Player1, team.Player2)] || [];
  const color = team.Color && checkTeamColor(team.Color, null).ok ? teamNormalizeHex(team.Color) : defaultTeamColor(team.TeamId);
  openTeamSheet({ mode: 'edit', p1: team.Player1, p2: team.Player2, team, games: list.length, color });
});

$t('team-swatches').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-hex]');
  if (btn) setTeamColor(btn.dataset.hex);
});
$t('team-swatches').addEventListener('input', (e) => {
  if (e.target.matches('input[type="color"]')) setTeamColor(e.target.value);
});
$t('team-save').addEventListener('click', saveTeamSheet);
$t('team-remove').addEventListener('click', removeTeamFromSheet);
$t('team-sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeTeamSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && teamSheet) closeTeamSheet(); });

function loadTeamsPage() {
  paintTeamToggle();
  const fail = (err) => {
    if (teamState.teams && teamState.leaderboard && teamState.games) return;
    const loading = $t('loading');
    loading.className = 'status error';
    loading.textContent = 'Error loading teams: ' + err.message;
  };
  apiGetCached('getTeams', null, (data) => { teamState.teams = (data && data.teams) || []; renderTeams(); }).catch(fail);
  apiGetCached('getLeaderboard', null, (players) => { teamState.leaderboard = players || []; renderTeams(); }).catch(fail);
  apiGetCached('getGames', null, (games) => { teamState.games = games || []; renderTeams(); }).catch(fail);
}

loadTeamsPage();
