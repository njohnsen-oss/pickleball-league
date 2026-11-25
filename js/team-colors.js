/* Team colors for the live scorer and TV.
   Each team picks a preset or a custom color before the game. A pick is
   refused when it would be hard to tell apart on court: too close to the
   other team, too close to the neon ball, or too dark against the navy
   court. The chosen pair rides inside the live game (setup.colors), so the
   TV shows the same colors with no extra request; a game without colors
   (older phones, older games) falls back to lime and cyan.

   The live pages read these CSS variables (set on <body>):
     --team-a / --team-b         the team color (fills, bars, borders)
     --team-a-ink / --team-b-ink text drawn on that color (navy or white)
     --team-a-text / --team-b-text the color as text on the navy page
     --team-a-soft / -glow       translucent versions for tiles and glows */

// Chrome Arena team palette (theme/tokens/tokens.json -> color.team). Team A
// defaults to lime, Team B to cyan; every one of these reads on the jet court.
const TEAM_COLOR_PRESETS = [
  { name: 'Lime', hex: '#C8FF2E' },
  { name: 'Cyan', hex: '#2EE6FF' },
  { name: 'Magenta', hex: '#FF3DA5' },
  { name: 'Orange', hex: '#FF7A1A' },
  { name: 'Royal', hex: '#5B8CFF' },
  { name: 'Gold', hex: '#F2C14E' },
  { name: 'Red', hex: '#FF4D5E' },
  { name: 'Chrome', hex: '#E6E9F0' },
];
const TEAM_COLOR_DEFAULTS = { A: '#C8FF2E', B: '#2EE6FF' };
const TEAM_COLOR_STORAGE_KEY = 'pickleballTeamColors';
// Distances are CIE Lab ΔE (about 2.3 = just noticeable); contrast is the
// WCAG ratio. Raise a number to make the rule stricter. The ball rule is off
// (0): in Chrome Arena the ball IS the lime team color, so the court ball
// carries a dark ring instead and reads on any team color.
const TEAM_COLOR_RULES = { minTeamGap: 30, minBallGap: 0, minCourtContrast: 2.2 };
const TEAM_COLOR_BALL = '#C8FF2E';
const TEAM_COLOR_COURT = '#2A2D35';
const TEAM_COLOR_NIGHT = '#0A0A0C';

function teamHexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function teamRgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function teamNormalizeHex(hex) {
  const rgb = teamHexToRgb(hex);
  return rgb ? teamRgbToHex(rgb) : null;
}

function teamLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function teamContrast(hexA, hexB) {
  const la = teamLuminance(teamHexToRgb(hexA));
  const lb = teamLuminance(teamHexToRgb(hexB));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function teamToLab(hex) {
  const lin = teamHexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function teamColorDistance(hexA, hexB) {
  const a = teamToLab(hexA);
  const b = teamToLab(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* Can `hex` be used by one team while the other team has `otherHex`?
   Returns { ok: true } or { ok: false, reason } with a short sentence. */
function checkTeamColor(hex, otherHex) {
  const color = teamNormalizeHex(hex);
  if (!color) return { ok: false, reason: 'That isn’t a color the app can read.' };
  if (teamColorDistance(color, TEAM_COLOR_BALL) < TEAM_COLOR_RULES.minBallGap) {
    return { ok: false, reason: 'Too close to the neon ball, it would disappear on court.' };
  }
  if (teamContrast(color, TEAM_COLOR_COURT) < TEAM_COLOR_RULES.minCourtContrast) {
    return { ok: false, reason: 'Too dark to see on the court.' };
  }
  const other = teamNormalizeHex(otherHex);
  if (other && teamColorDistance(color, other) < TEAM_COLOR_RULES.minTeamGap) {
    return { ok: false, reason: 'Too close to the other team’s color.' };
  }
  return { ok: true };
}

/* Any stored or received pair → a pair that passes the rules. */
function normalizeTeamColors(colors) {
  const a = teamNormalizeHex(colors && colors.A);
  const b = teamNormalizeHex(colors && colors.B);
  const okA = a && checkTeamColor(a, null).ok;
  const okB = b && checkTeamColor(b, null).ok;
  if (okA && okB && checkTeamColor(a, b).ok) return { A: a, B: b };
  return { ...TEAM_COLOR_DEFAULTS };
}

/* Text on a team-colored fill. White wherever it clears 3:1 (the text on
   these fills is bold and large: names, initials, Point), else navy. */
function teamInkFor(hex) {
  return teamContrast(hex, '#FFFFFF') >= 3 ? '#FFFFFF' : TEAM_COLOR_NIGHT;
}

/* The color itself when it reads as text on the navy page, else a lighter mix. */
function teamTextOnNight(hex) {
  const rgb = teamHexToRgb(hex);
  for (let t = 0; t <= 1.001; t += 0.1) {
    const mixed = teamRgbToHex(rgb.map((v) => v + (255 - v) * t));
    if (teamContrast(mixed, TEAM_COLOR_NIGHT) >= 4.5) return mixed;
  }
  return '#FFFFFF';
}

function teamRgba(hex, alpha) {
  const [r, g, b] = teamHexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function teamColorVars(colors) {
  const c = normalizeTeamColors(colors);
  const vars = {};
  [['a', c.A], ['b', c.B]].forEach(([k, hex]) => {
    vars[`--team-${k}`] = hex;
    vars[`--team-${k}-ink`] = teamInkFor(hex);
    vars[`--team-${k}-text`] = teamTextOnNight(hex);
    vars[`--team-${k}-soft`] = teamRgba(hex, 0.16);
    vars[`--team-${k}-glow`] = teamRgba(hex, 0.3);
    // Light colors glow brighter, so the TV team card tints them less.
    vars[`--team-${k}-card`] = teamRgba(hex, teamLuminance(teamHexToRgb(hex)) > 0.5 ? 0.2 : 0.32);
  });
  return vars;
}

function applyTeamColors(el, colors) {
  if (!el || !el.style) return;
  const vars = teamColorVars(colors);
  Object.keys(vars).forEach((k) => el.style.setProperty(k, vars[k]));
}

function teamColorName(hex) {
  const preset = TEAM_COLOR_PRESETS.find((p) => p.hex === teamNormalizeHex(hex));
  return preset ? preset.name : 'Custom';
}

/* Confetti in the winner's color, with the ball's neon and a little of the loser's. */
function teamConfettiPalette(colors, winner) {
  const c = normalizeTeamColors(colors);
  const w = winner === 'B' ? c.B : c.A;
  const l = winner === 'B' ? c.A : c.B;
  return [w, w, w, TEAM_COLOR_BALL, '#FFFFFF', l];
}

function loadLastTeamColors() {
  try { return normalizeTeamColors(JSON.parse(localStorage.getItem(TEAM_COLOR_STORAGE_KEY) || 'null')); } catch (e) { return { ...TEAM_COLOR_DEFAULTS }; }
}

function saveLastTeamColors(colors) {
  try { localStorage.setItem(TEAM_COLOR_STORAGE_KEY, JSON.stringify(normalizeTeamColors(colors))); } catch (e) { /* private mode: just don't remember */ }
}

if (typeof module !== 'undefined') {
  module.exports = {
    TEAM_COLOR_PRESETS, TEAM_COLOR_DEFAULTS, TEAM_COLOR_RULES, checkTeamColor, normalizeTeamColors,
    teamColorDistance, teamContrast, teamInkFor, teamTextOnNight, teamColorVars, teamConfettiPalette, teamColorName,
  };
}
