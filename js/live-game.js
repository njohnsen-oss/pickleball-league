// Live Game page: rally-by-rally scoring on a phone.
//
// The in-progress game lives in localStorage (LIVE_STORAGE_KEY), not the
// Sheet, so a phone that locks or reloads mid-game resumes exactly where it
// was and per-rally taps never wait on Apps Script. Nothing is sent until the
// game ends; Save makes one logGame call with an extra `rallies` array. The
// game's requestId is fixed when it starts, so a retried save hits logGame's
// CacheService guard instead of saving twice.
//
// All scoring rules live in js/live-score.js and the shared drawing helpers in
// js/live-render.js. This file stores the event list, replays it, draws the
// result, and broadcasts it to the TV view (live-view.html).

const LIVE_STORAGE_KEY = 'pickleballLiveGame';
const TAP_GUARD_MS = 350; // taps closer together than this are a double-tap

let roster = [];
let draft = { format: 'Doubles', slots: { a1: '', a2: '', b1: '', b2: '' }, firstServingSide: 'A', target: LIVE_DEFAULT_TARGET,
  // Team colors (js/team-colors.js); each phone remembers the last pair used.
  colors: typeof loadLastTeamColors === 'function' ? loadLastTeamColors() : { A: '#F6F1E7', B: '#F25C43' } };
let game = null; // { setup, events, requestId, saved: null | { gameId, deltaA, deltaB } }
let lastTapAt = 0;
// After Start, Point/Fault wait for the TV's 1.2s start animation: the TV gets
// the new game about one round trip after the broadcast lands, so the hold
// ends START_HOLD_AFTER_PUSH_MS after that push succeeds (or START_HOLD_MS if
// nothing is broadcasting), never longer than START_HOLD_MAX_MS.
const START_HOLD_MS = 1300;
const START_HOLD_AFTER_PUSH_MS = 1500;
const START_HOLD_MAX_MS = 4500;
let startHold = null; // { until, startedAt, waitingForPush }
let clockTimer = null;
let wakeLock = null;

const $ = (id) => document.getElementById(id);

function newRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'live-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function playerRating(name) {
  const p = roster.find((x) => x.Name === name);
  return p ? Number(p.Elo) || 1000 : 1000;
}

// Same base-10/400 curve as predictedWinProbability in Code.gs and matchup.js.
function oddsForA(sideA, sideB) {
  const avg = (names) => names.reduce((sum, n) => sum + playerRating(n), 0) / names.length;
  return 1 / (1 + Math.pow(10, (avg(sideB) - avg(sideA)) / 400));
}

// ---------- storage ----------

function storeGame() {
  try {
    if (game) localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(game));
    else localStorage.removeItem(LIVE_STORAGE_KEY);
  } catch (err) {
    // Storage unavailable (private mode): the game still works, it just
    // won't survive a reload.
  }
}

function loadStoredGame() {
  try {
    const raw = localStorage.getItem(LIVE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.setup && Array.isArray(parsed.events)) return parsed;
  } catch (err) { /* ignore a corrupt entry */ }
  return null;
}

// ---------- setup screen ----------

function slotIds() {
  return draft.format === 'Doubles' ? ['a1', 'a2', 'b1', 'b2'] : ['a1', 'b1'];
}

function lineupFull() {
  return slotIds().every((id) => draft.slots[id]);
}

function draftSides() {
  const d = draft.format === 'Doubles';
  return {
    sideA: d ? [draft.slots.a1, draft.slots.a2] : [draft.slots.a1],
    sideB: d ? [draft.slots.b1, draft.slots.b2] : [draft.slots.b1],
  };
}

function slotHtml(id, courtLabel) {
  const name = draft.slots[id];
  const court = courtLabel ? `<span class="live-slot-court">${courtLabel}</span>` : '';
  if (!name) return `<span class="slot-name empty"><span class="live-slot-text"><span class="live-slot-empty">Tap a player</span>${court}</span></span>`;
  return `<button type="button" class="slot-name filled" data-clear-slot="${id}" aria-label="Remove ${escapeHtml(name)}">`
    + `<span class="live-avatar">${escapeHtml(initials(name))}</span>`
    + `<span class="live-slot-text"><span class="live-slot-name">${escapeHtml(firstName(name))}</span>${court}</span>`
    + '<span class="slot-remove" aria-hidden="true">×</span></button>';
}

