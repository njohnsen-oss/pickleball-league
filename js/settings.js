// Tests a candidate URL directly (not via api.js's apiGet, which is bound
// to the already-saved APPS_SCRIPT_URL) so Save can verify what's actually
// typed in the box before/while persisting it.
async function testConnection(url) {
  let testUrl;
  try {
    testUrl = new URL(url);
  } catch (err) {
    throw new Error('That doesn\'t look like a valid URL.');
  }
  testUrl.searchParams.set('action', 'getSetupStatus');
  testUrl.searchParams.set('_', Date.now()); // defeat caching on this fixed-looking URL

  let res;
  try {
    res = await fetch(testUrl.toString(), { cache: 'no-store' });
  } catch (err) {
    throw new Error('Could not reach that URL. Check it\'s correct and your connection is working.');
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      'That URL didn\'t return valid data — confirm it\'s the Apps Script Web App URL ending in "/exec", and that the deployment\'s access is set to "Anyone".'
    );
  }

  if (data && data.error) throw new Error(data.error);
  return data;
}

// POSTs to a candidate URL directly, same reasoning as testConnection()
// above — this runs before/while the URL is persisted, so it can't go
// through api.js's apiPost (bound to the already-saved APPS_SCRIPT_URL).
async function postToUrl(url, action, payload) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (err) {
    throw new Error('Could not reach that URL. Check it\'s correct and your connection is working.');
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('That URL didn\'t return valid data.');
  }

  if (data && data.error) throw new Error(data.error);
  return data;
}

function getReturnTo() {
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');
  return returnTo || null;
}

function refreshPasscodeStatus() {
  const statusEl = document.getElementById('passcode-status');
  statusEl.textContent = localStorage.getItem(ADMIN_PASSCODE_STORAGE_KEY)
    ? 'Currently remembered in this browser.'
    : 'Not set in this browser.';
}

window.addEventListener(ADMIN_MODE_EVENT, refreshPasscodeStatus);

// ---- DUPR estimate anchor (league-wide, stored next to the league name) ----

async function loadDuprAnchor() {
  if (!APPS_SCRIPT_URL) return;
  const select = document.getElementById('dupr-anchor-player');
  const rating = document.getElementById('dupr-anchor-rating');
  if (!select) return;
  try {
    const [players, settings] = await Promise.all([apiGet('getLeaderboard'), apiGet('getLeagueName')]);
    const anchor = settings && settings.duprAnchor;
    const names = (players || []).filter((p) => !p.Archived).map((p) => p.Name).sort();
    select.innerHTML = '<option value="">Nobody yet (league average shows as 3.50)</option>'
      + names.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">${n.replace(/</g, '&lt;')}</option>`).join('');
    if (anchor) { select.value = anchor.player; rating.value = Number(anchor.rating).toFixed(3); }
  } catch (err) {
    // Non-fatal: the fields just stay empty.
  }
}

async function saveDuprAnchor(clear) {
  const statusEl = document.getElementById('dupr-anchor-status');
  const player = clear ? '' : document.getElementById('dupr-anchor-player').value;
  const rating = clear ? '' : document.getElementById('dupr-anchor-rating').value;
  statusEl.style.display = 'block';
  if (!clear && (!player || !(Number(rating) >= 2 && Number(rating) <= 8))) {
    statusEl.className = 'status error';
    statusEl.textContent = 'Pick a player and enter a DUPR between 2.000 and 8.000.';
    return;
  }
  const passcode = await getOrPromptPasscode();
  if (!passcode) return;
  statusEl.className = 'status';
  statusEl.textContent = 'Saving…';
  try {
    await apiPost('setDuprAnchor', { passcode, player, rating: Number(rating) });
    invalidateAllCache();
    statusEl.className = 'status success';
    statusEl.textContent = clear
      ? 'Cleared. The estimate is back to the placeholder scale (league average 3.50).'
      : `Saved. Every DUPR est. now lines up to ${player}'s ${Number(rating).toFixed(3)}.`;
    if (clear) { document.getElementById('dupr-anchor-player').value = ''; document.getElementById('dupr-anchor-rating').value = ''; }
  } catch (err) {
    statusEl.className = 'status error';
    statusEl.textContent = /Unknown action/i.test(err.message)
      ? 'The league backend needs the Phase 3 update before this can be saved.'
      : 'Could not save: ' + err.message;
  }
}

async function loadLeagueName() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const data = await apiGet('getLeagueName');
    if (data && data.name) document.getElementById('league-name-input').value = data.name;
  } catch (err) {
    // Non-fatal — field just stays on its placeholder.
  }
}

