/* Brackets: the rules, with no page code, so the Brackets page, the live
   scorer and the TV share them and they're tested in Node.

   A bracket is one plain object (stored as JSON in the Sheet's Brackets tab):
     { v, name, format: 'single' | 'roundrobin', target, bestOf, finalBestOf,
       counts, seeding, status: 'active' | 'done', createdAt,
       entrants: [{ id, seed, players: [p1, p2], teamId, name, color, rating }],
       matches:  [{ id, round, slot, a, b, bestOf, games: [{ a, b, gameId, requestId, at }],
                    winner: 'a' | 'b' | null, next, nextSide, bye }] }
   `a` / `b` on a match are entrant ids (null = not decided yet, or a bye).
   Single elimination: the bracket is padded to a power of two, byes go to
   the top seeds, and seeds meet the usual way (1 v 8, 4 v 5, 2 v 7, 3 v 6),
   so 1 and 2 can only meet in the final. Round robin: everyone plays
   everyone once (a match can be a best of 3); standings rank by match wins,
   then head-to-head between two tied entrants, then point margin. */

const BRACKET_MAX_SINGLE = 32;
const BRACKET_MAX_ROUND_ROBIN = 12;

function bracketWinsNeeded(bestOf) {
  return Math.floor((Number(bestOf) || 1) / 2) + 1;
}

/* 1 v 8, 4 v 5, 2 v 7, 3 v 6 ... for a bracket of `size` (a power of two). */
function bracketSeedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.reduce((out, s) => out.concat([s, n + 1 - s]), []);
  }
  return order;
}

function bracketRoundName(bracket, round) {
  if (bracket.format === 'roundrobin') return `Round ${round}`;
  const rounds = Math.max(...bracket.matches.map((m) => m.round));
  const left = rounds - round;
  if (left === 0) return 'Final';
  if (left === 1) return 'Semifinals';
  if (left === 2) return 'Quarterfinals';
  return `Round ${round}`;
}

function newBracketBase(opts, entrants) {
  return {
    v: 1,
    name: String(opts.name || '').trim(),
    format: opts.format,
    target: [11, 15, 21].includes(Number(opts.target)) ? Number(opts.target) : 11,
    bestOf: Number(opts.bestOf) === 3 ? 3 : 1,
    finalBestOf: Number(opts.finalBestOf) === 3 ? 3 : (Number(opts.bestOf) === 3 ? 3 : 1),
    counts: opts.counts !== false,
    seeding: opts.seeding === 'random' ? 'random' : 'rating',
    status: 'active',
    createdAt: opts.createdAt || new Date().toISOString(),
    entrants: entrants.map((e, i) => ({
      id: 'e' + (i + 1),
      seed: i + 1,
      players: e.players.slice(0, 2),
      teamId: e.teamId || '',
      name: e.name || '',
      color: e.color || '',
      rating: Number.isFinite(e.rating) ? Math.round(e.rating) : null,
    })),
    matches: [],
  };
}

function checkEntrants(entrants, max) {
  if (!Array.isArray(entrants) || entrants.length < 2) throw new Error('A bracket needs at least 2 teams');
  if (entrants.length > max) throw new Error(`This format takes up to ${max} teams`);
  const seen = new Set();
  entrants.forEach((e) => {
    if (!e.players || e.players.length !== 2 || !e.players[0] || !e.players[1] || e.players[0] === e.players[1]) throw new Error('Each team needs two different players');
    e.players.forEach((p) => {
      if (seen.has(p)) throw new Error(`${p} is on two teams in this bracket`);
      seen.add(p);
    });
  });
}