function renderSetup() {
  const doubles = draft.format === 'Doubles';
  if (!doubles) { draft.slots.a2 = ''; draft.slots.b2 = ''; }

  document.querySelectorAll('#live-format button').forEach((b) => b.classList.toggle('active', b.dataset.format === draft.format));
  document.querySelectorAll('#live-target button').forEach((b) => b.classList.toggle('active', Number(b.dataset.target) === draft.target));

  $('live-slots-a').innerHTML = doubles ? slotHtml('a1', 'Right') + slotHtml('a2', 'Left') : slotHtml('a1');
  $('live-slots-b').innerHTML = doubles ? slotHtml('b1', 'Right') + slotHtml('b2', 'Left') : slotHtml('b1');
  document.querySelectorAll('.live-swap-court').forEach((btn) => {
    const side = btn.dataset.side;
    btn.style.display = doubles ? 'inline-flex' : 'none';
    btn.disabled = !(draft.slots[side + '1'] && draft.slots[side + '2']);
  });

  const full = lineupFull();
  $('live-player-grid').innerHTML = roster.map((p) => {
    const slotId = slotIds().find((id) => draft.slots[id] === p.Name);
    const disabled = !slotId && full;
    const cls = ['player-chip'];
    if (slotId) cls.push('picked', 'side-' + slotId[0]);
    if (disabled) cls.push('is-disabled');
    return `<button type="button" class="${cls.join(' ')}" data-player="${escapeHtml(p.Name)}" aria-pressed="${Boolean(slotId)}"${disabled ? ' disabled' : ''}>`
      + `<span class="live-avatar">${escapeHtml(initials(p.Name))}</span>`
      + `<span class="chip-name">${escapeHtml(p.Name)}</span>`
      + `<span class="chip-elo">${slotId ? slotId.toUpperCase() : Math.round(Number(p.Elo) || 0)}</span></button>`;
  }).join('');

  const remaining = slotIds().filter((id) => !draft.slots[id]).length;
  $('live-picker-hint').textContent = remaining === 0
    ? (doubles ? 'Lineup set. First pick on each side starts in the right court.' : 'Lineup set.')
    : `Tap ${remaining} more player${remaining === 1 ? '' : 's'}`;

  const { sideA, sideB } = draftSides();
  const label = (names) => names.filter(Boolean).map(firstName).join(' & ') || '—';
  document.querySelector('#live-first-server [data-side="A"]').innerHTML = `<span class="live-dot side-a"></span>${escapeHtml(label(sideA))}`;
  document.querySelector('#live-first-server [data-side="B"]').innerHTML = `<span class="live-dot side-b"></span>${escapeHtml(label(sideB))}`;
  document.querySelectorAll('#live-first-server button').forEach((b) => b.classList.toggle('active', b.dataset.side === draft.firstServingSide));

  const oddsEl = $('live-odds');
  if (full && roster.length) {
    const pA = Math.round(oddsForA(sideA, sideB) * 100);
    oddsEl.innerHTML = `<span class="live-odds-title">Pregame odds</span><div class="live-odds-bar"><i class="side-a" style="width:${pA}%"></i><i class="side-b" style="width:${100 - pA}%"></i></div>`
      + `<div class="live-odds-labels"><b class="side-a">${escapeHtml(label(sideA))} · ${pA}%</b><b class="side-b">${100 - pA}% · ${escapeHtml(label(sideB))}</b></div>`;
    oddsEl.style.display = 'block';
  } else {
    oddsEl.style.display = 'none';
  }

  $('live-start').disabled = !full;
  renderColorChips();
}

// ---------- team colors ----------

function teamLabel(names, side) {
  return names.filter(Boolean).map(firstName).join(' & ') || `Side ${side}`;
}

/* Each lineup card shows its team's color; tapping it opens the sheet. */
function renderColorChips() {
  if (typeof TEAM_COLOR_PRESETS === 'undefined') return;
  draft.colors = normalizeTeamColors(draft.colors);
  applyTeamColors(document.body, draft.colors);
  ['A', 'B'].forEach((side) => {
    const chip = $('live-color-chip-' + side.toLowerCase());
    if (chip) chip.innerHTML = `<span class="live-dot side-${side.toLowerCase()}"></span>${escapeHtml(teamColorName(draft.colors[side]))}<span class="live-color-chip-edit">Color ▾</span>`;
  });
  if (colorSheetSide) renderColorSheet();
}

let colorSheetSide = null;
let colorSheetCloseTimer = null;
let colorSheetBefore = null; // both colors as they were when the sheet opened
let colorSheetQueue = [];     // a lineup that arrives whole (Matchmaking) asks A, then B

function renderColorSheet() {
  const side = colorSheetSide;
  if (!side) return;
  const mine = draft.colors[side];
  // Only a team that's already picked can block a color; an unpicked team's
  // default just moves out of the way (see pickTeamColor).
  const otherSide = side === 'A' ? 'B' : 'A';
  const other = sideFull(otherSide) ? draft.colors[otherSide] : null;
  const { sideA, sideB } = draftSides();
  const label = teamLabel(side === 'A' ? sideA : sideB, side);
  $('live-color-title').textContent = `Pick a color for ${label}`;
  $('live-color-preview-one').innerHTML = `<span class="side-${side.toLowerCase()}">${escapeHtml(label)} · ${escapeHtml(teamColorName(mine))}</span>`;
  const isPreset = TEAM_COLOR_PRESETS.some((p) => p.hex === mine);
  const swatches = TEAM_COLOR_PRESETS.map((p) => {
    const blocked = p.hex !== mine && !checkTeamColor(p.hex, other).ok;
    const cls = ['live-swatch'];
    if (p.hex === mine) cls.push('selected');
    if (blocked) cls.push('blocked');
    return `<button type="button" class="${cls.join(' ')}" data-hex="${p.hex}" style="--sw:${p.hex};--sw-ink:${teamInkFor(p.hex)}"`
      + ` aria-pressed="${p.hex === mine}" aria-label="${p.name}${blocked ? ', too close to the other team' : ''}">${p.name}</button>`;
  }).join('');
  const custom = `<label class="live-swatch custom${isPreset ? '' : ' selected'}"${isPreset ? '' : ` style="--sw:${mine};--sw-ink:${teamInkFor(mine)}"`}>`
    + `<span>Custom</span><input type="color" value="${mine.toLowerCase()}" aria-label="Custom color"></label>`;
  $('live-color-swatches').innerHTML = swatches + custom;
}

