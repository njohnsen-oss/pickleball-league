/* Ways to rank the Leaderboard. Each method is one entry: a label for the
   switch, a short unit for the cards, a plain-language explanation, and a
   value(player, ctx) to sort by (higher is better). Adding a method is adding
   an entry; nothing else in the page needs to know about it.

   Doubles in every method: a team is the average of its two players
   (League rating and DUPR est.), and both partners get the team's result
   (Win %) and the team's point margin (Point diff). To weigh partners
   differently, change the team average in Code.gs (fitGlobalRatings) and in
   js/dupr-style.js, and the per-game credit in pointDiffByPlayer below. */

const RANKING_METHODS = {
  league: {
    label: 'Rating',
    unit: 'rating',
    explain: 'The league rating: every game in the history at once, team = average of the two players, bigger wins count a little more.',
    value: (p) => Number(p.Elo),
    format: (v) => String(Math.round(v)),
  },
  dupr: {
    label: 'DUPR est.',
    unit: 'DUPR',
    explain: 'An estimate on the 2.0 to 8.0 DUPR scale, from points scored versus the expected score.',
    value: (p, ctx) => (ctx.dupr ? ctx.dupr.ratings[p.Name] : NaN),
    format: (v) => v.toFixed(2),
  },
  winpct: {
    label: 'Win %',
    unit: 'won',
    explain: 'Games won out of games played. Simple, but it ignores who you played and who you played with.',
    value: (p) => (Number(p.GamesPlayed) > 0 ? Number(p.Wins) / Number(p.GamesPlayed) : NaN),
    format: (v) => `${Math.round(v * 100)}%`,
  },
  pointdiff: {
    label: '+/−',
    unit: 'per game',
    explain: 'Average point margin per game: your team’s points minus the other team’s. A close loss costs little; a blowout counts.',
    value: (p, ctx) => (ctx.pointDiff[p.Name] ? ctx.pointDiff[p.Name].avg : NaN),
    format: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`,
  },
};

const RANKING_DEFAULT = 'league';

/* Average point margin per game for every player, from getGames rows. */
function pointDiffByPlayer(games) {
  const out = {};
  (games || []).forEach((g) => {
    const a = [g.SideA_Player1, g.SideA_Player2].filter(Boolean);
    const b = [g.SideB_Player1, g.SideB_Player2].filter(Boolean);
    const margin = Number(g.ScoreA) - Number(g.ScoreB);
    if (!Number.isFinite(margin)) return;
    a.forEach((n) => { out[n] = out[n] || { games: 0, total: 0 }; out[n].games += 1; out[n].total += margin; });
    b.forEach((n) => { out[n] = out[n] || { games: 0, total: 0 }; out[n].games += 1; out[n].total -= margin; });
  });
  Object.keys(out).forEach((n) => { out[n].avg = out[n].total / out[n].games; });
  return out;
}

/* Everything the methods need, worked out once per render.
   anchor = { player, rating } from the league settings, or null. */
function rankingContext(players, games, anchor) {
  const dupr = typeof duprStyleRatings === 'function'
    ? duprStyleRatings(players, games, anchor && anchor.player ? { ANCHOR: { player: anchor.player, rating: anchor.rating } } : undefined)
    : null;
  return { dupr, pointDiff: pointDiffByPlayer(games) };
}

/* Players sorted by a method, best first; players without a value go last. */
function sortByRanking(methodKey, players, ctx) {
  const method = RANKING_METHODS[methodKey] || RANKING_METHODS[RANKING_DEFAULT];
  const val = (p) => {
    const v = method.value(p, ctx);
    return Number.isFinite(v) ? v : -Infinity;
  };
  return players.slice().sort((x, y) => val(y) - val(x));
}

if (typeof module !== 'undefined') module.exports = { RANKING_METHODS, RANKING_DEFAULT, pointDiffByPlayer, rankingContext, sortByRanking };