function initSettingsPage() {
  const apiUrlInput = document.getElementById('api-url');
  const apiStatus = document.getElementById('api-status');
  const welcomeNote = document.getElementById('welcome-note');
  const continueRow = document.getElementById('continue-row');
  const continueLink = document.getElementById('continue-link');
  const fixSetupBtn = document.getElementById('fix-setup-btn');

  apiUrlInput.value = APPS_SCRIPT_URL || '';
  if (!APPS_SCRIPT_URL) welcomeNote.style.display = 'block';

  const returnTo = getReturnTo();
  if (returnTo) continueLink.href = returnTo;

  async function checkConnection(url, prefix) {
    const lead = prefix ? prefix + ' ' : '';
    fixSetupBtn.style.display = 'none';
    try {
      const status = await testConnection(url);
      apiStatus.className = 'status success';
      apiStatus.textContent = `${lead}Connected! Found ${status.playerCount} player(s) and ${status.gameCount} game(s).`;
      welcomeNote.style.display = 'none';
      if (returnTo) continueRow.style.display = 'block';
    } catch (err) {
      apiStatus.className = 'status error';
      apiStatus.textContent = `${lead}Saved, but couldn't connect: ` + err.message;
      // Only a Sheet-shape problem is worth offering to auto-fix — a wrong
      // URL, unreachable deployment, etc. would just fail the same way again.
      if (/tab/i.test(err.message)) fixSetupBtn.style.display = 'block';
    }
  }

  document.getElementById('save-api-btn').addEventListener('click', async () => {
    const url = apiUrlInput.value.trim();
    apiStatus.style.display = 'block';
    continueRow.style.display = 'none';

    if (!url) {
      apiStatus.className = 'status error';
      apiStatus.textContent = 'Paste a URL first.';
      return;
    }

    apiStatus.className = 'status';
    apiStatus.textContent = 'Saving and testing connection…';

    localStorage.setItem(API_STORAGE_KEY, url);
    const params = new URLSearchParams(window.location.search);
    params.set('api', url);
    params.delete('returnTo');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    await checkConnection(url);
  });

  fixSetupBtn.addEventListener('click', async () => {
    const url = apiUrlInput.value.trim();
    if (!url) return;

    fixSetupBtn.disabled = true;
    apiStatus.className = 'status';
    apiStatus.textContent = 'Fixing Sheet setup…';

    let fixMessage;
    try {
      const passcode = localStorage.getItem(ADMIN_PASSCODE_STORAGE_KEY) || await promptForPasscode();
      const result = await postToUrl(url, 'setupSheet', { passcode });
      fixMessage = result.fixed.join(' ');
    } catch (err) {
      fixMessage = 'Couldn\'t auto-fix: ' + err.message;
    }
    fixSetupBtn.disabled = false;

    await checkConnection(url, fixMessage);
  });

  document.getElementById('clear-api-btn').addEventListener('click', resetApiUrl);

  refreshPasscodeStatus();

  document.getElementById('save-passcode-btn').addEventListener('click', async () => {
    const value = document.getElementById('passcode-input').value.trim();
    if (!value) return;
    const statusEl = document.getElementById('passcode-status');
    statusEl.textContent = 'Checking passcode…';
    try {
      await verifyAdminPasscode(value);
      localStorage.setItem(ADMIN_PASSCODE_STORAGE_KEY, value);
      document.getElementById('passcode-input').value = '';
      applyAdminMode();
      refreshPasscodeStatus();
    } catch (err) {
      statusEl.textContent = 'Could not unlock: ' + err.message;
    }
  });

  document.getElementById('forget-passcode-btn').addEventListener('click', () => {
    clearStoredPasscode();
    document.getElementById('passcode-input').value = '';
    refreshPasscodeStatus();
  });

  document.getElementById('recompute-btn').addEventListener('click', async () => {
    const btn = document.getElementById('recompute-btn');
    const statusEl = document.getElementById('recompute-status');
    const passcode = await getOrPromptPasscode();
    if (!passcode) return;

    statusEl.style.display = 'block';
    statusEl.className = 'status';
    statusEl.textContent = 'Recalculating the full league…';
    btn.disabled = true;
    try {
      const result = await apiPost('recomputeRatings', { passcode });
      invalidateAllCache();
      const confidence = result.calibration ? result.calibration.LeagueConfidence : null;
      statusEl.className = 'status success';
      statusEl.textContent = confidence === null
        ? 'Ratings recalculated.'
        : `Ratings recalculated. League confidence is now ${confidence}%.`;
    } catch (err) {
      if (/passcode/i.test(err.message)) clearStoredPasscode();
      statusEl.className = 'status error';
      statusEl.textContent = 'Error: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  loadLeagueName();
  loadDuprAnchor();
  document.getElementById('save-dupr-anchor-btn').addEventListener('click', () => saveDuprAnchor(false));
  document.getElementById('clear-dupr-anchor-btn').addEventListener('click', () => saveDuprAnchor(true));

  document.getElementById('save-league-name-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('league-name-input');
    const statusEl = document.getElementById('league-name-status');
    const name = nameInput.value.trim();

    statusEl.style.display = 'block';
    if (!name) {
      statusEl.className = 'status error';
      statusEl.textContent = 'Enter a name first.';
      return;
    }

    const passcode = await getOrPromptPasscode();
    if (!passcode) return;

    statusEl.className = 'status';
    statusEl.textContent = 'Saving…';

    try {
      await apiPost('setLeagueName', { passcode, name });
      invalidateAllCache();
      const banner = document.getElementById('league-banner');
      if (banner) banner.textContent = name;
      statusEl.className = 'status success';
      statusEl.textContent = 'Saved.';
    } catch (err) {
      if (/passcode/i.test(err.message)) clearStoredPasscode();
      statusEl.className = 'status error';
      statusEl.textContent = 'Error: ' + err.message;
    }
  });
}

initSettingsPage();
