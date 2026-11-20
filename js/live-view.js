// Live scoreboard for a TV or a spectator's phone (live-view.html).
//
// Public and read-only: it polls the backend's getLive slot, which the
// scorer's phone fills on every tap (broadcastGame in live-game.js), replays
// the event list with js/live-score.js and draws it big. Nothing is stored or
// sent from here, so anyone with the link can watch.
//
// Speed: the page long-polls:
// getLive?since=<version> is held open by the backend until the scorer's
// next push lands (or ~5s pass), so a tap reaches the TV about one Apps
// Script round trip after it reaches the backend, instead of also waiting
// for the next poll. One request at a time, never overlapping; the page only
// re-renders when the game actually changed, and it stops while hidden. An
// older backend without long polling still works: it falls back to polling
// every VIEW_POLL_LIVE_MS during a game and VIEW_POLL_IDLE_MS otherwise.

const VIEW_POLL_LIVE_MS = 300; // gap between polls if the backend can't long-poll
const VIEW_POLL_IDLE_MS = 1500;
const VIEW_TIMEOUT_MS = 12000;
const VIEW_FINAL_HOLD_MS = 30 * 60 * 1000; // a finished game stays up this long
const VIEW_FEED_SIZE = 7;

const $ = (id) => document.getElementById(id);
const tv = $('tv');

let snapshot = null; // { live, updatedAt (ms) } from the last good poll
let lastKey = null;
let screen = 'loading';
let shown = null; // { requestId, events } of what's on screen now
let model = null; // live win-chance model for the current game
let celebrated = null;
let failures = 0;
let lastError = '';
let lastOkAt = 0;
let lastChangeAt = 0;
let pollTimer = null;
let longPollWorks = true; // false if the backend answers `since` polls instantly (older Code.gs)
let wakeLock = null;

// Read by the speed test (and handy in the console): recent round trips and
// when each change was drawn.
window.liveViewStats = { roundTrips: [], applied: [], renderMs: [] };

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('The league data took too long to answer.')), ms))]);
}

function gameKey(live) {
  if (!live) return 'none';
  const last = live.events[live.events.length - 1];
  return [live.requestId, live.events.length, last ? last.at : 0, live.saved ? live.saved.gameId : ''].join('|');
}

// ---------- polling ----------

async function poll() {
  clearTimeout(pollTimer);
  pollTimer = null;
  const started = performance.now();
  const since = snapshot && snapshot.version && !failures ? snapshot.version : '';
  try {
    const data = await withTimeout(apiGet('getLive', since ? { since } : null), VIEW_TIMEOUT_MS);
    if (since) longPollWorks = !((data && data.version) === since && performance.now() - started < 1500);
    const rt = window.liveViewStats.roundTrips;
    rt.push(Math.round(performance.now() - started));
    if (rt.length > 60) rt.shift();
    failures = 0;
    lastError = '';
    lastOkAt = Date.now();
    apply(data || {});
  } catch (err) {
    failures += 1;
    lastError = /Unknown action/i.test(err.message)
      ? 'The live display isn’t switched on in the league backend yet.'
      : err.message;
    if (screen === 'loading') { screen = 'waiting'; tv.dataset.screen = 'waiting'; renderWaiting(null, null); }
  }
  renderSync();
  schedule();
}

function schedule() {
  clearTimeout(pollTimer);
  if (document.visibilityState === 'hidden') { pollTimer = null; return; }
  let delay;
  if (failures) delay = Math.min(15000, 1000 * 2 ** Math.min(failures, 4));
  else if (longPollWorks && snapshot && snapshot.version) delay = 20;
  else delay = screen === 'live' || screen === 'final' ? VIEW_POLL_LIVE_MS : VIEW_POLL_IDLE_MS;
  pollTimer = setTimeout(poll, delay);
}