function openColorSheet(side) {
  if (typeof TEAM_COLOR_PRESETS === 'undefined') return;
  clearTimeout(colorSheetCloseTimer);
  colorSheetSide = side;
  colorSheetBefore = { ...draft.colors };
  $('live-color-msg').hidden = true;
  renderColorSheet();
  $('live-color-sheet').hidden = false;
  requestAnimationFrame(() => $('live-color-sheet').classList.add('open'));
}

// save=true keeps the picked color; false (tap outside, Escape) restores both
// colors, including any the other team was slid off.
function closeColorSheet(save) {
  if (save) saveLastTeamColors(draft.colors);
  else if (colorSheetBefore) { draft.colors = colorSheetBefore; renderColorChips(); }
  colorSheetBefore = null;
  colorSheetSide = null;
  $('live-color-sheet').classList.remove('open');
  colorSheetCloseTimer = setTimeout(() => {
    $('live-color-sheet').hidden = true;
    if (colorSheetQueue.length && !game) openColorSheet(colorSheetQueue.shift());
  }, 220);
}

let colorMsgTimer = null;
function showColorMsg(text) {
  const el = $('live-color-msg');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(colorMsgTimer);
  colorMsgTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// rerender=false while a custom color is being dragged: rebuilding the
// swatches would close the phone's color picker mid-drag.
function pickTeamColor(side, hex, rerender) {
  const otherSide = side === 'A' ? 'B' : 'A';
  const otherPicked = sideFull(otherSide);
  const check = checkTeamColor(hex, otherPicked ? draft.colors[otherSide] : null);
  if (!check.ok) {
    showColorMsg(check.reason);
    if (rerender) renderColorSheet();
    return false;
  }
  $('live-color-msg').hidden = true;
  const next = { ...draft.colors, [side]: teamNormalizeHex(hex) };
  // The other team hasn't been picked yet: if its default now clashes, slide
  // it to the first preset that doesn't.
  if (!otherPicked && !checkTeamColor(next[otherSide], next[side]).ok) {
    const free = TEAM_COLOR_PRESETS.find((p) => checkTeamColor(p.hex, next[side]).ok);
    if (free) next[otherSide] = free.hex;
  }
  draft.colors = next;
  if (rerender) renderColorChips();
  else applyTeamColors(document.body, draft.colors);
  return true;
}

function sideFull(side) {
  return slotIds().filter((id) => id[0] === side.toLowerCase()).every((id) => draft.slots[id]);
}

function togglePlayer(name) {
  const wasFull = { A: sideFull('A'), B: sideFull('B') };
  const held = slotIds().find((id) => draft.slots[id] === name);
  if (held) draft.slots[held] = '';
  else {
    const empty = slotIds().find((id) => !draft.slots[id]);
    if (!empty) return;
    draft.slots[empty] = name;
  }
  renderSetup();
  // The tap that completes a team brings up that team's color sheet.
  const justFilled = ['A', 'B'].find((side) => !wasFull[side] && sideFull(side));
  if (justFilled) openColorSheet(justFilled);
}

function sortByRecency(players, games) {
  const lastPlayedAt = {};
  games.forEach((g) => {
    [g.SideA_Player1, g.SideA_Player2, g.SideB_Player1, g.SideB_Player2].filter(Boolean).forEach((n) => {
      if (!(n in lastPlayedAt)) lastPlayedAt[n] = g.Date; // games arrive most-recent-first
    });
  });
  return [...players].sort((a, b) => {
    const aTime = a.Name in lastPlayedAt ? new Date(lastPlayedAt[a.Name]).getTime() : -Infinity;
    const bTime = b.Name in lastPlayedAt ? new Date(lastPlayedAt[b.Name]).getTime() : -Infinity;
    if (aTime !== bTime) return bTime - aTime;
    return a.Name.localeCompare(b.Name);
  });
}

async function loadRoster() {
  try {
    await apiGetCached('getLogGameData', null, ({ players, games }) => {
      roster = sortByRecency(players.filter((p) => !p.Archived), games);
      const names = new Set(roster.map((p) => p.Name));
      Object.keys(draft.slots).forEach((id) => { if (draft.slots[id] && !names.has(draft.slots[id])) draft.slots[id] = ''; });
      if (!game) renderSetup();
    });
  } catch (err) {
    showStatus('live-setup-status', 'error', 'Could not load players: ' + err.message);
  }
}

function startGame() {
  if (!lineupFull()) return;
  const { sideA, sideB } = draftSides();
  if (new Set(sideA.concat(sideB)).size !== sideA.length + sideB.length) return;
  game = {
    setup: {
      format: draft.format,
      sideA,
      sideB,
      firstServingSide: draft.firstServingSide,
      target: draft.target,
      colors: typeof normalizeTeamColors === 'function' ? normalizeTeamColors(draft.colors) : undefined,
      from: draft.from || undefined,
      startedAt: Date.now(),
      oddsA: roster.length ? oddsForA(sideA, sideB) : null,
    },
    events: [],
    requestId: newRequestId(),
    saved: null,
  };
  storeGame();
  const now = Date.now();
  startHold = { startedAt: now, until: now + (broadcastEnabled() ? START_HOLD_MAX_MS : START_HOLD_MS), waitingForPush: broadcastEnabled() };
  render();
  broadcastGame();
  tickStartHold();
}

function startHoldActive() {
  return Boolean(startHold && Date.now() < startHold.until && game && !game.events.length);
}

// Shows "Get ready" with a fill bar on Point/Fault while the TV animation plays.
function tickStartHold() {
  const active = startHoldActive();
  ['live-point', 'live-fault'].forEach((id) => $(id).classList.toggle('on-hold', active));
  const total = startHold ? startHold.until - startHold.startedAt : 1;
  const left = startHold ? Math.max(0, startHold.until - Date.now()) : 0;
  document.querySelectorAll('.live-hold-fill').forEach((el) => { el.style.width = (100 - (left / total) * 100).toFixed(1) + '%'; });
  if (active) requestAnimationFrame(tickStartHold);
  else { startHold = null; ['live-point', 'live-fault'].forEach((id) => $(id).classList.remove('on-hold')); }
}

// ---------- scoring screen ----------

function undo() {
  if (!game || game.saved || !game.events.length) return;
  game.events.pop();
  storeGame();
  render();
  broadcastGame();
}

function showToast(text, side) {
  const el = $('live-toast');
  el.textContent = text;
  el.className = 'live-toast show ' + (side === 'A' ? 'side-a' : 'side-b');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { el.className = 'live-toast'; }, 1400);
}