/* entrants arrive in seed order (best first). */
function createSingleElimination(opts, entrants) {
  checkEntrants(entrants, BRACKET_MAX_SINGLE);
  const b = newBracketBase({ ...opts, format: 'single' }, entrants);
  let size = 2;
  while (size < entrants.length) size *= 2;
  const rounds = Math.log2(size);
  const bySeed = {};
  b.entrants.forEach((e) => { bySeed[e.seed] = e.id; });
  const order = bracketSeedOrder(size);
  let id = 0;
  const byRound = [];
  for (let r = 1; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    byRound[r] = [];
    for (let s = 0; s < count; s += 1) {
      id += 1;
      const m = { id: 'm' + id, round: r, slot: s, a: null, b: null, bestOf: r === rounds ? b.finalBestOf : b.bestOf, games: [], winner: null, next: null, nextSide: null, bye: false };
      if (r === 1) {
        m.a = bySeed[order[s * 2]] || null;
        m.b = bySeed[order[s * 2 + 1]] || null;
      }
      byRound[r].push(m);
      b.matches.push(m);
    }
  }
  for (let r = 1; r < rounds; r += 1) {
    byRound[r].forEach((m, s) => { m.next = byRound[r + 1][Math.floor(s / 2)].id; m.nextSide = s % 2 === 0 ? 'a' : 'b'; });
  }
  // Byes: the top seed walks through to round 2.
  byRound[1].forEach((m) => {
    if (m.a && !m.b) { m.bye = true; m.winner = 'a'; advance(b, m); }
    else if (!m.a && m.b) { m.bye = true; m.winner = 'b'; advance(b, m); }
  });
  return b;
}

/* Circle method: every entrant plays every other once. Odd counts give one
   entrant a rest each round. */
function createRoundRobin(opts, entrants) {
  checkEntrants(entrants, BRACKET_MAX_ROUND_ROBIN);
  const b = newBracketBase({ ...opts, format: 'roundrobin' }, entrants);
  b.finalBestOf = b.bestOf;
  const ids = b.entrants.map((e) => e.id);
  if (ids.length % 2) ids.push(null);
  const n = ids.length;
  let ring = ids.slice();
  let id = 0;
  for (let r = 1; r < n; r += 1) {
    let slot = 0;
    for (let i = 0; i < n / 2; i += 1) {
      const x = ring[i];
      const y = ring[n - 1 - i];
      if (!x || !y) continue;
      id += 1;
      // Alternate who is Side A so nobody is always on the same side.
      const flip = (r + i) % 2 === 1;
      b.matches.push({ id: 'm' + id, round: r, slot, a: flip ? y : x, b: flip ? x : y, bestOf: b.bestOf, games: [], winner: null, next: null, nextSide: null, bye: false });
      slot += 1;
    }
    ring = [ring[0], ring[n - 1]].concat(ring.slice(1, n - 1));
  }
  return b;
}

function createBracketFrom(opts, entrants) {
  return opts.format === 'roundrobin' ? createRoundRobin(opts, entrants) : createSingleElimination(opts, entrants);
}

function bracketMatch(bracket, matchId) {
  const m = bracket.matches.find((x) => x.id === matchId);
  if (!m) throw new Error('That match isn’t in this bracket');
  return m;
}

function bracketEntrant(bracket, id) {
  return bracket.entrants.find((e) => e.id === id) || null;
}

function seriesScore(match) {
  return match.games.reduce((s, g) => { if (g.a > g.b) s.a += 1; else s.b += 1; return s; }, { a: 0, b: 0 });
}

function matchReady(match) {
  return Boolean(match.a && match.b && !match.winner);
}

function advance(bracket, match) {
  if (!match.next) return;
  const next = bracketMatch(bracket, match.next);
  next[match.nextSide] = match.winner === 'a' ? match.a : match.b;
}

function updateStatus(bracket) {
  bracket.status = bracket.matches.every((m) => m.winner) ? 'done' : 'active';
}

/* A finished game to `target`, win by 2 (12-10, 13-11 past the target). */
function checkGameScore(a, b, target) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) throw new Error('Scores must be whole numbers');
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  if (hi < target || hi - lo < 2 || (hi > target && hi - lo !== 2)) throw new Error(`That isn’t a finished game to ${target} (win by 2)`);
  return { a: x, b: y };
}

/* Adds one game to a match; when a side reaches the wins it needs, the match
   is decided and the winner moves on. A game already recorded (same
   requestId) is ignored, so a retry can't count a game twice. */
function applyBracketGame(bracket, matchId, game) {
  const m = bracketMatch(bracket, matchId);
  if (game.requestId && m.games.some((g) => g.requestId === game.requestId)) return { duplicate: true, match: m };
  if (!matchReady(m)) throw new Error(m.winner ? 'That match is already decided' : 'That match is still waiting on an earlier result');
  const score = checkGameScore(game.a, game.b, bracket.target);
  m.games.push({ a: score.a, b: score.b, gameId: game.gameId || '', requestId: game.requestId || '', at: game.at || new Date().toISOString() });
  const s = seriesScore(m);
  const need = bracketWinsNeeded(m.bestOf);
  if (s.a >= need || s.b >= need) {
    m.winner = s.a >= need ? 'a' : 'b';
    advance(bracket, m);
  }
  updateStatus(bracket);
  return { duplicate: false, match: m, decided: Boolean(m.winner) };
}

