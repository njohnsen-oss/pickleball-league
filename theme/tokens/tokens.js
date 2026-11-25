/* Pickleballers theme tokens — generated from tokens.json */
export const pb = {
  "meta": {
    "name": "Pickleballers Theme \u2014 Chrome Arena",
    "version": "1.0.0",
    "date": "2026-11-25",
    "logo": "Chrome Arena Crest (Spotlit)",
    "prefix": "--pb-"
  },
  "color": {
    "bg": {
      "value": "#0A0A0C",
      "use": "App/page background (jet)"
    },
    "bg-raised": {
      "value": "#121318",
      "use": "Top bars, tab bar, sheets"
    },
    "surface": {
      "value": "#1A1B20",
      "use": "Cards, list rows, panels"
    },
    "surface-2": {
      "value": "#23252B",
      "use": "Inputs, nested cards, hover (graphite)"
    },
    "surface-3": {
      "value": "#2E3038",
      "use": "Pressed / selected rows"
    },
    "border": {
      "value": "#2E3038",
      "use": "Hairlines, dividers"
    },
    "border-strong": {
      "value": "#6B7280",
      "use": "Input borders, focus-less outlines (steel)"
    },
    "chrome": {
      "value": "#D9DEE7",
      "use": "Chrome trim, icons, court lines, secondary emphasis"
    },
    "chrome-hi": {
      "value": "#FFFFFF",
      "use": "Chrome highlight stop"
    },
    "chrome-mid": {
      "value": "#C9CFDA",
      "use": "Chrome mid stop"
    },
    "chrome-lo": {
      "value": "#6B7385",
      "use": "Chrome shadow stop"
    },
    "chrome-edge": {
      "value": "#E6E9F0",
      "use": "Chrome bottom stop"
    },
    "text": {
      "value": "#F4F6FA",
      "use": "Primary text on dark"
    },
    "text-2": {
      "value": "#AEB6C6",
      "use": "Secondary text"
    },
    "text-3": {
      "value": "#8A92A3",
      "use": "Muted text, captions (min 12px)"
    },
    "text-on-lime": {
      "value": "#0A0A0C",
      "use": "Text/icons placed ON lime"
    },
    "lime": {
      "value": "#C8FF2E",
      "use": "THE accent: primary buttons, active states, the ball, wins, focus ring"
    },
    "lime-hi": {
      "value": "#F2FF9E",
      "use": "Ball highlight / hover tint"
    },
    "lime-deep": {
      "value": "#8AD400",
      "use": "Ball shading, pressed primary"
    },
    "lime-ink": {
      "value": "#3F7300",
      "use": "Lime-family text on LIGHT backgrounds only"
    },
    "court": {
      "value": "#2A2D35",
      "use": "Court surface"
    },
    "kitchen": {
      "value": "#363A44",
      "use": "Kitchen (non-volley zone)"
    },
    "court-line": {
      "value": "#D9DEE7",
      "use": "Court lines"
    },
    "danger": {
      "value": "#FF4D5E",
      "use": "Destructive actions, losses, LIVE dot"
    },
    "warning": {
      "value": "#FFB020",
      "use": "Warnings, pending"
    },
    "info": {
      "value": "#4FD8FF",
      "use": "Info, links on dark (alt)"
    },
    "success": {
      "value": "#C8FF2E",
      "use": "Same as lime"
    },
    "gold": {
      "value": "#F2C14E",
      "use": "Rank #1 medal ONLY"
    },
    "silver": {
      "value": "#C9CFDA",
      "use": "Rank #2 medal"
    },
    "bronze": {
      "value": "#C98A4B",
      "use": "Rank #3 medal"
    }
  },
  "team": {
    "_note": "Palette for the pre-game team color changer. Each works on the dark theme; text on these chips is --pb-text-on-lime (jet). Defaults: Team A = lime, Team B = cyan.",
    "lime": "#C8FF2E",
    "cyan": "#2EE6FF",
    "magenta": "#FF3DA5",
    "blaze": "#FF7A1A",
    "royal": "#5B8CFF",
    "gold": "#F2C14E",
    "crimson": "#FF4D5E",
    "chrome": "#E6E9F0"
  },
  "gradient": {
    "chrome": "linear-gradient(180deg, #FFFFFF 0%, #C9CFDA 46%, #6B7385 54%, #E6E9F0 100%)",
    "chrome-soft": "linear-gradient(180deg, #E6E9F0 0%, #AEB6C6 50%, #E6E9F0 100%)",
    "chrome-button": "linear-gradient(180deg, #FFFFFF 0%, #D9DEE7 48%, #AEB6C6 52%, #E6E9F0 100%)",
    "arena": "radial-gradient(120% 80% at 50% 0%, #1C1D22 0%, #0A0A0C 60%, #050506 100%)",
    "surface": "linear-gradient(180deg, #23252B 0%, #1A1B20 100%)",
    "lime-ball": "radial-gradient(circle at 36% 30%, #F7FFB8 0%, #D8FF3E 30%, #8AD400 76%, #4C8E00 100%)",
    "spotlight": "linear-gradient(180deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 100%)"
  },
  "font": {
    "display": {
      "value": "'Graduate', 'Rockwell', 'Georgia', serif",
      "use": "Headings, wordmark-style labels, scores, team names. Usually UPPERCASE, letter-spacing .02em"
    },
    "ui": {
      "value": "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      "use": "Everything else: body, buttons, inputs, lists"
    },
    "mono": {
      "value": "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      "use": "Codes / IDs only"
    }
  },
  "font-size": {
    "xs": "12px",
    "sm": "14px",
    "md": "16px",
    "lg": "18px",
    "xl": "22px",
    "2xl": "28px",
    "3xl": "36px",
    "4xl": "48px",
    "score": "clamp(64px, 18vw, 160px)"
  },
  "font-weight": {
    "regular": 400,
    "semibold": 600,
    "heavy": 800
  },
  "radius": {
    "xs": "6px",
    "sm": "8px",
    "md": "12px",
    "lg": "18px",
    "xl": "24px",
    "pill": "999px",
    "app-icon": "22.37%"
  },
  "space": {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
    "10": "40px",
    "12": "48px",
    "16": "64px"
  },
  "shadow": {
    "1": "0 1px 0 rgba(255,255,255,.04) inset, 0 4px 12px rgba(0,0,0,.45)",
    "2": "0 1px 0 rgba(255,255,255,.06) inset, 0 12px 32px rgba(0,0,0,.55)",
    "glow-lime": "0 0 0 1px rgba(200,255,46,.55), 0 0 18px rgba(200,255,46,.35)",
    "glow-chrome": "0 0 0 1px rgba(230,233,240,.5), 0 0 16px rgba(230,233,240,.18)",
    "focus": "0 0 0 3px rgba(200,255,46,.55)"
  },
  "motion": {
    "fast": "120ms",
    "base": "200ms",
    "slow": "320ms",
    "celebrate": "900ms",
    "ease": "cubic-bezier(.2,.8,.2,1)",
    "ease-bounce": "cubic-bezier(.34,1.56,.64,1)"
  },
  "layout": {
    "tap-min": "44px",
    "content-max": "560px",
    "tv-max": "1920px",
    "topbar-h": "56px",
    "tabbar-h": "64px"
  },
  "texture": {
    "arena": "textures/arena-bg.svg",
    "arena-tv": "textures/arena-bg-tv.svg",
    "grain": "textures/grain.svg",
    "brushed-chrome": "textures/brushed-chrome.svg",
    "brushed-dark": "textures/brushed-dark.svg",
    "court": "textures/court-lines.svg",
    "mesh": "textures/net-mesh.svg",
    "spotlight": "textures/spotlight-overlay.svg",
    "ball": "textures/ball-neon.svg",
    "ball-flat": "textures/ball-flat.svg",
    "iso-court": "textures/iso-court.svg"
  }
};
export default pb;