function tap(result) {
  const now = Date.now();
  if (now - lastTapAt < TAP_GUARD_MS) return;
  if (startHoldActive()) return;
  lastTapAt = now;
  if (!game || game.saved) return;
  const before = replayLiveGame(game.setup, game.events);
  if (before.over) return;
  game.events.push({ result, at: now });
  storeGame();
  broadcastGame();
  try { if (navigator.vibrate) navigator.vibrate(result === 'Point' ? 12 : [8, 40, 8]); } catch (err) { /* no haptics */ }
  render();
  const after = replayLiveGame(game.setup, game.events);
  if (after.over) return;
  if (result === 'Fault') playFaultAnimation($('live-court'), before, after, { shakeEl: document.querySelector('.live-court-wrap'), speed: 0.85, shake: 4 });
  else animateCourtMoves($('live-court'), before, after, { speed: 0.85 });
  // The toast waits for the ball to reach the net, so it doesn't cover the fault animation.
  const toastDelay = result === 'Fault' ? 650 : 0;
  if (after.servingSide !== before.servingSide) setTimeout(() => showToast(`Side out · ${firstName(after.server)} serves`, after.servingSide), toastDelay);
  else if (after.server !== before.server) setTimeout(() => showToast(`2nd server · ${firstName(after.server)}`, after.servingSide), toastDelay);
}

let shownScores = null;