function apply(data) {
  const live = data.live && data.live.setup && Array.isArray(data.live.events) ? data.live : null;
  snapshot = { live, updatedAt: data.updatedAt ? Date.parse(data.updatedAt) : 0, version: data.version || '' };
  const key = gameKey(live);
  const finalExpired = screen === 'final' && snapshot.updatedAt && Date.now() - snapshot.updatedAt > VIEW_FINAL_HOLD_MS;
  if (key === lastKey && !finalExpired) return;
  lastKey = key;
  lastChangeAt = Date.now();
  render();
  window.liveViewStats.applied.push({ key, at: Date.now() });
  if (window.liveViewStats.applied.length > 200) window.liveViewStats.applied.shift();
}

// ---------- rendering ----------

function setScreen(next) {
  if (next === screen) return;
  screen = next;
  tv.dataset.screen = next;
}

function render() {
  const t0 = performance.now();
  const live = snapshot && snapshot.live;
  if (!live) {
    setScreen('waiting');
    renderWaiting(null, null);
  } else {
    const state = replayLiveGame(live.setup, live.events);
    if (!state.over) {
      setScreen('live');
      renderLive(live, state);
    } else if (!snapshot.updatedAt || Date.now() - snapshot.updatedAt < VIEW_FINAL_HOLD_MS) {
      setScreen('final');
      renderFinal(live, state);
    } else {
      setScreen('waiting');
      renderWaiting(live, state);
    }
  }
  updatePill();
  updateClock();
  const ms = window.liveViewStats.renderMs;
  ms.push(Math.round((performance.now() - t0) * 10) / 10);
  if (ms.length > 60) ms.shift();
}

function updatePill() {
  const pill = $('tv-pill');
  pill.className = 'tv-pill ' + (screen === 'live' ? 'live' : screen === 'final' ? 'final' : 'waiting');
  $('tv-pill-text').textContent = screen === 'live' ? 'LIVE' : screen === 'final' ? 'FINAL' : 'STANDBY';
  const live = snapshot && snapshot.live;
  $('tv-meta').textContent = live && screen !== 'waiting'
    ? `${live.setup.format} · Game to ${live.setup.target || LIVE_DEFAULT_TARGET}`
    : '';
}

function teamPlayersHtml(names) {
  return names.map((n) => `<span class="tv-team-player"><span class="tv-av">${escapeHtml(initials(n))}</span>${escapeHtml(n)}</span>`).join('');
}

function bump(el, cls, ms) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
  clearTimeout(el['_' + cls]);
  el['_' + cls] = setTimeout(() => el.classList.remove(cls), ms);
}

function flash(text, side) {
  const el = $('tv-flash');
  el.textContent = text;
  el.className = 'tv-flash side-' + side.toLowerCase();
  bump(el, 'show', 1600);
}

function rallyFeedHtml(setup, state, isNew) {
  const rallies = state.rallies;
  const items = [];
  for (let i = rallies.length - 1; i >= Math.max(0, rallies.length - VIEW_FEED_SIZE); i -= 1) {
    const r = rallies[i];
    const next = rallies[i + 1];
    const nextSide = next ? next.servingSide : state.servingSide;
    const nextServer = next ? next.server : state.server;
    const kind = liveRallyKind(r, nextSide, state.doubles);
    let title, detail, side;
    if (kind === 'point') { title = `Point · ${sideNames(setup, r.servingSide)}`; detail = `${firstName(r.server)} serving`; side = r.servingSide; }
    else if (kind === 'second') { title = '2nd server'; detail = `${firstName(nextServer)} up`; side = r.servingSide; }
    else { title = `Side out · ${sideNames(setup, nextSide)}`; detail = `${firstName(nextServer)} to serve`; side = nextSide; }
    items.push(`<li class="kind-${kind} side-${side.toLowerCase()}${i === rallies.length - 1 && isNew ? ' new' : ''}">`
      + '<span class="dot"></span>'
      + `<span class="what"><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span>`
      + `<span class="score">${r.scoreA}–${r.scoreB}</span>`
      + `<span class="time">${formatLiveClock(r.elapsedSec)}</span></li>`);
  }
  return items.join('') || '<li class="kind-start"><span class="dot"></span><span class="what"><b>Game on</b><small>First serve coming up</small></span><span></span><span></span></li>';
}

