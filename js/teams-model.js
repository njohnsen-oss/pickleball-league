/* Set teams: the numbers for pairs who play together. No page code here, so
   the Teams page and the live scorer share it and it's tested in Node.

   A pair's games are every doubles game where the two were on the same side,
   whenever it was played (a team made today starts with its whole history).

   Team rating answers "how strong is this pair together?" on the same scale
   as the league rating. It's the rating at which the pair's expected results
   against the teams they actually faced (each opponent pair = the average of
   its two league ratings) match their real results, with bigger wins counting
   a little more, the same weights as the league rating. Until a pair has a
   few games together it leans on the average of the two players' own
   ratings, worth TEAM_PRIOR_GAMES games. */

const TEAM_SUGGEST_MIN_GAMES = 5; // pairs with this many games together are suggested as teams
const TEAM_PROVISIONAL_GAMES = 8; // fewer games together than this shows a P
const TEAM_PRIOR_GAMES = 3;
const TEAM_START_RATING = 1000; // for a player the leaderboard doesn't list (archived)
const TEAM_ELO_PER_LOGIT = 400 / Math.log(10);

function teamKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

// Same as Code.gs scoreEvidenceWeight: each point past a 2-point margin adds 4%, up to 28%.
function teamGameWeight(ours, theirs) {
  const extra = Math.max(Math.abs(ours - theirs) - 2, 0);
  return Math.min(1.28, 1 + extra * 0.04);
}

/* { 'A|B': [{ gameId, date, won, ours, theirs, opponents }] } for every doubles
   pair, in the order the games come in (getGames sends newest first). */
function pairGames(games) {
  const out = {};
  (games || []).forEach((g) => {
    if (!/^d/i.test(String(g.Format || ''))) return;
    const a = [g.SideA_Player1, g.SideA_Player2];
    const b = [g.SideB_Player1, g.SideB_Player2];
    const sa = Number(g.ScoreA);
    const sb = Number(g.ScoreB);
    if (!Number.isFinite(sa) || !Number.isFinite(sb) || sa === sb) return;
    [[a, b, sa, sb], [b, a, sb, sa]].forEach(([us, them, ours, theirs]) => {
      if (!us[0] || !us[1]) return;
      const key = teamKey(us[0], us[1]);
      (out[key] = out[key] || []).push({ gameId: g.GameId, date: g.Date, won: ours > theirs, ours, theirs, opponents: them.filter(Boolean) });
    });
  });
  return out;
}

function fitTeamRating(list, ratingOf, prior) {
  const lambda = TEAM_PRIOR_GAMES * 0.25; // a game at even odds carries 0.25
  const opps = list.map((m) => (m.opponents.length ? m.opponents.reduce((s, n) => s + ratingOf(n), 0) / m.opponents.length : prior));
  let x = 0; // logits above the prior
  for (let i = 0; i < 40; i += 1) {
    let grad = -lambda * x;
    let hess = -lambda;
    list.forEach((m, j) => {
      const p = 1 / (1 + Math.exp(-(x + (prior - opps[j]) / TEAM_ELO_PER_LOGIT)));
      const w = teamGameWeight(m.ours, m.theirs);
      grad += w * ((m.won ? 1 : 0) - p);
      hess -= w * p * (1 - p);
    });
    const step = grad / hess;
    x -= step;
    if (Math.abs(step) < 1e-7) break;
  }
  return prior + x * TEAM_ELO_PER_LOGIT;
}

/* ratingOf(name) -> that player's league rating. */
function teamStats(p1, p2, list, ratingOf) {
  const games = (list || []).slice();
  const n = games.length;
  const wins = games.filter((m) => m.won).length;
  const prior = (ratingOf(p1) + ratingOf(p2)) / 2;
  let streak = 0;
  for (const m of games) {
    if (streak === 0) streak = m.won ? 1 : -1;
    else if ((streak > 0) === m.won) streak += m.won ? 1 : -1;
    else break;
  }
  return {
    games: n,
    wins,
    losses: n - wins,
    winPct: n ? wins / n : NaN,
    pointDiff: n ? games.reduce((s, m) => s + m.ours - m.theirs, 0) / n : NaN,
    rating: n ? fitTeamRating(games, ratingOf, prior) : prior,
    prior,
    provisional: n < TEAM_PROVISIONAL_GAMES,
    form: games.slice(0, 5).map((m) => m.won),
    streak,
    lastDate: n ? games[0].date : null,
  };
}

function ratingLookup(leaderboard) {
  const map = {};
  (leaderboard || []).forEach((p) => { map[p.Name] = Number(p.Elo); });
  return (name) => (Number.isFinite(map[name]) ? map[name] : TEAM_START_RATING);
}

/* Pairs with enough games together that aren't a team yet, both players
   still active, most games first. */
function suggestTeams(pairs, teams, activeNames) {
  const taken = new Set((teams || []).map((t) => teamKey(t.Player1, t.Player2)));
  const active = new Set(activeNames || []);
  return Object.keys(pairs)
    .filter((key) => pairs[key].length >= TEAM_SUGGEST_MIN_GAMES && !taken.has(key))
    .map((key) => {
      const [p1, p2] = key.split('|');
      const list = pairs[key];
      const wins = list.filter((m) => m.won).length;
      return { p1, p2, key, games: list.length, wins, losses: list.length - wins };
    })
    .filter((s) => active.has(s.p1) && active.has(s.p2))
    .sort((x, y) => y.games - x.games || (y.wins - y.losses) - (x.wins - x.losses));
}

/* Short names that stay unique: "Jared C." only when two players share "Jared". */
function shortNamer(allNames) {
  const firsts = {};
  (allNames || []).forEach((n) => { const f = String(n).trim().split(/\s+/)[0]; firsts[f] = (firsts[f] || 0) + 1; });
  return (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length > 1 && firsts[parts[0]] > 1) return `${parts[0]} ${parts[parts.length - 1][0]}.`;
    return parts[0] || '';
  };
}

function teamLabelFor(team, shortName) {
  if (team.Name) return team.Name;
  const s = shortName || ((n) => String(n).split(/\s+/)[0]);
  return `${s(team.Player1)} & ${s(team.Player2)}`;
}

/* The set team (if any) for two players on one side. */
function findSetTeam(teams, a, b) {
  if (!a || !b) return null;
  const key = teamKey(a, b);
  return (teams || []).find((t) => teamKey(t.Player1, t.Player2) === key) || null;
}

const TEAM_RANKINGS = {
  rating: {
    label: 'Team rating',
    unit: 'rating',
    explain: 'How strong the pair is together, judged by results against the teams they faced. Same scale as the player rating.',
    value: (s) => s.rating,
    format: (v) => String(Math.round(v)),
  },
  winpct: {
    label: 'Win %',
    unit: 'won',
    explain: 'Games won together out of games played together.',
    value: (s) => s.winPct,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  pointdiff: {
    label: '+/−',
    unit: 'per game',
    explain: 'Average point margin per game together: their points minus the other team’s.',
    value: (s) => s.pointDiff,
    format: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`,
  },
};

if (typeof module !== 'undefined') {
  module.exports = { TEAM_SUGGEST_MIN_GAMES, TEAM_PROVISIONAL_GAMES, TEAM_RANKINGS, teamKey, pairGames, teamStats, fitTeamRating, ratingLookup, suggestTeams, shortNamer, teamLabelFor, findSetTeam };
}
