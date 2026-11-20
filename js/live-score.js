// Live Game rules engine: pure functions, no DOM, no storage.
//
// Traditional side-out scoring: only the serving side scores, game to
// `setup.target` (11 by default), win by 2.
//
// The event list is the ONLY state. Everything the scorer shows (score,
// server, server number, who stands where, the call, the per-rally log the
// backend stores) is rebuilt by replaying it, so Undo is just events.pop().
// Don't add mutable score/server state alongside it.
//
// setup = {
//   format: 'Singles' | 'Doubles',
//   sideA: [name] | [rightCourtName, leftCourtName],   // a1 starts in the right court
//   sideB: [name] | [rightCourtName, leftCourtName],   // b1 starts in the right court
//   firstServingSide: 'A' | 'B',
//   target: 11,
//   startedAt: epoch ms,
// }
// events = [{ result: 'Point' | 'Fault', at: epoch ms }, ...]
//   'Point' = the serving side won the rally, 'Fault' = the serving side lost it.

const LIVE_DEFAULT_TARGET = 11;

function liveOtherSide(side) {
  return side === 'A' ? 'B' : 'A';
}

function liveTeam(setup, side) {
  return side === 'A' ? setup.sideA : setup.sideB;
}

// Who is standing in which service court. In doubles, the player who started
// in the right court is back in the right court whenever their team's score
// is even: partners only switch after their own side scores, and every point
// flips the parity. In singles the server serves from the right on an even
// score, and the receiver lines up diagonally, so both sit on the same side.
function liveCourts(setup, scores, servingSide) {
  if (setup.format !== 'Doubles') {
    const right = scores[servingSide] % 2 === 0;
    return {
      A: right ? { right: setup.sideA[0], left: null } : { right: null, left: setup.sideA[0] },
      B: right ? { right: setup.sideB[0], left: null } : { right: null, left: setup.sideB[0] },
    };
  }
  const courts = {};
  ['A', 'B'].forEach((side) => {
    const team = liveTeam(setup, side);
    const even = scores[side] % 2 === 0;
    courts[side] = even ? { right: team[0], left: team[1] } : { right: team[1], left: team[0] };
  });
  return courts;
}

function liveIsOver(scores, target) {
  const high = Math.max(scores.A, scores.B);
  return high >= target && Math.abs(scores.A - scores.B) >= 2;
}

function replayLiveGame(setup, events) {
  const doubles = setup.format === 'Doubles';
  const target = Number(setup.target) || LIVE_DEFAULT_TARGET;
  const scores = { A: 0, B: 0 };
  let servingSide = setup.firstServingSide === 'B' ? 'B' : 'A';
  // "0-0-2": the side that serves first only gets one server on its first turn.
  let serverNumber = doubles ? 2 : null;
  let server = liveTeam(setup, servingSide)[0];
  let lastElapsed = 0;
  const rallies = [];

  for (const ev of events) {
    if (liveIsOver(scores, target)) break; // taps after the end are ignored, never stored
    const elapsedSec = Math.max(lastElapsed, Math.round(((Number(ev.at) || 0) - (Number(setup.startedAt) || 0)) / 1000));
    lastElapsed = elapsedSec;
    const rally = { servingSide, server, serverNumber, result: ev.result === 'Point' ? 'Point' : 'Fault', elapsedSec };

    if (rally.result === 'Point') {
      scores[servingSide] += 1;
    } else if (doubles && serverNumber === 1) {
      serverNumber = 2;
      server = liveTeam(setup, servingSide).find((n) => n !== server);
    } else {
      servingSide = liveOtherSide(servingSide);
      serverNumber = doubles ? 1 : null;
      // The new server is whoever is in their side's right court right now.
      server = doubles ? liveCourts(setup, scores, servingSide)[servingSide].right : liveTeam(setup, servingSide)[0];
    }

    rally.scoreA = scores.A;
    rally.scoreB = scores.B;
    rallies.push(rally);
  }

  const over = liveIsOver(scores, target);
  const receivingSide = liveOtherSide(servingSide);
  const courts = liveCourts(setup, scores, servingSide);
  const serveCourt = courts[servingSide].right === server ? 'right' : 'left';
  const parts = [scores[servingSide], scores[receivingSide]];
  if (doubles) parts.push(serverNumber);

  return {
    target,
    doubles,
    scores,
    servingSide,
    receivingSide,
    server,
    serverNumber,
    serveCourt,
    courts,
    rallies,
    over,
    winner: over ? (scores.A > scores.B ? 'A' : 'B') : null,
    call: parts.join('-'),
    // The serving side wins the game if it wins this rally.
    gamePoint: !over && scores[servingSide] + 1 >= target && scores[servingSide] + 1 - scores[receivingSide] >= 2,
    elapsedSec: lastElapsed,
  };
}

// What a Point / Fault tap would do from here, for the button captions.
function liveNextOutcomes(setup, events) {
  const now = Date.now();
  const point = replayLiveGame(setup, events.concat([{ result: 'Point', at: now }]));
  const fault = replayLiveGame(setup, events.concat([{ result: 'Fault', at: now }]));
  const current = replayLiveGame(setup, events);
  return {
    point: { call: point.call, over: point.over },
    fault: {
      call: fault.call,
      sideOut: fault.servingSide !== current.servingSide,
      server: fault.server,
      serverNumber: fault.serverNumber,
    },
  };
}

