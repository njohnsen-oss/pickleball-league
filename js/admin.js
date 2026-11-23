// Admin Mode is remembered per browser for convenience, while Apps Script
// validates the passcode again for every write. Hiding controls is UX;
// server-side validation is the actual protection.

//
// Two levels: the admin passcode unlocks everything; the scorekeeper
// passcode (optional, Script Properties > SCORER_PASSCODE) only records
// results: Log Game, Live, and bracket scores. The page marks them with
//   .admin-only / .admin-only-section     admin
//   .staff-only / .staff-only-section     admin or scorekeeper
//   .locked-only / .staff-locked-only     shown until unlocked (as admin / as either)

const ADMIN_PASSCODE_STORAGE_KEY = 'pickleballAdminPasscode';
const ADMIN_ROLE_STORAGE_KEY = 'pickleballAdminRole';
const ADMIN_MODE_EVENT = 'adminmodechange';

// 'admin', 'scorer' or ''. A browser unlocked before scorekeepers existed
// has no role saved; it was unlocked with the admin code.
function unlockedRole() {
  if (!localStorage.getItem(ADMIN_PASSCODE_STORAGE_KEY)) return '';
  return localStorage.getItem(ADMIN_ROLE_STORAGE_KEY) === 'scorer' ? 'scorer' : 'admin';
}

function isAdminUnlocked() {
  return unlockedRole() === 'admin';
}

function isStaffUnlocked() {
  return unlockedRole() !== '';
}

function ensurePasscodeModal() {
  let overlay = document.getElementById('passcode-modal-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'passcode-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="passcode-modal-title">
      <div class="modal-kicker">League management</div>
      <h2 id="passcode-modal-title">Unlock</h2>
      <p class="field-help">Enter the admin passcode, or the scorekeeper passcode to record games. This browser stays unlocked until you lock it again.</p>
      <label for="passcode-modal-input">Passcode</label>
      <input type="password" id="passcode-modal-input" autocomplete="current-password" />
      <div id="passcode-modal-status" class="status" style="display:none"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="passcode-modal-ok">Unlock</button>
        <button type="button" class="btn secondary" id="passcode-modal-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function promptForPasscode() {
  return new Promise((resolve) => {
    const overlay = ensurePasscodeModal();
    const input = overlay.querySelector('#passcode-modal-input');
    const okBtn = overlay.querySelector('#passcode-modal-ok');
    const cancelBtn = overlay.querySelector('#passcode-modal-cancel');
    const statusEl = overlay.querySelector('#passcode-modal-status');

    input.value = '';
    statusEl.style.display = 'none';
    overlay.style.display = 'flex';
    input.focus();

    function cleanup(result) {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onOk() {
      const value = input.value.trim();
      if (!value) {
        statusEl.className = 'status error';
        statusEl.textContent = 'Enter a passcode.';
        statusEl.style.display = 'block';
        return;
      }
      cleanup(value);
    }
    function onCancel() { cleanup(''); }
    function onKeydown(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

// Returns the role the passcode unlocks ('admin' or 'scorer').
async function verifyAdminPasscode(passcode) {
  const res = await apiPost('verifyAdmin', { passcode });
  return res && res.role === 'scorer' ? 'scorer' : 'admin';
}

function rememberPasscode(passcode, role) {
  localStorage.setItem(ADMIN_PASSCODE_STORAGE_KEY, passcode);
  localStorage.setItem(ADMIN_ROLE_STORAGE_KEY, role);
}

function applyAdminMode() {
  const role = unlockedRole();
  const unlocked = role === 'admin';
  document.body.classList.toggle('admin-unlocked', unlocked);
  document.body.classList.toggle('staff-unlocked', role !== '');
  document.body.classList.toggle('scorer-unlocked', role === 'scorer');

  const toggle = document.getElementById('admin-mode-toggle');
  if (toggle) {
    const label = role === 'scorer' ? 'Scorer' : 'Admin';
    toggle.classList.toggle('unlocked', role !== '');
    toggle.title = role ? `Lock (${label})` : 'Unlock';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.innerHTML = `<span class="admin-lock-icon">${role ? '🔓' : '🔒'}</span><span class="admin-lock-label">${label}</span>`;
  }

  window.dispatchEvent(new CustomEvent(ADMIN_MODE_EVENT, { detail: { unlocked, role } }));
}

async function unlockAdminMode() {
  const passcode = await promptForPasscode();
  if (!passcode) return '';
  try {
    const role = await verifyAdminPasscode(passcode);
    rememberPasscode(passcode, role);
    applyAdminMode();
    return passcode;
  } catch (err) {
    clearStoredPasscode();
    window.alert('Could not unlock: ' + err.message);
    return '';
  }
}

async function getOrPromptPasscode() {
  const stored = localStorage.getItem(ADMIN_PASSCODE_STORAGE_KEY);
  if (stored) return stored;
  return unlockAdminMode();
}

function clearStoredPasscode() {
  localStorage.removeItem(ADMIN_PASSCODE_STORAGE_KEY);
  localStorage.removeItem(ADMIN_ROLE_STORAGE_KEY);
  applyAdminMode();
}

function buildAdminChrome() {
  document.querySelectorAll('nav.tab-bar a[href="log-game.html"], nav.tab-bar a[href="live-game.html"]').forEach((link) => link.classList.add('admin-nav-item'));

  const header = document.querySelector('header.top-bar');
  if (!header || document.getElementById('admin-mode-toggle')) return;

  const existingSettings = document.getElementById('settings-btn');
  const actions = document.createElement('div');
  actions.className = 'header-actions';
  if (existingSettings) {
    existingSettings.classList.add('admin-settings-link');
    actions.appendChild(existingSettings);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'admin-mode-toggle';
  toggle.className = 'admin-mode-toggle';
  toggle.addEventListener('click', async () => {
    if (isStaffUnlocked()) clearStoredPasscode();
    else await unlockAdminMode();
  });
  actions.appendChild(toggle);
  header.appendChild(actions);
  applyAdminMode();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildAdminChrome);
else buildAdminChrome();