function renderScoring(state) {
  const { setup } = game;
  const s = state.servingSide;

  $('live-call').textContent = state.call.replace(/-/g, ' – ');
  $('live-call-caption').textContent = state.doubles
    ? `${firstName(state.server)} serving · ${state.serverNumber === 1 ? '1st' : '2nd'} server · ${state.serveCourt} court`
    : `${firstName(state.server)} serving · ${state.serveCourt} court`;
  const winBy2 = !state.gamePoint && Math.min(state.scores.A, state.scores.B) >= state.target - 1;
  const gpEl = $('live-game-point');
  gpEl.textContent = state.gamePoint ? 'Game point' : 'Win by 2';
  gpEl.classList.toggle('winby2', winBy2);
  gpEl.style.display = state.gamePoint || winBy2 ? 'inline-flex' : 'none';

  ['A', 'B'].forEach((side) => {
    const tile = $('live-team-' + side.toLowerCase());
    tile.classList.toggle('serving', side === s);
    tile.querySelector('.live-tile-names').textContent = sideNames(setup, side);
    const scoreEl = tile.querySelector('.live-tile-score');
    scoreEl.textContent = state.scores[side];
    if (shownScores && shownScores[side] !== state.scores[side]) {
      scoreEl.classList.remove('pop');
      void scoreEl.offsetWidth; // restart the animation
      scoreEl.classList.add('pop');
    }
  });
  shownScores = { ...state.scores };

  $('live-court').innerHTML = courtSvg(state);

  const next = liveNextOutcomes(setup, game.events);
  const pointBtn = $('live-point');
  pointBtn.classList.toggle('side-a', s === 'A');
  pointBtn.classList.toggle('side-b', s === 'B');
  $('live-point-label').textContent = sideNames(setup, s);
  $('live-point-sub').textContent = next.point.over ? 'Wins the game 🏆' : `Call → ${next.point.call.replace(/-/g, '–')}`;
  $('live-fault-label').textContent = next.fault.sideOut ? 'Side out' : '2nd server';
  $('live-fault-sub').textContent = `${firstName(next.fault.server)} serves next`;

  const last = state.rallies[state.rallies.length - 1];
  $('live-undo').disabled = !game.events.length;
  $('live-undo-sub').textContent = last ? `${last.result} · ${firstName(last.server)}` : 'Nothing yet';
  $('live-rally-count').textContent = `${state.rallies.length} rall${state.rallies.length === 1 ? 'y' : 'ies'}`;
  $('live-edit-lineup').style.display = game.events.length ? 'none' : 'inline-flex';
  updateClock();
}

function updateClock() {
  if (!game) return;
  const started = Number(game.setup.startedAt) || Date.now();
  $('live-clock').textContent = '⏱ ' + formatLiveClock((Date.now() - started) / 1000);
}

// ---------- final screen ----------

let celebratedGame = null;