// Post-game numbers for the summary card. Pure, derived from the rally log.
function summarizeLiveGame(setup, state) {
  const players = {};
  setup.sideA.concat(setup.sideB).forEach((name) => {
    players[name] = { serves: 0, servePoints: 0, side: setup.sideA.includes(name) ? 'A' : 'B' };
  });
  const longestRun = { A: 0, B: 0 };
  let runSide = null;
  let run = 0;
  let sideOuts = 0;

  state.rallies.forEach((r, i) => {
    const p = players[r.server];
    if (p) p.serves += 1;
    if (r.result === 'Point') {
      if (p) p.servePoints += 1;
      if (runSide === r.servingSide) run += 1; else { runSide = r.servingSide; run = 1; }
      longestRun[runSide] = Math.max(longestRun[runSide], run);
    } else {
      const next = state.rallies[i + 1];
      const changed = next ? next.servingSide !== r.servingSide : state.servingSide !== r.servingSide;
      if (changed) sideOuts += 1;
    }
  });

  return {
    rallyCount: state.rallies.length,
    durationSec: state.elapsedSec,
    sideOuts,
    longestRun,
    players,
  };
}

function formatLiveClock(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ---------- live win chance (TV display) ----------
//
// A small Markov model of side-out scoring: Side A wins any rally with the
// same probability x, whoever serves, and only the serving side scores. x is
// calibrated once per game so that A's chance from 0-0-2 equals the pregame
// Elo odds (setup.oddsA); with no odds x = 0.5 and the chance comes purely
// from the score and who's serving. It's a display nicety, not a rating.
//
// Deuce states repeat (10-10 plays exactly like 12-12), so scores where both
// sides have at least target-1 are shifted down to keep the table finite.

function liveWinSlot(doubles, servingSide, serverNumber) {
  if (!doubles) return servingSide === 'A' ? 0 : 2;
  return (servingSide === 'A' ? 0 : 2) + (serverNumber === 2 ? 1 : 0);
}

function liveWinTable(setup, x) {
  const target = Number(setup.target) || LIVE_DEFAULT_TARGET;
  const doubles = setup.format === 'Doubles';
  const N = target + 2;
  const V = new Float64Array(N * N * 4).fill(0.5);
  const value = (a, b, slot) => {
    if (a >= target && a - b >= 2) return 1;
    if (b >= target && b - a >= 2) return 0;
    if (a >= target - 1 && b >= target - 1) {
      const k = Math.min(a, b) - (target - 1);
      a -= k; b -= k;
    }
    return V[(a * N + b) * 4 + slot];
  };
  // slot: 0 = A 1st server, 1 = A 2nd server, 2 = B 1st, 3 = B 2nd (singles uses 0 and 2)
  const afterFault = doubles ? [1, 2, 3, 0] : [2, 2, 0, 0];
  const slots = doubles ? [0, 1, 2, 3] : [0, 2];
  for (let iter = 0; iter < 3000; iter += 1) {
    let delta = 0;
    for (let a = 0; a <= target; a += 1) {
      for (let b = 0; b <= target; b += 1) {
        if ((a >= target && a - b >= 2) || (b >= target && b - a >= 2)) continue;
        if (a >= target - 1 && b >= target - 1 && Math.min(a, b) !== target - 1) continue;
        for (const slot of slots) {
          const servingA = slot < 2;
          const pWin = servingA ? x : 1 - x;
          const onPoint = servingA ? value(a + 1, b, slot) : value(a, b + 1, slot);
          const v = pWin * onPoint + (1 - pWin) * value(a, b, afterFault[slot]);
          const i = (a * N + b) * 4 + slot;
          delta = Math.max(delta, Math.abs(v - V[i]));
          V[i] = v;
        }
      }
    }
    if (delta < 1e-9) break;
  }
  return value;
}

function liveWinModel(setup) {
  const doubles = setup.format === 'Doubles';
  const startSlot = liveWinSlot(doubles, setup.firstServingSide, doubles ? 2 : 1);
  const odds = typeof setup.oddsA === 'number' && setup.oddsA > 0.01 && setup.oddsA < 0.99 ? setup.oddsA : null;
  let x = 0.5;
  if (odds !== null) {
    let lo = 0.2, hi = 0.8;
    for (let i = 0; i < 22; i += 1) {
      x = (lo + hi) / 2;
      if (liveWinTable(setup, x)(0, 0, startSlot) < odds) lo = x; else hi = x;
    }
    x = (lo + hi) / 2;
  }
  const table = liveWinTable(setup, x);
  return {
    rallyOddsA: x,
    // Side A's chance (0..1) to win from a replayLiveGame state.
    chanceA(state) {
      if (state.over) return state.winner === 'A' ? 1 : 0;
      return table(state.scores.A, state.scores.B, liveWinSlot(state.doubles, state.servingSide, state.serverNumber));
    },
  };
}

// The current scoring run: consecutive points by one side with no point by
// the other in between (side-outs don't break a run).
function liveCurrentRun(state) {
  let side = null, run = 0;
  state.rallies.forEach((r) => {
    if (r.result !== 'Point') return;
    if (r.servingSide === side) run += 1; else { side = r.servingSide; run = 1; }
  });
  return { side, run };
}

// Lets the engine be unit-tested in Node without a browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { replayLiveGame, liveNextOutcomes, summarizeLiveGame, formatLiveClock, liveCourts, liveWinModel, liveCurrentRun, LIVE_DEFAULT_TARGET };
}