function renderLive(live, state) {
  const { setup } = live;
  const fresh = !shown || shown.requestId !== live.requestId;
  const oneMore = !fresh && live.events.length === shown.events + 1;
  if (fresh) {
    model = liveWinModel(setup);
    ['A', 'B'].forEach((side) => {
      $('tv-team-' + side.toLowerCase()).querySelector('.tv-team-players').innerHTML = teamPlayersHtml(side === 'A' ? setup.sideA : setup.sideB);
    });
  }

  ['A', 'B'].forEach((side) => {
    const team = $('tv-team-' + side.toLowerCase());
    const serving = state.servingSide === side;
    team.classList.toggle('serving', serving);
    const scoreEl = team.querySelector('.tv-score');
    const score = String(state.scores[side]);
    if (scoreEl.textContent !== score) {
      scoreEl.textContent = score;
      if (!fresh) { bump(scoreEl, 'bump', 700); bump(team, 'scored', 1000); }
    }
    team.querySelector('.tv-serving-text').textContent = serving
      ? (state.doubles ? `${firstName(state.server)} · ${state.serverNumber === 1 ? '1st' : '2nd'} server` : `${firstName(state.server)} serving`)
      : '';
  });

  $('tv-call').textContent = state.call.replace(/-/g, ' – ');
  $('tv-caption').textContent = `${firstName(state.server)} serving from the ${state.serveCourt}`;
  const gp = $('tv-gamepoint');
  gp.hidden = !state.gamePoint;
  if (state.gamePoint) {
    gp.textContent = `Game point · ${sideNames(setup, state.servingSide)}`;
    gp.className = 'tv-gamepoint side-' + state.servingSide.toLowerCase();
  }

  const pA = Math.round(model.chanceA(state) * 100);
  $('tv-chance-fill').style.width = pA + '%';
  $('tv-chance-a').textContent = pA + '%';
  $('tv-chance-b').textContent = (100 - pA) + '%';

  $('tv-court').innerHTML = courtSvg(state);

  const run = liveCurrentRun(state);
  $('tv-run').innerHTML = run.run >= 3
    ? `<span class="tv-run-chip side-${run.side.toLowerCase()}">🔥 ${escapeHtml(sideNames(setup, run.side))} · ${run.run}–0 run</span>`
    : '';
  $('tv-feed').innerHTML = rallyFeedHtml(setup, state, oneMore);
  $('tv-foot-right').textContent = `Rally ${state.rallies.length + 1}`;

  if (oneMore) {
    const r = state.rallies[state.rallies.length - 1];
    const kind = liveRallyKind(r, state.servingSide, state.doubles);
    if (kind === 'sideout') flash('Side out', state.servingSide);
    else if (kind === 'second') flash('2nd server', state.servingSide);
  }
  shown = { requestId: live.requestId, events: live.events.length };
}