function renderFinal(state) {
  const { setup } = game;
  const w = state.winner;
  const l = w === 'A' ? 'B' : 'A';
  const summary = summarizeLiveGame(setup, state);

  const hero = $('live-hero');
  hero.classList.toggle('side-a', w === 'A');
  hero.classList.toggle('side-b', w === 'B');
  $('live-final-title').textContent = `${sideNames(setup, w)} win`;
  $('live-final-score').textContent = `${state.scores[w]} – ${state.scores[l]}`;
  let badge = '';
  if (typeof setup.oddsA === 'number') {
    const pW = Math.round((w === 'A' ? setup.oddsA : 1 - setup.oddsA) * 100);
    badge = pW < 50 ? `Upset! Only ${pW}% to win before the game` : `${pW}% favorite before the game`;
  }
  $('live-final-badge').textContent = badge;
  $('live-final-badge').style.display = badge ? 'inline-flex' : 'none';

  const best = Math.max(summary.longestRun.A, summary.longestRun.B);
  const tiles = [
    ['Game time', formatLiveClock(summary.durationSec)],
    ['Rallies', summary.rallyCount],
    ['Side outs', summary.sideOuts],
    ['Best run', `${best} pts`],
  ];
  $('live-final-sub').innerHTML = tiles.map(([k, v]) => `<div class="live-stat"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');

  const names = setup.sideA.concat(setup.sideB);
  const maxPts = Math.max(1, ...names.map((n) => summary.players[n].servePoints));
  $('live-final-stats').innerHTML = names.map((name) => {
    const p = summary.players[name];
    const pct = Math.round((p.servePoints / maxPts) * 100);
    return `<div class="live-serve-row side-${p.side.toLowerCase()}${p.side === w ? ' won' : ''}">`
      + `<span class="live-avatar">${escapeHtml(initials(name))}</span>`
      + `<span class="live-serve-name">${escapeHtml(name)}</span>`
      + `<span class="live-serve-bar"><i style="width:${pct}%"></i></span>`
      + `<span class="live-serve-num"><b>${p.servePoints}</b> / ${p.serves}</span></div>`;
  }).join('');
  $('live-final-runs').textContent = `Serve points / serves · Longest run: ${sideNames(setup, 'A')} ${summary.longestRun.A}, ${sideNames(setup, 'B')} ${summary.longestRun.B}`;

  const saved = Boolean(game.saved);
  $('live-save').style.display = saved ? 'none' : 'block';
  $('live-final-undo').style.display = saved ? 'none' : 'inline-flex';
  $('live-after-save').style.display = saved ? 'grid' : 'none';
  $('live-back-mm').hidden = !(saved && setup.from === 'mm');
  if (saved) {
    const fmt = (d) => `<span class="${d >= 0 ? 'delta-pos' : 'delta-neg'}">${d >= 0 ? '+' : ''}${d}</span>`;
    showStatus('live-save-status', 'success', `Saved as ${escapeHtml(game.saved.gameId)}. Immediate model impact: Side A ${fmt(game.saved.deltaA)}, Side B ${fmt(game.saved.deltaB)}.`, true);
  }
  if (celebratedGame !== game.requestId) {
    celebratedGame = game.requestId;
    const palette = typeof teamConfettiPalette === 'function' ? teamConfettiPalette(setup.colors, w) : null;
    requestAnimationFrame(() => fireConfetti($('live-confetti'), 90, palette));
  }
}

async function saveGame() {
  const state = replayLiveGame(game.setup, game.events);
  if (!state.over || game.saved) return;
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;

  const btn = $('live-save');
  btn.disabled = true;
  showStatus('live-save-status', '', 'Saving…');
  try {
    const result = await apiPost('logGame', {
      passcode,
      requestId: game.requestId,
      date: new Date(game.setup.startedAt).toISOString(),
      format: game.setup.format,
      sideAPlayers: game.setup.sideA,
      sideBPlayers: game.setup.sideB,
      scoreA: state.scores.A,
      scoreB: state.scores.B,
      rallies: state.rallies.map((r) => ({
        servingSide: r.servingSide,
        server: r.server,
        serverNumber: r.serverNumber,
        result: r.result,
        scoreA: r.scoreA,
        scoreB: r.scoreB,
        elapsedSec: r.elapsedSec,
      })),
    });
    game.saved = { gameId: result.game.GameId, deltaA: result.game.EloDeltaA, deltaB: result.game.EloDeltaB };
    storeGame();
    broadcastGame();
    invalidateAllCache();
    releaseWakeLock();
    render();
  } catch (err) {
    if (/passcode/i.test(err.message)) clearStoredPasscode();
    showStatus('live-save-status', 'error', 'Not saved: ' + err.message + ' Your game is still here, so you can try again.');
  } finally {
    btn.disabled = false;
  }
}

function backToSetup(keepLineup, swapSides) {
  // A finished game stays up on the TV until the next one starts; a game
  // that's discarded or re-lined-up before it finished is cleared from it.
  const finished = Boolean(game && replayLiveGame(game.setup, game.events).over);
  if (game && keepLineup) {
    const { setup } = game;
    const a = swapSides ? setup.sideB : setup.sideA;
    const b = swapSides ? setup.sideA : setup.sideB;
    draft.format = setup.format;
    draft.target = setup.target;
    draft.slots = { a1: a[0] || '', a2: a[1] || '', b1: b[0] || '', b2: b[1] || '' };
    // Colors stay with the people: a swapped rematch swaps them too.
    if (setup.colors) draft.colors = swapSides ? { A: setup.colors.B, B: setup.colors.A } : { ...setup.colors };
  } else if (!keepLineup) {
    draft.slots = { a1: '', a2: '', b1: '', b2: '' };
    draft.from = '';
  }
  game = null;
  storeGame();
  releaseWakeLock();
  render();
  loadRoster();
  if (!finished) broadcastGame();
}

// ---------- TV / spectator broadcast ----------
//
// Every change to the game (start, tap, undo, save, discard) sends the whole
// game to the backend's pushLive slot; live-view.html polls getLive and
// replays it with the same engine, so the TV shows exactly this screen.
// Sends are serialized: one request in flight, and taps made meanwhile are
// folded into the next send, so the TV never goes backwards and quick taps
// don't pile up requests. Scoring never waits on this: it's fire-and-forget,
// uses the stored admin passcode only (never a prompt mid-game), and failures
// just retry in the background.

const LIVE_BROADCAST_KEY = 'pickleballLiveBroadcast'; // 'off' turns it off on this phone
const broadcast = { inFlight: false, pending: false, status: 'idle', okAt: 0, ms: 0, error: '', failures: 0, retryTimer: null };

function broadcastEnabled() {
  try { return localStorage.getItem(LIVE_BROADCAST_KEY) !== 'off'; } catch (err) { return true; }
}

function liveSnapshot() {
  if (!game) return null;
  return {
    requestId: game.requestId,
    setup: game.setup,
    events: game.events,
    saved: game.saved ? { gameId: game.saved.gameId } : null,
  };
}

function setBroadcastStatus(status) {
  broadcast.status = status;
  renderBroadcastStatus();
}

async function broadcastGame() {
  if (!broadcastEnabled()) { setBroadcastStatus('off'); return; }
  if (broadcast.inFlight) { broadcast.pending = true; return; }
  let passcode = '';
  try { passcode = localStorage.getItem(ADMIN_PASSCODE_STORAGE_KEY) || ''; } catch (err) { passcode = ''; }
  if (!passcode) { setBroadcastStatus('locked'); return; }

  clearTimeout(broadcast.retryTimer);
  broadcast.inFlight = true;
  broadcast.pending = false;
  setBroadcastStatus('sending');
  const started = performance.now();
  try {
    await apiPost('pushLive', { passcode, live: liveSnapshot() });
    broadcast.ms = Math.round(performance.now() - started);
    broadcast.okAt = Date.now();
    broadcast.failures = 0;
    if (startHold && startHold.waitingForPush) {
      startHold.waitingForPush = false;
      startHold.until = Math.min(startHold.startedAt + START_HOLD_MAX_MS, Math.max(startHold.startedAt + START_HOLD_MS, broadcast.okAt + START_HOLD_AFTER_PUSH_MS));
    }
    broadcast.error = '';
    setBroadcastStatus('ok');
  } catch (err) {
    broadcast.failures += 1;
    broadcast.error = /Unknown action/i.test(err.message) ? 'The backend doesn’t have the live display yet (deploy the new Code.gs).' : err.message;
    setBroadcastStatus('error');
    // Retry the latest state with backoff, unless a newer change is already queued.
    if (!broadcast.pending && !/passcode|Unknown action/i.test(err.message)) {
      broadcast.retryTimer = setTimeout(broadcastGame, Math.min(30000, 2000 * 2 ** (broadcast.failures - 1)));
    }
  } finally {
    broadcast.inFlight = false;
    if (broadcast.pending) broadcastGame();
  }
}

function broadcastLabel() {
  switch (broadcast.status) {
    case 'ok': return { cls: 'ok', short: 'TV', text: `Live on the TV link · last update reached it in ${(broadcast.ms / 1000).toFixed(1)}s` };
    case 'sending': return { cls: 'sending', short: 'TV', text: 'Sending the latest score…' };
    case 'error': return { cls: 'error', short: 'TV', text: `Not reaching the TV link: ${broadcast.error} Scoring still works and it keeps retrying.` };
    case 'locked': return { cls: 'off', short: 'TV', text: 'Unlock Admin Mode on this phone to broadcast.' };
    case 'off': return { cls: 'off', short: 'TV', text: 'Broadcast is off for this phone.' };
    default: return { cls: 'idle', short: 'TV', text: 'The TV link follows the game as soon as you start it.' };
  }
}

function renderBroadcastStatus() {
  const label = broadcastLabel();
  document.querySelectorAll('.live-sync-dot').forEach((dot) => { dot.className = 'live-sync-dot ' + label.cls; });
  const status = $('live-share-status');
  if (status) { status.textContent = label.text; status.className = 'live-share-status ' + label.cls; }
}

function openShareSheet() {
  const url = liveViewUrl();
  $('live-share-url').value = url;
  $('live-share-open').href = url;
  const qr = qrSvg(url);
  $('live-share-qr').innerHTML = qr;
  $('live-share-qr').style.display = qr ? 'block' : 'none';
  $('live-share-native').style.display = navigator.share ? 'inline-flex' : 'none';
  $('live-broadcast-toggle').checked = broadcastEnabled();
  $('live-share-copy').textContent = 'Copy';
  renderBroadcastStatus();
  $('live-share').hidden = false;
  requestAnimationFrame(() => $('live-share').classList.add('open'));
}

function closeShareSheet() {
  $('live-share').classList.remove('open');
  setTimeout(() => { $('live-share').hidden = true; }, 200);
}

async function copyShareLink() {
  const input = $('live-share-url');
  let copied = false;
  try { await navigator.clipboard.writeText(input.value); copied = true; } catch (err) {
    input.select();
    try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
  }
  $('live-share-copy').textContent = copied ? 'Copied ✓' : 'Select & copy';
}

// ---------- shared ----------

function showStatus(id, kind, html, isHtml) {
  const el = $(id);
  el.className = 'status' + (kind ? ' ' + kind : '');
  if (isHtml) el.innerHTML = html; else el.textContent = html;
  el.style.display = html ? 'block' : 'none';
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) { wakeLock = null; /* best effort */ }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

function render() {
  const state = game ? replayLiveGame(game.setup, game.events) : null;
  const screen = !game ? 'setup' : state.over ? 'final' : 'scoring';
  if (screen !== render.lastScreen) { render.lastScreen = screen; window.scrollTo(0, 0); }
  $('live-setup').style.display = screen === 'setup' ? 'block' : 'none';
  $('live-scoring').style.display = screen === 'scoring' ? 'block' : 'none';
  $('live-final').style.display = screen === 'final' ? 'block' : 'none';
  document.body.classList.toggle('live-in-progress', screen === 'scoring');
  if (typeof applyTeamColors === 'function') applyTeamColors(document.body, game ? game.setup.colors : draft.colors);

  clearInterval(clockTimer);
  clockTimer = null;
  if (screen !== 'scoring') shownScores = null; // no score 'pop' on a fresh or resumed game
  if (screen === 'setup') renderSetup();
  if (screen === 'scoring') {
    renderScoring(state);
    clockTimer = setInterval(updateClock, 1000);
    requestWakeLock();
  }
  if (screen === 'final') {
    showStatus('live-save-status', '', '');
    renderFinal(state);
  }
}

// ---------- wiring ----------

$('live-format').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-format]');
  if (!btn) return;
  draft.format = btn.dataset.format;
  renderSetup();
});

$('live-target').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-target]');
  if (!btn) return;
  draft.target = Number(btn.dataset.target);
  renderSetup();
});

$('live-first-server').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-side]');
  if (!btn) return;
  draft.firstServingSide = btn.dataset.side;
  renderSetup();
});

$('live-player-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.player-chip');
  if (btn && !btn.disabled) togglePlayer(btn.dataset.player);
});

$('live-team-slots').addEventListener('click', (e) => {
  const clear = e.target.closest('[data-clear-slot]');
  if (clear) { draft.slots[clear.dataset.clearSlot] = ''; renderSetup(); return; }
  const swap = e.target.closest('.live-swap-court');
  if (swap) {
    const side = swap.dataset.side;
    [draft.slots[side + '1'], draft.slots[side + '2']] = [draft.slots[side + '2'], draft.slots[side + '1']];
    renderSetup();
  }
});

$('live-team-slots').addEventListener('click', (e) => {
  const chip = e.target.closest('.live-color-chip');
  if (chip) openColorSheet(chip.dataset.side);
});
$('live-color-sheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeColorSheet(false); return; }
  const btn = e.target.closest('button.live-swatch');
  if (btn && colorSheetSide) pickTeamColor(colorSheetSide, btn.dataset.hex, true);
});
$('live-color-sheet').addEventListener('input', (e) => {
  if (e.target.type === 'color' && colorSheetSide) pickTeamColor(colorSheetSide, e.target.value, false);
});
$('live-color-sheet').addEventListener('change', (e) => {
  if (e.target.type === 'color' && colorSheetSide) pickTeamColor(colorSheetSide, e.target.value, true);
});
$('live-color-done').addEventListener('click', () => closeColorSheet(true));

$('live-clear').addEventListener('click', () => { draft.slots = { a1: '', a2: '', b1: '', b2: '' }; renderSetup(); });
$('live-start').addEventListener('click', startGame);
$('live-point').addEventListener('click', () => tap('Point'));
$('live-fault').addEventListener('click', () => tap('Fault'));
$('live-undo').addEventListener('click', undo);
$('live-final-undo').addEventListener('click', undo);
$('live-save').addEventListener('click', saveGame);
$('live-edit-lineup').addEventListener('click', () => backToSetup(true, false));
$('live-discard').addEventListener('click', () => {
  if (window.confirm('Discard this game? The score so far will be lost.')) backToSetup(true, false);
});
$('live-rematch').addEventListener('click', () => backToSetup(true, false));
$('live-swap-rematch').addEventListener('click', () => backToSetup(true, true));
$('live-new-game').addEventListener('click', () => backToSetup(false, false));
$('unlock-live').addEventListener('click', unlockAdminMode);
$('live-tv').addEventListener('click', openShareSheet);
$('live-tv-setup').addEventListener('click', openShareSheet);
$('live-tv-final').addEventListener('click', openShareSheet);
$('live-share').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeShareSheet(); });
$('live-share-copy').addEventListener('click', copyShareLink);
$('live-share-native').addEventListener('click', () => {
  navigator.share({ title: 'Live pickleball', text: 'Follow the game live', url: $('live-share-url').value }).catch(() => {});
});
$('live-broadcast-toggle').addEventListener('change', (e) => {
  try { localStorage.setItem(LIVE_BROADCAST_KEY, e.target.checked ? 'on' : 'off'); } catch (err) { /* ignore */ }
  if (e.target.checked) broadcastGame(); else setBroadcastStatus('off');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('live-share').hidden) closeShareSheet();
  if (!$('live-color-sheet').hidden) closeColorSheet(false);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !game) return;
  if (!game.saved && !replayLiveGame(game.setup, game.events).over) requestWakeLock();
  if (broadcast.status === 'error' || broadcast.status === 'idle') broadcastGame(); // catch the TV up after the phone slept
});

/* Matchmaking opens this page with the lineup in the link
   (?from=mm&format=Doubles&target=11&a=..&a2=..&b=..&b2=..). The link is
   cleared straight away so a reload doesn't re-apply it. */
function readLivePrefill() {
  const p = new URLSearchParams(window.location.search);
  const a = p.get('a');
  const b = p.get('b');
  if (!a || !b) return null;
  const format = p.get('format') === 'Singles' ? 'Singles' : 'Doubles';
  const pre = { format, a1: a, a2: p.get('a2') || '', b1: b, b2: p.get('b2') || '', target: Number(p.get('target')), from: p.get('from') || '' };
  history.replaceState(null, '', window.location.pathname);
  if (format === 'Doubles' && (!pre.a2 || !pre.b2)) return null;
  return pre;
}

const livePrefill = readLivePrefill();
game = loadStoredGame();
if (livePrefill && !game) {
  draft.format = livePrefill.format;
  draft.slots = { a1: livePrefill.a1, a2: livePrefill.a2, b1: livePrefill.b1, b2: livePrefill.b2 };
  if ([11, 15, 21].includes(livePrefill.target)) draft.target = livePrefill.target;
  draft.from = livePrefill.from;
}
render();
if (livePrefill && !game) {
  // Both teams arrived filled: ask for Side A's color, then Side B's.
  colorSheetQueue = ['B'];
  openColorSheet('A');
} else if (livePrefill && game) {
  setTimeout(() => showToast('Finish or discard this game first, then start the Matchmaking game', null), 400);
}
loadRoster();
if (game) broadcastGame(); // a resumed game: bring the TV up to date
