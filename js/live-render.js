// Drawing helpers shared by the Live Game scorer (live-game.js) and the TV /
// spectator view (live-view.js): names, the court diagram, confetti, the
// share link and its QR code. No state and no network here.

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function firstName(name) {
  return String(name || '').split(' ')[0];
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase();
}

function sideNames(setup, side, joiner = ' & ') {
  return (side === 'A' ? setup.sideA : setup.sideB).map(firstName).join(joiner);
}

// Court drawn sideways: Side A on the left facing the net, Side B on the right.
// Facing the net, A's right-hand court is the bottom half and B's is the top
// half, so a serve always crosses the court diagonally.
const COURT_SPOTS = { A: { right: [70, 124], left: [70, 56] }, B: { right: [270, 56], left: [270, 124] } };

function courtSvg(state) {
  const c = state.courts;
  const s = state.servingSide;
  const r = state.receivingSide;
  const from = COURT_SPOTS[s][state.serveCourt];
  const to = COURT_SPOTS[r][state.serveCourt];
  const dir = Math.sign(to[0] - from[0]);
  const x1 = from[0] + dir * 22, x2 = to[0] - dir * 24;
  const slope = (to[1] - from[1]) / (to[0] - from[0]);
  const y1 = from[1] + slope * (x1 - from[0]), y2 = from[1] + slope * (x2 - from[0]);

  let players = '';
  ['A', 'B'].forEach((side) => {
    ['right', 'left'].forEach((court) => {
      const name = c[side][court];
      if (!name) return;
      const [x, y] = COURT_SPOTS[side][court];
      const serving = side === s && name === state.server;
      players += `<g class="live-player side-${side.toLowerCase()}${serving ? ' serving' : ''}" transform="translate(${x} ${y})">`
        + `<circle r="17"></circle><text class="live-player-initials" y="4.5">${escapeHtml(initials(name))}</text>`
        + `<text class="live-player-name" y="31">${escapeHtml(firstName(name))}</text>`
        + (serving ? '<g class="live-svg-ball" transform="translate(15 -14)"><circle r="6.5"></circle><circle class="hole" cx="-2" cy="-1.6" r="1.1"></circle><circle class="hole" cx="2.2" cy="-0.6" r="1.1"></circle><circle class="hole" cx="-0.4" cy="2.4" r="1.1"></circle></g>' : '')
        + '</g>';
    });
  });

  return `<svg class="live-court-svg" viewBox="0 0 340 180" role="img" aria-label="${escapeHtml(firstName(state.server))} serving to ${state.serveCourt} court">`
    + '<defs><marker id="live-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#FCB92E"></path></marker></defs>'
    + '<rect class="live-court-surround" x="0" y="0" width="340" height="180" rx="16"></rect>'
    + '<rect class="live-court-surface" x="20" y="15" width="300" height="150"></rect>'
    + '<rect class="live-court-kitchen" x="122" y="15" width="96" height="150"></rect>'
    + '<g class="live-court-lines"><rect x="20" y="15" width="300" height="150"></rect><line x1="122" y1="15" x2="122" y2="165"></line><line x1="218" y1="15" x2="218" y2="165"></line><line x1="20" y1="90" x2="122" y2="90"></line><line x1="218" y1="90" x2="320" y2="90"></line></g>'
    + '<line class="live-court-net" x1="170" y1="7" x2="170" y2="173"></line><circle class="live-court-post" cx="170" cy="7" r="4"></circle><circle class="live-court-post" cx="170" cy="173" r="4"></circle>'
    + `<line class="live-serve-path" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#live-arrow)"></line>`
    + players
    + '</svg>';
}

// What one rally did, for the scorer's Undo label and the TV's rally feed.
function liveRallyKind(rally, nextServingSide, doubles) {
  if (rally.result === 'Point') return 'point';
  if (nextServingSide && nextServingSide !== rally.servingSide) return 'sideout';
  return doubles ? 'second' : 'sideout';
}

function fireConfetti(canvas, count = 90) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canvas || reduced || !canvas.getContext) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#FCB92E', '#3158CF', '#FE5500', '#B6C7FF', '#FFFFFF', '#FE8C00'];
  const speed = Math.max(1, rect.width / 360);
  const bits = Array.from({ length: count }, (_, i) => {
    const a = Math.random() * Math.PI - Math.PI; // upward fan
    const sp = (4 + Math.random() * 7) * speed;
    return { x: rect.width / 2, y: rect.height * 0.55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, w: (5 + Math.random() * 6) * speed, h: (3 + Math.random() * 4) * speed, c: colors[i % colors.length], life: 70 + Math.random() * 50 };
  });
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, rect.width, rect.height);
    let alive = 0;
    bits.forEach((b) => {
      if (frame > b.life) return;
      alive += 1;
      b.vy += 0.22 * speed; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.globalAlpha = Math.max(0, 1 - frame / b.life);
      ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    });
    frame += 1;
    if (alive) requestAnimationFrame(tick); else ctx.clearRect(0, 0, rect.width, rect.height);
  })();
}

// The public TV / spectator link. It carries the data source in ?api= so a
// TV or phone that has never opened the app goes straight to the game
// instead of the first-run settings page.
function liveViewUrl() {
  const url = new URL('live-view.html', window.location.href);
  if (typeof APPS_SCRIPT_URL !== 'undefined' && APPS_SCRIPT_URL) url.searchParams.set('api', APPS_SCRIPT_URL);
  return url.toString();
}

// QR code as an inline SVG (js/vendor/qrcode.min.js). Returns '' if the
// library didn't load, so callers can just hide the box.
function qrSvg(text, dark = '#0E125B', light = '#FFFFFF') {
  if (typeof qrcode !== 'function') return '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = 2; // quiet zone, in modules
    let d = '';
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
      }
    }
    const size = n + m * 2;
    return `<svg class="qr-svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for the live game link">`
      + `<rect width="${size}" height="${size}" fill="${light}"></rect><path d="${d}" fill="${dark}"></path></svg>`;
  } catch (err) {
    return '';
  }
}
