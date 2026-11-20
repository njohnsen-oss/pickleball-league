// Drawing helpers shared by the Live Game scorer (live-game.js) and the TV /
// spectator view (live-view.js): names, the pickleball, the court diagram,
// confetti, the share link and its QR code. No state and no network here.

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
        + (serving ? '<g class="live-svg-ball" transform="translate(15 -14)">' + pickleballSvg({ x: -8, y: -8, size: 16, simple: true }) + '</g>' : '')
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

// ---------- the pickleball ----------
//
// One drawing for every ball in the app (icons, the court, the TV, the
// animations): a neon outdoor-style ball with 26 holes spread evenly over a
// sphere. Holes are projected from 3D, so ones near the edge foreshorten into
// thin ellipses and the ball can genuinely spin or roll by changing rx/ry/rz.
// Light comes from the upper left for the holes (dark inner wall at top-left,
// bright lip at bottom-right) with a soft highlight on the upper right.

const PB_HOLES = (() => {
  const n = 26, pts = [], golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }
  return pts;
})();

function pbRotate(p, ax, ay, az) {
  let [x, y, z] = p;
  let c = Math.cos(ax), s = Math.sin(ax); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay); s = Math.sin(ay); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az); s = Math.sin(az); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

let pbUid = 0;

// The ball as inline SVG markup (viewBox 0 0 100 100). opts:
//   size       width/height attribute (omit to size it with CSS)
//   x, y       position when nesting inside another SVG (e.g. the court)
//   rx, ry, rz extra rotation in radians, for spinning/rolling it in animations
//   simple     slightly bigger holes so tiny icons still read as a pickleball
//   className  extra class on the <svg>
// The holes sit in <g class="pb-holes"> under fixed shading, so CSS can spin
// that group while the light stays put.
function pickleballSvg(opts = {}) {
  const id = 'pb' + (pbUid += 1);
  const R = 48, C = 50;
  const holeAng = opts.simple ? 0.2 : 0.165;
  const pts = PB_HOLES;
  const o = opts.base || [0.4, 1.1, 0.2];
  const rx = (opts.rx || 0) + o[0], ry = (opts.ry || 0) + o[1], rz = (opts.rz || 0) + o[2];
  let halos = '', lips = '', holes = '';
  const f = (v) => v.toFixed(2);
  pts.forEach((p0) => {
    const [x, y, z] = pbRotate(p0, rx, ry, rz);
    if (z < 0.12) return; // back of the ball, or too edge-on to see
    const cx = C + R * x, cy = C - R * y;
    const major = R * Math.sin(holeAng);
    const minor = major * z;
    const deg = (Math.atan2(-y, x) * 180) / Math.PI + 90; // minor axis points at the center
    const arc = (dx, dy, k = 1) => {
      const a = (deg * Math.PI) / 180, ex = Math.cos(a) * major * k, ey = Math.sin(a) * major * k;
      const X = cx + dx, Y = cy + dy;
      return `M${f(X + ex)} ${f(Y + ey)}A${f(major * k)} ${f(minor * k)} ${f(deg)} 1 0 ${f(X - ex)} ${f(Y - ey)}A${f(major * k)} ${f(minor * k)} ${f(deg)} 1 0 ${f(X + ex)} ${f(Y + ey)}Z`;
    };
    if (z > 0.35) {
      // Countersink: a soft shadow on the upper-left rim, a bright lip on the lower-right rim.
      halos += arc(-major * 0.07 * z, -major * 0.07 * z, 1.12);
      lips += arc(major * 0.08 * z, major * 0.09 * z, 1.07);
    }
    holes += arc(0, 0);
  });
  const size = (opts.size ? ` width="${opts.size}" height="${opts.size}"` : '')
    + (opts.x != null ? ` x="${opts.x}" y="${opts.y}"` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="pb-ball${opts.className ? ' ' + opts.className : ''}" viewBox="0 0 100 100"${size} aria-hidden="true">`
    + '<defs>'
    + `<radialGradient id="${id}b" cx="0.62" cy="0.3" r="0.85"><stop offset="0" stop-color="#EEEC4E"/><stop offset="0.6" stop-color="#E2E43C"/><stop offset="0.9" stop-color="#D3D736"/><stop offset="1" stop-color="#ADB228"/></radialGradient>`
    + `<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5D610B"/><stop offset="0.6" stop-color="#7C8116"/><stop offset="1" stop-color="#ABAF2D"/></linearGradient>`
    + `<radialGradient id="${id}s" cx="0.5" cy="0.5" r="0.5"><stop offset="0.8" stop-color="#464A00" stop-opacity="0"/><stop offset="1" stop-color="#464A00" stop-opacity="0.3"/></radialGradient>`
    + `<radialGradient id="${id}g" cx="0.7" cy="0.24" r="0.24"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.15"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`
    + '</defs>'
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}b)"/>`
    + `<g class="pb-holes"><path d="${halos}" fill="#959A1E" fill-opacity="0.45"/><path d="${lips}" fill="#F7F48C" fill-opacity="0.75"/><path d="${holes}" fill="url(#${id}h)"/></g>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}s)"/>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}g)"/>`
    + '</svg>';
}
// The CSS ball icon (.live-ball-icon) reads this, so badges and buttons use
// the same drawing without a separate image file.
function pickleballDataUri() {
  return 'url("data:image/svg+xml,' + encodeURIComponent(pickleballSvg({ simple: true })) + '")';
}
if (typeof document !== 'undefined') document.documentElement.style.setProperty('--pb-ball', pickleballDataUri());

