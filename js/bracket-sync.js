/* Saving a change to a bracket, shared by the Brackets page and the live
   scorer. Loads the latest copy (unless one is passed in), applies `change`
   (a function that edits the bracket and returns anything), and saves it
   with the version it was loaded at. If another phone saved in between, the
   backend refuses; this reloads and applies the change once more. Results
   carry their requestId, so applying the same game twice is a no-op. */

async function changeBracket(id, passcode, change, current) {
  let cur = current || await apiGet('getBracket', { id });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const copy = JSON.parse(JSON.stringify(cur.bracket));
    const result = change(copy);
    try {
      const saved = await apiPost('updateBracket', { passcode, id, version: cur.version, bracket: copy });
      return { ...saved, result };
    } catch (err) {
      if (attempt === 0 && /changed on another phone/i.test(err.message)) {
        cur = await apiGet('getBracket', { id });
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not save the bracket. Try again.');
}

/* Puts one finished game into a bracket match. `sideAPlayers` is whoever
   was on Side A in the scorer, so a swapped lineup still lands right. */
async function recordBracketGame({ id, matchId, passcode, sideAPlayers, scoreA, scoreB, gameId, requestId }) {
  return changeBracket(id, passcode, (br) => {
    const m = bracketMatch(br, matchId);
    const side = bracketSideOf(br, m, sideAPlayers);
    if (!side) throw new Error('These players aren’t the two teams in that bracket match');
    const g = side === 'a' ? { a: scoreA, b: scoreB } : { a: scoreB, b: scoreA };
    return applyBracketGame(br, matchId, { ...g, gameId, requestId });
  });
}

function bracketNewRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'bk-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

/* Link that opens the live scorer set up for one bracket game. */
function bracketLiveUrl(bracketId, bracket, match) {
  const a = bracketEntrant(bracket, match.a);
  const b = bracketEntrant(bracket, match.b);
  const q = new URLSearchParams({
    from: 'bracket', bracket: bracketId, match: match.id, format: 'Doubles', target: String(bracket.target),
    a: a.players[0], a2: a.players[1], b: b.players[0], b2: b.players[1],
  });
  return 'live-game.html?' + q.toString();
}