function renderFinal(live, state) {
  const { setup } = live;
  const w = state.winner;
  const l = w === 'A' ? 'B' : 'A';
  const summary = summarizeLiveGame(setup, state);
  const fin = $('tv-final');
  fin.classList.toggle('side-a', w === 'A');
  fin.classList.toggle('side-b', w === 'B');
  $('tv-final-names').textContent = `${sideNames(setup, w)} win`;
  $('tv-final-score').textContent = `${state.scores[w]} – ${state.scores[l]}`;

  let badge = '';
  if (typeof setup.oddsA === 'number') {
    const pW = Math.round((w === 'A' ? setup.oddsA : 1 - setup.oddsA) * 100);
    badge = pW < 50 ? `Upset! ${pW}% to win before the game` : `${pW}% favorite before the game`;
  }
  $('tv-final-badge').textContent = badge;
  $('tv-final-badge').hidden = !badge;

  const names = setup.sideA.concat(setup.sideB);
  const top = names.reduce((best, n) => (summary.players[n].servePoints > summary.players[best].servePoints ? n : best), names[0]);
  const tiles = [
    ['Game time', formatLiveClock(summary.durationSec)],
    ['Rallies', summary.rallyCount],
    ['Side-outs', summary.sideOuts],
    ['Best run', `${Math.max(summary.longestRun.A, summary.longestRun.B)} pts`],
    ['Top server', `${firstName(top)} · ${summary.players[top].servePoints}`],
  ];
  $('tv-final-stats').innerHTML = tiles.map(([k, v]) => `<div class="tv-stat"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
  $('tv-final-foot').textContent = live.saved
    ? `Saved to the league as ${live.saved.gameId} ✓`
    : `${sideNames(setup, l)} · ${state.scores[l]}   ·   Waiting for the scorer to save it to the league`;
  $('tv-foot-right').textContent = '';

  shown = { requestId: live.requestId, events: live.events.length };
  if (celebrated !== live.requestId) {
    celebrated = live.requestId;
    requestAnimationFrame(() => fireConfetti($('tv-confetti'), 180));
  }
}

function renderWaiting(live, state) {
  $('tv-waiting-title').textContent = lastError && !lastOkAt ? 'Can’t reach the league yet' : 'No game on right now';
  let sub = 'This screen switches on by itself when the next game starts.';
  if (lastError && !lastOkAt) sub = lastError + ' This screen keeps trying on its own.';
  else if (live && state && state.over) {
    const w = state.winner, l = w === 'A' ? 'B' : 'A';
    sub = `Last game: ${sideNames(live.setup, w)} beat ${sideNames(live.setup, l)} ${state.scores[w]}–${state.scores[l]}. ` + sub;
  }
  $('tv-waiting-sub').textContent = sub;
  $('tv-foot-right').textContent = '';
  shown = null;
}

function updateClock() {
  const live = snapshot && snapshot.live;
  if (!live || screen === 'waiting') { $('tv-clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return; }
  const state = screen === 'final' ? replayLiveGame(live.setup, live.events) : null;
  const sec = state ? state.elapsedSec : (Date.now() - Number(live.setup.startedAt || Date.now())) / 1000;
  $('tv-clock').textContent = '⏱ ' + formatLiveClock(sec);
}

function agoText(ms) {
  const s = Math.round(ms / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

function renderSync() {
  const el = $('tv-sync');
  const rt = window.liveViewStats.roundTrips;
  const recent = rt.slice(-10).sort((a, b) => a - b);
  const median = recent.length ? recent[Math.floor(recent.length / 2)] : 0;
  if (failures && lastOkAt) {
    el.className = 'tv-sync error';
    $('tv-sync-text').textContent = `Reconnecting… last update ${agoText(Date.now() - lastOkAt)}`;
  } else if (failures) {
    el.className = 'tv-sync error';
    $('tv-sync-text').textContent = 'Can’t reach the league data yet';
  } else if (lastOkAt) {
    el.className = 'tv-sync ok';
    const change = screen === 'live' && lastChangeAt ? ` · last update ${agoText(Date.now() - lastChangeAt)}` : '';
    const mode = longPollWorks && snapshot && snapshot.version ? 'Live link' : `${(median / 1000).toFixed(1)}s refresh`;
    $('tv-sync-text').textContent = `Connected · ${mode}${change}`;
  }
}

// ---------- TV niceties ----------

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) { wakeLock = null; }
}

const canFullscreen = Boolean(document.documentElement.requestFullscreen);
$('tv-fullscreen').style.display = canFullscreen ? '' : 'none';
$('tv-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
});

// Hide the cursor and buttons when nobody's touching the TV.
let idleTimer = null;
function wake() {
  tv.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => tv.classList.add('idle'), 3000);
}
['mousemove', 'touchstart', 'keydown'].forEach((evt) => document.addEventListener(evt, wake, { passive: true }));
wake();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWakeLock(); poll(); }
  else { clearTimeout(pollTimer); pollTimer = null; }
});

document.querySelector('.tv-ball').innerHTML = pickleballSvg();

// QR codes point at this same page (with ?api= so a fresh phone lands here).
const qr = qrSvg(liveViewUrl());
$('tv-qr-wait').innerHTML = qr;
$('tv-qr-live').innerHTML = qr;
if (!qr) document.querySelectorAll('.tv-qr-card, .tv-qr-mini').forEach((el) => { el.style.display = 'none'; });

setInterval(() => { updateClock(); renderSync(); }, 1000);
updateClock();
requestWakeLock();
if (typeof APPS_SCRIPT_URL !== 'undefined' && APPS_SCRIPT_URL) poll();
