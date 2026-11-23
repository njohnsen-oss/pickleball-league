/* Matchmaking: turn the players who showed up into the next round of games.

   Each round:
     1. Sit-outs: if there are more players than court spots, whoever has sat
        out the fewest times tonight sits next; ties go to whoever has played
        the most games in a row, then to chance.
     2. Split: everyone left is split into games, trying many splits and
        keeping the one with the lowest cost. A game's cost is the gap
        between the two teams' average ratings plus penalties for partners
        and opponents who already met tonight (and, lightly, in recent weeks).
     3. Short of a full doubles game (2 or 3 players left on a court), the
        court plays singles.

   The modes only change the weights below, so a new way of balancing is a
   new entry in MATCHMAKING_MODES. Nothing here touches the page or storage. */

const MATCHMAKING_MODES = {
  balanced: {
    label: 'Balanced',
    explain: 'Closest ratings first, then new partners and opponents.',
    gap: 1, partnerTonight: 140, opponentTonight: 45, partnerRecent: 12, opponentRecent: 4, noise: 2,
  },
  random: {
    label: 'Random mix',
    explain: 'Any split, just avoiding repeats from tonight.',
    gap: 0, partnerTonight: 140, opponentTonight: 45, partnerRecent: 0, opponentRecent: 0, noise: 200,
  },
  rotate: {
    label: 'Rotate partners',
    explain: 'A new partner every round where possible, then balance.',
    gap: 0.35, partnerTonight: 600, opponentTonight: 60, partnerRecent: 10, opponentRecent: 3, noise: 2,
  },
};

const MATCHMAKING_TRIES = 600;

/* A tiny seeded random generator, so a round can be reproduced in tests. */
function mmRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mmPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/* How often each pair partnered / opposed, from a list of games shaped
   { a: [names], b: [names] }. */
function mmMeetings(games) {
  const partners = {};
  const opponents = {};
  (games || []).forEach((g) => {
    [g.a, g.b].forEach((team) => {
      for (let i = 0; i < team.length; i += 1) {
        for (let j = i + 1; j < team.length; j += 1) {
          const k = mmPairKey(team[i], team[j]);
          partners[k] = (partners[k] || 0) + 1;
        }
      }
    });
    g.a.forEach((x) => g.b.forEach((y) => {
      const k = mmPairKey(x, y);
      opponents[k] = (opponents[k] || 0) + 1;
    }));
  });
  return { partners, opponents };
}

function mmWinChance(a, b, ratings) {
  const avg = (team) => team.reduce((s, n) => s + (Number(ratings[n]) || 1000), 0) / team.length;
  return 1 / (1 + Math.pow(10, (avg(b) - avg(a)) / 400));
}

function mmGameCost(game, ctx, w) {
  const avg = (team) => team.reduce((s, n) => s + (Number(ctx.ratings[n]) || 1000), 0) / team.length;
  let cost = w.gap * Math.abs(avg(game.a) - avg(game.b));
  [game.a, game.b].forEach((team) => {
    for (let i = 0; i < team.length; i += 1) {
      for (let j = i + 1; j < team.length; j += 1) {
        const k = mmPairKey(team[i], team[j]);
        cost += w.partnerTonight * (ctx.tonight.partners[k] || 0) + w.partnerRecent * (ctx.recent.partners[k] || 0);
      }
    }
  });
  game.a.forEach((x) => game.b.forEach((y) => {
    const k = mmPairKey(x, y);
    cost += w.opponentTonight * (ctx.tonight.opponents[k] || 0) + w.opponentRecent * (ctx.recent.opponents[k] || 0);
  }));
  return cost;
}

/* Who sits out this round. `stats[name]` = { sat, streak } from earlier rounds. */
function mmChooseSitOuts(present, count, stats, rand) {
  if (count <= 0) return [];
  const order = present.slice().map((n) => ({ n, r: rand() }));
  order.sort((x, y) => {
    const sx = stats[x.n] || { sat: 0, streak: 0 };
    const sy = stats[y.n] || { sat: 0, streak: 0 };
    return (sx.sat - sy.sat) || (sy.streak - sx.streak) || (x.r - y.r);
  });
  return order.slice(0, count).map((o) => o.n);
}