// ---------- fault animation (on the court) ----------
//
// Drawn inside the court diagram (top-down), so height is shown the classic
// way: the ball grows a little and its shadow slides away the higher it is.
// The ball leaves the server toward the receiver, stops dead at the net, the
// court shakes (~200ms), the ball drops on its own side on a heavy curve,
// takes two dead bounces and rolls to whoever serves next, where the normal
// serving ball takes over. It never blocks taps: the next render of the court
// replaces it, and it's skipped when the device asks for reduced motion.

function cancelFaultAnimation(courtHost) {
  if (!courtHost) return;
  courtHost.querySelectorAll('.fx-fault').forEach((el) => el.remove());
  const svg = courtHost.querySelector('.live-court-svg');
  if (svg) svg.classList.remove('fx-hide-ball');
}

// prev / next: replayLiveGame states before and after the fault.
// opts: { shakeEl, speed (1 = TV timing), shake (px of the strongest shake step) }
function playFaultAnimation(courtHost, prev, next, opts = {}) {
  const svg = courtHost && courtHost.querySelector('.live-court-svg');
  if (!svg || !svg.animate || !prev || !next) return;
  cancelFaultAnimation(courtHost);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'fx-fault');
  g.innerHTML = '<ellipse class="fx-shadow" cx="0" cy="0" rx="7" ry="4"></ellipse>'
    + '<g class="fx-ball"><g class="fx-ball-spin">' + pickleballSvg({ x: -8, y: -8, size: 16, simple: true }) + '</g></g>';
  svg.appendChild(g);
  svg.classList.add('fx-hide-ball');

  // Where things are, in court units (viewBox 340 x 180; net at x = 170).
  const ballSpot = (state) => { const [x, y] = COURT_SPOTS[state.servingSide][state.serveCourt]; return [x + 15, y - 14]; };
  const [sx, sy] = ballSpot(prev);
  const [rx, ry] = COURT_SPOTS[prev.receivingSide][prev.serveCourt];
  const dir = prev.servingSide === 'A' ? 1 : -1;
  const nx = 170 - dir * 9; // ball's edge meets the net
  const ny = sy + (ry - sy) * ((nx - sx) / (rx - sx || 1));
  const [ex, ey] = ballSpot(next);
  const b1 = [nx - dir * 5, ny + 2], b2 = [nx - dir * 8, ny + 3];

  // Path points: [time 0..1, x, y, height, easing into the next point]
  const H = 9;
  const pts = [
    [0, sx, sy, H * 0.7, 'linear'],
    [0.22, nx, ny, H, 'cubic-bezier(0.55, 0, 1, 0.45)'], // dead stop at the net, then gravity
    [0.4, nx - dir * 2, ny + 1, 0, 'cubic-bezier(0, 0.55, 0.45, 1)'],
    [0.48, (nx - dir * 2 + b1[0]) / 2, b1[1], 3.2, 'cubic-bezier(0.55, 0, 1, 0.45)'],
    [0.56, b1[0], b1[1], 0, 'cubic-bezier(0, 0.55, 0.45, 1)'],
    [0.61, (b1[0] + b2[0]) / 2, b2[1], 1.1, 'cubic-bezier(0.55, 0, 1, 0.45)'],
    [0.66, b2[0], b2[1], 0, 'cubic-bezier(0.25, 0.6, 0.35, 1)'],
    [1, ex, ey, 0, 'linear'],
  ];
  const T = Math.round(1150 * (opts.speed || 1));
  const f = (v) => v.toFixed(2);
  g.querySelector('.fx-ball').animate(pts.map(([t, x, y, h, easing]) => ({
    offset: t, easing, transform: `translate(${f(x - h * 0.35)}px, ${f(y - h * 0.55)}px) scale(${f(1 + h * 0.035)})`,
  })), { duration: T, fill: 'forwards' });
  g.querySelector('.fx-shadow').animate(pts.map(([t, x, y, h, easing]) => ({
    offset: t, easing, opacity: Math.max(0.15, 0.55 - h * 0.04), transform: `translate(${f(x + h * 0.25)}px, ${f(y + 7 + h * 0.2)}px) scale(${f(1 - h * 0.03)})`,
  })), { duration: T, fill: 'forwards' });
  // Roll: spin by distance travelled along the ground.
  const rollDist = Math.hypot(ex - b2[0], ey - b2[1]);
  const spin = Math.sign(ex - b2[0] || 1) * (rollDist / 8) * (180 / Math.PI);
  g.querySelector('.fx-ball-spin').animate([
    { offset: 0, transform: 'rotate(0deg)' }, { offset: 0.22, transform: `rotate(${dir * 240}deg)` },
    { offset: 0.66, transform: `rotate(${dir * 240}deg)`, easing: 'cubic-bezier(0.25, 0.6, 0.35, 1)' },
    { offset: 1, transform: `rotate(${dir * 240 + spin}deg)` },
  ], { duration: T, fill: 'forwards' });

  // Impact: the net flashes and the court shakes.
  const impact = T * 0.22;
  const net = svg.querySelector('.live-court-net');
  const px = opts.shake || 4;
  const shakeEl = opts.shakeEl || courtHost;
  setTimeout(() => {
    if (!g.isConnected) return;
    if (net && net.animate) net.animate([{ stroke: '#FFFFFF', strokeWidth: 7 }, { stroke: '#F7F9FF', strokeWidth: 4 }], { duration: 260, easing: 'ease-out' });
    const k = (n) => f(n * px / 4) + 'px';
    shakeEl.animate([
      { transform: 'translate(0, 0)' },
      { transform: `translate(${k(-4)}, ${k(1)})`, offset: 0.15 },
      { transform: `translate(${k(4)}, ${k(-2)})`, offset: 0.3 },
      { transform: `translate(${k(-3)}, ${k(2)})`, offset: 0.45 },
      { transform: `translate(${k(2)}, ${k(-1)})`, offset: 0.6 },
      { transform: `translate(${k(-1)}, 0)`, offset: 0.8 },
      { transform: 'translate(0, 0)' },
    ], { duration: 200, easing: 'ease-out' });
  }, impact);

  // Hand over to the normal serving ball.
  setTimeout(() => {
    if (!g.isConnected) return;
    svg.classList.remove('fx-hide-ball');
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).onfinish = () => g.remove();
  }, T);
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
