// Match Up: pick two players and compare them side by side. Everything here is
// derived client-side from getLogGameData (full roster + full game log — the
// same cache key Log Game and History use, so it's usually a warm cache hit)
// plus getLeaderboard for rank, confidence and provisional status. There's no
// backend action of its own.
//
// `selected` is the single source of truth for who's being compared; the two
// <select>s write into it and the URL (?a=&b=) mirrors it so a match-up can be
// shared as a link.
let roster = [];       // every player, archived included
let games = [];        // most recent first
let leaderboard = [];  // unarchived, in ranked order
let gamesLoaded = false;
const selected = { a: '', b: '' };

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function profileLink(name) {
  return `<a class="player-link" href="player.html?name=${encodeURIComponent(name)}">${esc(name)}</a>`;
}

// Same formula as predictedWinProbability in Code.gs (ELO_PER_LOGIT there is
// 400 / ln 10, which makes this base-10/400 form exact).
function predictedProbability(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function sidesOf(g) {
  return {
    a: [g.SideA_Player1, g.SideA_Player2].filter(Boolean),
    b: [g.SideB_Player1, g.SideB_Player2].filter(Boolean),
  };
}

// Where `name` sits in game `g`: 'A', 'B', or null if they didn't play.
function sideOf(g, name) {
  const { a, b } = sidesOf(g);
  if (a.includes(name)) return 'A';
  if (b.includes(name)) return 'B';
  return null;
}

function emptyRecord() {
  return { w: 0, l: 0 };
}

function recordText(r) {
  return `${r.w}-${r.l}`;
}

function winPct(r) {
  const n = r.w + r.l;
  return n ? r.w / n : null;
}

function pctText(r) {
  const p = winPct(r);
  return p === null ? '–' : `${Math.round(p * 100)}%`;
}

// One pass over the log for a single player: overall/singles/doubles records,
// current streak (counting back from the most recent game, as the leaderboard
// does) and the last five results for the form dots.
function playerSummary(name) {
  const overall = emptyRecord();
  const singles = emptyRecord();
  const doubles = emptyRecord();
  const form = [];
  let streak = 0;
  let streakLocked = false;

  games.forEach((g) => {
    const side = sideOf(g, name);
    if (!side) return;
    const won = g.Winner === side;
    const bucket = g.Format === 'Singles' ? singles : doubles;
    overall[won ? 'w' : 'l'] += 1;
    bucket[won ? 'w' : 'l'] += 1;
    if (form.length < 5) form.push(won);
    if (!streakLocked) {
      if (streak === 0) streak = won ? 1 : -1;
      else if (streak > 0 === won) streak += won ? 1 : -1;
      else streakLocked = true;
    }
  });

  const player = roster.find((p) => p.Name === name) || {};
  const lb = leaderboard.find((p) => p.Name === name);
  let rank = null;
  if (lb && !lb.IsProvisional) {
    rank = leaderboard.filter((p) => !p.IsProvisional).findIndex((p) => p.Name === name) + 1;
  }

  return {
    name,
    elo: Math.round(Number(player.Elo) || 1000),
    archived: player.Archived === true,
    overall, singles, doubles,
    streak,
    form: form.reverse(),
    rank,
    provisional: lb ? lb.IsProvisional === true : null,
    confidence: lb ? Number(lb.Confidence) || 0 : null,
  };
}

// Every game where A and B were on opposite sides (from A's point of view),
// and every game where they were partners.
function gamesBetween(a, b) {
  const against = [];
  const together = [];
  games.forEach((g) => {
    const sa = sideOf(g, a);
    const sb = sideOf(g, b);
    if (!sa || !sb) return;
    if (sa === sb) together.push(g);
    else against.push(g);
  });
  return { against, together };
}

// Opponents both players have faced (in any format), with each one's record
// against them — the way to compare two people who've never met directly.
function commonOpponents(a, b) {
  const vs = { [a]: {}, [b]: {} };
  games.forEach((g) => {
    const { a: sideA, b: sideB } = sidesOf(g);
    [a, b].forEach((name) => {
      const side = sideOf(g, name);
      if (!side) return;
      const won = g.Winner === side;
      (side === 'A' ? sideB : sideA).forEach((opp) => {
        if (opp === a || opp === b) return;
        if (!vs[name][opp]) vs[name][opp] = emptyRecord();
        vs[name][opp][won ? 'w' : 'l'] += 1;
      });
    });
  });
  return Object.keys(vs[a])
    .filter((opp) => vs[b][opp])
    .map((opp) => ({ opp, a: vs[a][opp], b: vs[b][opp] }))
    .sort((x, y) => (y.a.w + y.a.l + y.b.w + y.b.l) - (x.a.w + x.a.l + x.b.w + x.b.l));
}

// ---- Rendering ----

function formDotsHtml(form) {
  if (!form.length) return '<span class="muted">–</span>';
  const label = form.map((won) => (won ? 'Win' : 'Loss')).join(', ');
  return `<span class="form-dots" aria-label="Recent form: ${label}" title="${label}">`
    + form.map((won) => `<span class="form-dot ${won ? 'win' : 'loss'}" aria-hidden="true"></span>`).join('')
    + '</span>';
}

function streakText(streak) {
  if (streak >= 3) return `🔥 W${streak}`;
  if (streak <= -3) return `🥶 L${Math.abs(streak)}`;
  if (streak > 0) return `W${streak}`;
  if (streak < 0) return `L${Math.abs(streak)}`;
  return '–';
}

// `edge` is 'a', 'b' or '' — which side gets the highlight for that row.
function edgeBy(valueA, valueB, higherIsBetter = true) {
  if (valueA === null || valueB === null || valueA === valueB) return '';
  return (valueA > valueB) === higherIsBetter ? 'a' : 'b';
}

function tapeRow(label, a, b, edge) {
  return `<div class="tape-row">
    <span class="tape-val tape-a${edge === 'a' ? ' edge' : ''}"><span>${a}</span></span>
    <span class="tape-label">${label}</span>
    <span class="tape-val tape-b${edge === 'b' ? ' edge' : ''}"><span>${b}</span></span>
  </div>`;
}

function renderOdds(A, B) {
  const pA = predictedProbability(A.elo, B.elo);
  const pctA = Math.round(pA * 100);
  const pctB = 100 - pctA;
  const caveats = [A, B]
    .filter((p) => p.overall.w + p.overall.l === 0 || p.provisional)
    .map((p) => (p.overall.w + p.overall.l === 0
      ? `${esc(p.name)} hasn't played yet`
      : `${esc(p.name)} is still provisional`));
  const note = caveats.length
    ? `Low confidence — ${caveats.join(' and ')}.`
    : 'Based on current ratings.';

  document.getElementById('odds-card').innerHTML = `
    <div class="odds-kicker">If they played singles today</div>
    <div class="odds-names">
      <span><strong>${pctA}%</strong> ${esc(A.name)}</span>
      <span>${esc(B.name)} <strong>${pctB}%</strong></span>
    </div>
    <div class="odds-bar" role="img" aria-label="${esc(A.name)} ${pctA}%, ${esc(B.name)} ${pctB}%">
      <span class="odds-a" style="width:${pctA}%"></span><span class="odds-b" style="width:${pctB}%"></span>
    </div>
    <div class="odds-note">${note}</div>`;
}

function renderTape(A, B) {
  const rankText = (p) => (p.rank ? `#${p.rank}` : p.archived ? 'Archived' : p.provisional ? 'P' : '–');
  const confText = (p) => (p.confidence === null ? '–' : `${p.confidence}%`);
  const rows = [
    tapeRow('Rating', A.elo, B.elo, edgeBy(A.elo, B.elo)),
    tapeRow('Rank', rankText(A), rankText(B), edgeBy(A.rank, B.rank, false)),
    tapeRow('Record', recordText(A.overall), recordText(B.overall), ''),
    tapeRow('Win %', pctText(A.overall), pctText(B.overall), edgeBy(winPct(A.overall), winPct(B.overall))),
    tapeRow('Singles', recordText(A.singles), recordText(B.singles), edgeBy(winPct(A.singles), winPct(B.singles))),
    tapeRow('Doubles', recordText(A.doubles), recordText(B.doubles), edgeBy(winPct(A.doubles), winPct(B.doubles))),
    tapeRow('Streak', streakText(A.streak), streakText(B.streak), edgeBy(A.streak, B.streak)),
    tapeRow('Last 5', formDotsHtml(A.form), formDotsHtml(B.form), ''),
    tapeRow('Confidence', confText(A), confText(B), ''),
  ];
  document.getElementById('tape').innerHTML = `
    <div class="tape-row tape-head">
      <span class="tape-a">${profileLink(A.name)}</span>
      <span class="tape-label">vs</span>
      <span class="tape-b">${profileLink(B.name)}</span>
    </div>
    ${rows.join('')}`;
}

function gameCardHtml(g, a, b) {
  const { a: sideA, b: sideB } = sidesOf(g);
  const aWon = g.Winner === 'A';
  const names = (list) => list
    .map((n) => (n === a || n === b ? `<span class="self">${profileLink(n)}</span>` : profileLink(n)))
    .join(' / ');
  const rows = [
    { names: names(sideA), score: g.ScoreA, won: aWon },
    { names: names(sideB), score: g.ScoreB, won: !aWon },
  ];
  rows.sort((x, y) => (y.won === x.won ? 0 : y.won ? 1 : -1)); // winner row first
  return `
    <div class="game-card">
      <div class="game-meta">
        <div class="meta-left">
          <span>${new Date(g.Date).toLocaleDateString()}</span>
          <span class="badge">${esc(g.Format)}</span>
        </div>
      </div>
      ${rows.map((r) => `
      <div class="game-row ${r.won ? 'winner' : 'loser'}">
        <span class="side-names">${r.won ? '<span class="trophy">🏆</span>' : ''}${r.names}</span>
        <span class="side-score">${r.score}</span>
      </div>`).join('')}
    </div>`;
}

function renderHeadToHead(A, B, against) {
  const all = emptyRecord();
  const singles = emptyRecord();
  const doubles = emptyRecord();
  let pointsA = 0;
  let pointsB = 0;
  against.forEach((g) => {
    const aSide = sideOf(g, A.name);
    const won = g.Winner === aSide;
    all[won ? 'w' : 'l'] += 1;
    (g.Format === 'Singles' ? singles : doubles)[won ? 'w' : 'l'] += 1;
    pointsA += Number(aSide === 'A' ? g.ScoreA : g.ScoreB) || 0;
    pointsB += Number(aSide === 'A' ? g.ScoreB : g.ScoreA) || 0;
  });

  const el = document.getElementById('h2h-section');
  if (!against.length) {
    el.innerHTML = `<div class="empty-state">${esc(A.name)} and ${esc(B.name)} haven't played against each other yet.</div>`;
    return;
  }
  const n = against.length;
  const leader = all.w === all.l ? 'All square' : `${esc(all.w > all.l ? A.name : B.name)} leads`;
  el.innerHTML = `
    <div class="h2h-score">
      <span class="h2h-num${all.w > all.l ? ' edge' : ''}">${all.w}</span>
      <span class="h2h-dash">–</span>
      <span class="h2h-num${all.l > all.w ? ' edge' : ''}">${all.l}</span>
    </div>
    <div class="h2h-leader">${leader}</div>
    <div class="profile-breakdown matchup-breakdown">
      <div class="breakdown-card"><span class="breakdown-label">Singles</span><strong>${recordText(singles)}</strong></div>
      <div class="breakdown-card"><span class="breakdown-label">Doubles</span><strong>${recordText(doubles)}</strong></div>
      <div class="breakdown-card"><span class="breakdown-label">Avg score</span><strong>${(pointsA / n).toFixed(1)}–${(pointsB / n).toFixed(1)}</strong></div>
    </div>
    ${against.map((g) => gameCardHtml(g, A.name, B.name)).join('')}`;
}

function renderPartners(A, B, together) {
  const el = document.getElementById('partners-section');
  if (!together.length) {
    el.innerHTML = `<div class="empty-state">They haven't teamed up yet.</div>`;
    return;
  }
  const rec = emptyRecord();
  together.forEach((g) => { rec[g.Winner === sideOf(g, A.name) ? 'w' : 'l'] += 1; });
  el.innerHTML = `
    <div class="profile-breakdown matchup-breakdown">
      <div class="breakdown-card"><span class="breakdown-label">Together</span><strong>${recordText(rec)} · ${pctText(rec)}</strong></div>
      <div class="breakdown-card"><span class="breakdown-label">${esc(A.name)} doubles</span><strong>${pctText(A.doubles)}</strong></div>
      <div class="breakdown-card"><span class="breakdown-label">${esc(B.name)} doubles</span><strong>${pctText(B.doubles)}</strong></div>
    </div>
    ${together.map((g) => gameCardHtml(g, A.name, B.name)).join('')}`;
}

function renderCommon(A, B) {
  const el = document.getElementById('common-section');
  const common = commonOpponents(A.name, B.name);
  if (!common.length) {
    el.innerHTML = '<div class="empty-state">No opponents in common yet.</div>';
    return;
  }
  const cell = (r, isEdge) => `<td class="${isEdge ? 'edge' : ''}">${recordText(r)} <span class="muted">${pctText(r)}</span></td>`;
  el.innerHTML = `
    <table class="common-table">
      <thead><tr><th>Opponent</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead>
      <tbody>
        ${common.map((c) => {
          const edge = edgeBy(winPct(c.a), winPct(c.b));
          return `<tr><td>${profileLink(c.opp)}</td>${cell(c.a, edge === 'a')}${cell(c.b, edge === 'b')}</tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function render() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('matchup-content');
  const prompt = document.getElementById('matchup-prompt');
  if (!gamesLoaded) return;
  loading.style.display = 'none';
  document.getElementById('matchup-form').style.display = 'grid';

  const { a, b } = selected;
  const ready = a && b && a !== b;
  content.style.display = ready ? 'block' : 'none';
  prompt.style.display = ready ? 'none' : 'block';
  prompt.textContent = a && a === b ? 'Pick two different players.' : 'Pick two players to see how they stack up.';
  document.getElementById('player-title').textContent = ready ? `${a} vs ${b}` : 'Match Up';
  if (!ready) return;

  const A = playerSummary(a);
  const B = playerSummary(b);
  const { against, together } = gamesBetween(a, b);
  renderOdds(A, B);
  renderTape(A, B);
  renderHeadToHead(A, B, against);
  renderPartners(A, B, together);
  renderCommon(A, B);
  document.getElementById('log-matchup').href =
    `log-game.html?format=Singles&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
}

// Rebuilt on every data refresh (cache paint, then fresh), so it re-applies
// the current selection rather than resetting it. Archived players stay
// pickable in their own group — old rivalries are still worth looking up.
function renderPickers() {
  const byName = (x, y) => x.Name.localeCompare(y.Name);
  const active = roster.filter((p) => !p.Archived).sort(byName);
  const archived = roster.filter((p) => p.Archived).sort(byName);
  const options = (list) => list.map((p) => `<option value="${esc(p.Name)}">${esc(p.Name)}</option>`).join('');
  const html = '<option value="">Choose a player</option>'
    + options(active)
    + (archived.length ? `<optgroup label="Archived">${options(archived)}</optgroup>` : '');

  ['a', 'b'].forEach((key) => {
    const el = document.getElementById(`pick-${key}`);
    el.innerHTML = html;
    // A name from the URL that isn't on the roster just leaves the picker empty.
    el.value = selected[key];
    selected[key] = el.value;
  });
}

function syncUrl() {
  const params = new URLSearchParams(window.location.search);
  ['a', 'b'].forEach((key) => {
    if (selected[key]) params.set(key, selected[key]);
    else params.delete(key);
  });
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

['a', 'b'].forEach((key) => {
  document.getElementById(`pick-${key}`).addEventListener('change', (e) => {
    selected[key] = e.target.value;
    syncUrl();
    render();
  });
});

document.getElementById('swap-btn').addEventListener('click', () => {
  [selected.a, selected.b] = [selected.b, selected.a];
  document.getElementById('pick-a').value = selected.a;
  document.getElementById('pick-b').value = selected.b;
  syncUrl();
  render();
});

async function loadMatchup() {
  const params = new URLSearchParams(window.location.search);
  selected.a = params.get('a') || '';
  selected.b = params.get('b') || '';

  const loading = document.getElementById('loading');
  let renderedFromCache = false;

  const dataPromise = apiGetCached('getLogGameData', null, (data, isCache) => {
    renderedFromCache = renderedFromCache || isCache;
    roster = data.players;
    games = data.games;
    gamesLoaded = true;
    renderPickers();
    render();
  }).catch((err) => {
    if (!renderedFromCache) {
      loading.className = 'status error';
      loading.textContent = 'Error loading players: ' + err.message;
    }
  });

  // Only adds rank/confidence/provisional — the page is fully usable without it.
  const leaderboardPromise = apiGetCached('getLeaderboard', null, (players) => {
    leaderboard = players;
    render();
  }).catch(() => {});

  await Promise.all([dataPromise, leaderboardPromise]);
}

loadMatchup();