/* Sit-out counts and current playing streaks from tonight's rounds. */
function mmRoundStats(present, rounds) {
  const stats = {};
  present.forEach((n) => { stats[n] = { sat: 0, streak: 0, played: 0 }; });
  (rounds || []).forEach((round) => {
    const playing = new Set();
    round.games.forEach((g) => g.a.concat(g.b).forEach((n) => playing.add(n)));
    present.forEach((n) => {
      if (playing.has(n)) { stats[n].played += 1; stats[n].streak += 1; }
      else if ((round.sitOut || []).includes(n)) { stats[n].sat += 1; stats[n].streak = 0; }
    });
  });
  return stats;
}

/* The next round.
   opts: { present: [names], ratings: {name: rating}, courts: n, format: 'Doubles'|'Singles',
           mode: key of MATCHMAKING_MODES, rounds: tonight's earlier rounds, recentGames: [{a, b}], seed }
   returns { games: [{ a, b, chanceA }], sitOut: [names] } */
function makeRound(opts) {
  const w = MATCHMAKING_MODES[opts.mode] || MATCHMAKING_MODES.balanced;
  const rand = mmRandom(opts.seed || Date.now());
  const present = Array.from(new Set(opts.present || []));
  const courts = Math.max(1, Math.floor(opts.courts || 1));
  const doubles = opts.format !== 'Singles';
  const perGame = doubles ? 4 : 2;
  if (present.length < 2) return { games: [], sitOut: present.slice() };

  // Fill as many courts as there are full games; a leftover 2 or 3 gets a
  // singles court if one is free, otherwise they sit.
  let fullGames = Math.min(courts, Math.floor(present.length / perGame));
  let singlesCourt = 0;
  if (doubles && fullGames < courts && present.length - fullGames * 4 >= 2) singlesCourt = 1;
  if (fullGames === 0 && !singlesCourt) return { games: [], sitOut: present.slice() };
  const spots = fullGames * perGame + singlesCourt * 2;

  const stats = mmRoundStats(present, opts.rounds);
  const sitOut = mmChooseSitOuts(present, present.length - spots, stats, rand);
  const playing = present.filter((n) => !sitOut.includes(n));

  const ctx = {
    ratings: opts.ratings || {},
    tonight: mmMeetings((opts.rounds || []).flatMap((r) => r.games)),
    recent: mmMeetings(opts.recentGames || []),
  };

  const split = (names) => {
    const games = [];
    let i = 0;
    for (let c = 0; c < fullGames; c += 1, i += perGame) {
      const g = names.slice(i, i + perGame);
      games.push(doubles ? { a: [g[0], g[1]], b: [g[2], g[3]] } : { a: [g[0]], b: [g[1]] });
    }
    if (singlesCourt) games.push({ a: [names[i]], b: [names[i + 1]] });
    return games;
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const costOf = (games) => games.reduce((s, g) => s + mmGameCost(g, ctx, w) + w.noise * rand(), 0);

  // Many random splits, each polished by trying every two-player swap.
  let best = null;
  const tries = Math.max(40, Math.round(MATCHMAKING_TRIES / Math.max(1, playing.length / 4)));
  for (let t = 0; t < tries; t += 1) {
    let order = shuffle(playing);
    let cost = costOf(split(order));
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length && !improved; i += 1) {
        for (let j = i + 1; j < order.length && !improved; j += 1) {
          const next = order.slice();
          [next[i], next[j]] = [next[j], next[i]];
          const c = costOf(split(next));
          if (c < cost - 1e-9) { order = next; cost = c; improved = true; }
        }
      }
    }
    if (!best || cost < best.cost) best = { order, cost };
  }

  const games = split(best.order).map((g) => ({ ...g, chanceA: mmWinChance(g.a, g.b, ctx.ratings) }));
  return { games, sitOut };
}

/* After a manual swap: recompute a game's odds. */
function mmRefreshGame(game, ratings) {
  return { ...game, chanceA: mmWinChance(game.a, game.b, ratings || {}) };
}

if (typeof module !== 'undefined') {
  module.exports = { MATCHMAKING_MODES, makeRound, mmMeetings, mmRoundStats, mmRefreshGame, mmWinChance };
}