/* Takes back a match's last game. Not allowed once the match it fed has
   started (undo that one first). Returns the removed game. */
function undoBracketGame(bracket, matchId) {
  const m = bracketMatch(bracket, matchId);
  if (!m.games.length) throw new Error('That match has no games to undo');
  if (m.winner && m.next) {
    const next = bracketMatch(bracket, m.next);
    if (next.games.length) throw new Error('The next match has already started. Undo that one first.');
    next[m.nextSide] = null;
  }
  const removed = m.games.pop();
  m.winner = null;
  updateStatus(bracket);
  return removed;
}

/* Which side of a bracket match a lineup is: lets the live scorer save a game
   even if the teams were swapped before serving. */
function bracketSideOf(bracket, match, players) {
  const key = (ps) => ps.slice().sort().join('|');
  const ea = bracketEntrant(bracket, match.a);
  const eb = bracketEntrant(bracket, match.b);
  if (ea && key(ea.players) === key(players)) return 'a';
  if (eb && key(eb.players) === key(players)) return 'b';
  return '';
}

/* Matches that can be played now, earliest round first. */
function upNext(bracket) {
  return bracket.matches.filter(matchReady).sort((x, y) => x.round - y.round || x.slot - y.slot);
}

function champion(bracket) {
  if (bracket.status !== 'done') return null;
  if (bracket.format === 'single') {
    const final = bracket.matches.reduce((f, m) => (m.round > f.round ? m : f), bracket.matches[0]);
    return bracketEntrant(bracket, final.winner === 'a' ? final.a : final.b);
  }
  const table = roundRobinStandings(bracket);
  return table.length ? bracketEntrant(bracket, table[0].id) : null;
}

function roundRobinStandings(bracket) {
  const rows = {};
  bracket.entrants.forEach((e) => { rows[e.id] = { id: e.id, seed: e.seed, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const h2h = {};
  bracket.matches.forEach((m) => {
    m.games.forEach((g) => {
      if (rows[m.a]) { rows[m.a].pointsFor += g.a; rows[m.a].pointsAgainst += g.b; rows[m.a][g.a > g.b ? 'gamesWon' : 'gamesLost'] += 1; }
      if (rows[m.b]) { rows[m.b].pointsFor += g.b; rows[m.b].pointsAgainst += g.a; rows[m.b][g.b > g.a ? 'gamesWon' : 'gamesLost'] += 1; }
    });
    if (!m.winner) return;
    const w = m.winner === 'a' ? m.a : m.b;
    const l = m.winner === 'a' ? m.b : m.a;
    rows[w].played += 1; rows[w].wins += 1;
    rows[l].played += 1; rows[l].losses += 1;
    h2h[w + '>' + l] = true;
  });
  const list = Object.values(rows).map((r) => ({ ...r, diff: r.pointsFor - r.pointsAgainst }));
  list.sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    const tied = list.filter((r) => r.wins === x.wins);
    if (tied.length === 2) {
      if (h2h[x.id + '>' + y.id]) return -1;
      if (h2h[y.id + '>' + x.id]) return 1;
    }
    return (y.diff - x.diff) || (y.pointsFor - x.pointsFor) || (x.seed - y.seed);
  });
  return list;
}

/* "Dink Dynasty" for a named set team, else "Jon & Noah". */
function entrantLabel(entrant, shortName) {
  if (!entrant) return 'TBD';
  if (entrant.name) return entrant.name;
  const s = shortName || ((n) => String(n).split(/\s+/)[0]);
  return `${s(entrant.players[0])} & ${s(entrant.players[1])}`;
}

if (typeof module !== 'undefined') {
  module.exports = {
    BRACKET_MAX_SINGLE, BRACKET_MAX_ROUND_ROBIN, bracketSeedOrder, bracketWinsNeeded, bracketRoundName,
    createSingleElimination, createRoundRobin, createBracketFrom, bracketMatch, bracketEntrant, seriesScore,
    matchReady, applyBracketGame, undoBracketGame, bracketSideOf, upNext, champion, roundRobinStandings,
    checkGameScore, entrantLabel,
  };
}
