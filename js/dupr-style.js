/* DUPR-style rating estimate.
   DUPR (USA Pickleball's official rating since 2026) keeps its exact formula
   private, but publishes how it behaves, and this follows that behaviour:
     - ratings sit on a 2.0-8.0 scale;
     - a doubles team's rating is the average of its two players;
     - every game has an expected score from the two team ratings;
     - you move on points scored versus that expectation, so a close loss to
       a stronger team helps and a narrow win over a weaker one doesn't;
     - recent games count more, and players with few games are held near the
       middle until there's enough evidence.
   Rather than nudging ratings game by game, it finds the ratings that best
   explain every point in the league history at once, so the result doesn't
   depend on the order games were logged and can be rebuilt any time.

   It is an estimate from league games only, not an official DUPR. ANCHOR
   decides where the scale sits: until a league player has a real DUPR, the
   league average is placed at ANCHOR.leagueAverage (a placeholder). Once
   someone has one, set ANCHOR.player and ANCHOR.rating and everyone else is
   lined up relative to that player. */

const DUPR_STYLE = {
  // A 0.5 gap expects about 11-5, matching DUPR's own example
  // (a 3.5 against a 4.0 is expected to lose about 5-11).
  SCALE: 0.5 / Math.log10(11 / 5),
  // How hard thin records are pulled toward the middle (roughly: it takes
  // about five games for a player's own results to outweigh it).
  PRIOR: 12,
  // A game this many days older than the newest one counts half as much.
  HALF_LIFE_DAYS: 180,
  ANCHOR: { player: '', rating: null, leagueAverage: 3.5 },
  MIN: 2,
  MAX: 8,
  ITERATIONS: 60,
};

function duprStyleSides(game) {
  const a = [game.SideA_Player1, game.SideA_Player2].filter(Boolean);
  const b = [game.SideB_Player1, game.SideB_Player2].filter(Boolean);
  return [a, b];
}

/* players: leaderboard rows ({ Name, Archived }), games: getGames rows.
   Returns { ratings: { name: number }, anchored: bool, anchorText }. */
function duprStyleRatings(players, games, options) {
  const opts = Object.assign({}, DUPR_STYLE, options || {});
  const anchor = Object.assign({}, DUPR_STYLE.ANCHOR, (options && options.ANCHOR) || {});
  const k = Math.LN10 / opts.SCALE;
  const usable = (games || []).filter((g) => {
    const [a, b] = duprStyleSides(g);
    const pts = Number(g.ScoreA) + Number(g.ScoreB);
    return a.length && b.length && a.length === b.length && pts > 0;
  });

  const names = new Set((players || []).map((p) => p.Name));
  usable.forEach((g) => duprStyleSides(g).flat().forEach((n) => names.add(n)));
  const skill = {};
  names.forEach((n) => { skill[n] = 0; });

  const newest = usable.reduce((t, g) => Math.max(t, new Date(g.Date).getTime() || 0), 0);
  const rows = usable.map((g) => {
    const [a, b] = duprStyleSides(g);
    const ageDays = newest ? Math.max(0, (newest - (new Date(g.Date).getTime() || newest)) / 86400000) : 0;
    return { a, b, ptsA: Number(g.ScoreA), ptsB: Number(g.ScoreB), w: Math.pow(0.5, ageDays / opts.HALF_LIFE_DAYS) };
  });

  // Diagonal Newton steps on the points likelihood plus the pull to the middle.
  for (let it = 0; it < opts.ITERATIONS; it += 1) {
    const grad = {}; const hess = {};
    names.forEach((n) => { grad[n] = -opts.PRIOR * skill[n]; hess[n] = opts.PRIOR; });
    rows.forEach((r) => {
      const ra = r.a.reduce((s, n) => s + skill[n], 0) / r.a.length;
      const rb = r.b.reduce((s, n) => s + skill[n], 0) / r.b.length;
      const p = 1 / (1 + Math.exp(-k * (ra - rb)));
      const total = r.ptsA + r.ptsB;
      const resid = r.w * (r.ptsA - total * p) * k;
      const info = r.w * total * k * k * p * (1 - p);
      r.a.forEach((n) => { grad[n] += resid / r.a.length; hess[n] += info / (r.a.length * r.a.length); });
      r.b.forEach((n) => { grad[n] -= resid / r.b.length; hess[n] += info / (r.b.length * r.b.length); });
    });
    names.forEach((n) => { skill[n] += grad[n] / hess[n]; });
  }

  const anchorKnown = anchor.player && skill[anchor.player] !== undefined && Number.isFinite(Number(anchor.rating));
  let offset;
  let anchorText;
  if (anchorKnown) {
    offset = Number(anchor.rating) - skill[anchor.player];
    anchorText = `Lined up to ${anchor.player}'s real DUPR (${Number(anchor.rating).toFixed(2)}).`;
  } else {
    const active = (players || []).filter((p) => !p.Archived && skill[p.Name] !== undefined).map((p) => skill[p.Name]);
    const mean = active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0;
    offset = anchor.leagueAverage - mean;
    anchorText = `Placeholder scale: the league average is set to ${anchor.leagueAverage.toFixed(2)} until a player's real DUPR is added.`;
  }

  const ratings = {};
  names.forEach((n) => { ratings[n] = Math.min(opts.MAX, Math.max(opts.MIN, skill[n] + offset)); });
  return { ratings, anchored: Boolean(anchorKnown), anchorText };
}

function formatDuprStyle(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '–';
}

if (typeof module !== 'undefined') module.exports = { DUPR_STYLE, duprStyleRatings, formatDuprStyle };
