/**
 * A.stand desktop console — zero-dependency inline SVG icon set.
 *
 * Every icon is a pure string constant: no network requests, no external sprite
 * sheets, no dynamic SVG injection. UI icons inherit `currentColor`; brand marks
 * use their own fixed palette so they stay recognisable in light and dark themes.
 */

const UI_ICONS = {
  brand: `
    <path d="M8.2 18.5 12 4.5l3.8 14" />
    <path d="M4.8 18.5 9.1 8.2" />
    <path d="M19.2 18.5 14.9 8.2" />
    <path d="M6.4 15.1h11.2" />`,
  clients: `
    <rect x="3.5" y="5" width="17" height="12.5" rx="2.4" />
    <path d="M8 21h8" />
    <path d="M12 17.5V21" />
    <path d="M7.5 9.5h3" />
    <path d="M7.5 12.5h6" />`,
  activity: `
    <path d="M3.5 12h4l2.2-5.5 4.2 11 2.3-5.5h4.3" />`,
  roles: `
    <circle cx="9" cy="8" r="3.1" />
    <path d="M3.6 19.2c.5-3 2.7-4.7 5.4-4.7s4.9 1.7 5.4 4.7" />
    <circle cx="17.2" cy="9.3" r="2.4" />
    <path d="M15.2 14.6c2.7-.4 4.9 1.2 5.4 4.1" />`,
  providers: `
    <path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6l8-4.4Z" />
    <path d="m4.4 7.8 7.6 4.3 7.6-4.3" />
    <path d="M12 12.1v8.3" />`,
  observability: `
    <path d="M4 19.5V14" />
    <path d="M9.3 19.5V9.5" />
    <path d="M14.7 19.5v-8" />
    <path d="M20 19.5V5.5" />`,
  settings: `
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.4a7.8 7.8 0 0 0 .1-2.2l2-1.5-2-3.4-2.3 1a7.9 7.9 0 0 0-1.9-1.1L15 4.7h-4l-.4 2.5a7.9 7.9 0 0 0-1.9 1.1l-2.3-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2.2l-2 1.5 2 3.4 2.3-1a7.9 7.9 0 0 0 1.9 1.1l.4 2.5h4l.4-2.5a7.9 7.9 0 0 0 1.9-1.1l2.3 1 2-3.4-2.1-1.5Z" />`,
  oracle: `
    <path d="M2.6 12s3.5-5.6 9.4-5.6S21.4 12 21.4 12s-3.5 5.6-9.4 5.6S2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.6" />`,
  hephaestus: `
    <path d="m14.5 4.5 5 5" />
    <path d="m12.8 6.2 5 5-7.2 7.2-2.1-2.1-3.4 3.4-2.9-2.9 3.4-3.4-2.1-2.1 7.3-7.2Z" />
    <path d="m8.5 16.3 2.1 2.1" />`,
  chevron: `<path d="m6 9 6 6 6-6" />`,
  chevronRight: `<path d="m9 6 6 6-6 6" />`,
  chevronLeft: `<path d="m15 6-6 6 6 6" />`,
  arrowUp: `<path d="M12 19V5" /><path d="m6 11 6-6 6 6" />`,
  arrowRight: `<path d="M5 12h14" /><path d="m13 6 6 6-6 6" />`,
  plus: `<path d="M12 5v14" /><path d="M5 12h14" />`,
  minus: `<path d="M5 12h14" />`,
  close: `<path d="m6 6 12 12" /><path d="m18 6-12 12" />`,
  check: `<path d="m5 12.5 4.4 4.5L19 6.5" />`,
  search: `
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.2 4.2" />`,
  copy: `
    <rect x="9" y="9" width="11" height="11" rx="2.2" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />`,
  refresh: `
    <path d="M20 11a8 8 0 1 0-2.3 6" />
    <path d="M20 4v7h-7" />`,
  trash: `
    <path d="M4 7h16" />
    <path d="M9.5 7V4.8h5V7" />
    <path d="M6.2 7 7 20h10l.8-13" />
    <path d="M10.3 10.5v6" />
    <path d="M13.7 10.5v6" />`,
  edit: `
    <path d="M4 20h4.3L20 8.3 15.7 4 4 15.7V20Z" />
    <path d="m13.8 5.9 4.3 4.3" />`,
  eye: `
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />`,
  eyeOff: `
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6" />
    <path d="M6.3 7.8A17 17 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 3.8-.8" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />`,
  lock: `
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.2" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />`,
  key: `
    <circle cx="8" cy="8" r="4" />
    <path d="m11 11 9 9" />
    <path d="m16.5 16.5 2-2" />
    <path d="m14 14 2-2" />`,
  play: `<path d="M8 5.5v13l11-6.5-11-6.5Z" />`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2" />`,
  pause: `
    <rect x="7" y="5.5" width="3.4" height="13" rx="1.2" />
    <rect x="13.6" y="5.5" width="3.4" height="13" rx="1.2" />`,
  alert: `
    <path d="M12 4 2.8 20h18.4L12 4Z" />
    <path d="M12 9.5v5" />
    <path d="M12 17.4h.01" />`,
  info: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 11v5.2" />
    <path d="M12 7.8h.01" />`,
  checkCircle: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="m8.2 12.2 2.6 2.6 5-5.2" />`,
  xCircle: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="m9 9 6 6" />
    <path d="m15 9-6 6" />`,
  spark: `
    <path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z" />
    <path d="M18.5 16.5 19.3 19l2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8.8-2.5Z" />`,
  sun: `
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />`,
  moon: `<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.3 8.3 0 1 0 10.2 10.2Z" />`,
  monitor: `
    <rect x="3" y="4.5" width="18" height="12" rx="2.2" />
    <path d="M8.5 20.5h7" />
    <path d="M12 16.5v4" />`,
  globe: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="M3.4 12h17.2" />
    <path d="M12 3.2c2.4 2.4 3.6 5.4 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.4-3.6-8.8S9.6 5.6 12 3.2Z" />`,
  collapse: `
    <rect x="3" y="4" width="18" height="16" rx="2.4" />
    <path d="M9 4v16" />
    <path d="m15.5 9.5-2.5 2.5 2.5 2.5" />`,
  expand: `
    <rect x="3" y="4" width="18" height="16" rx="2.4" />
    <path d="M9 4v16" />
    <path d="m13 9.5 2.5 2.5-2.5 2.5" />`,
  terminal: `
    <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
    <path d="m7 9.5 3 2.5-3 2.5" />
    <path d="M12.5 15h4.5" />`,
  clock: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 7.5V12l3 2" />`,
  gauge: `
    <path d="M4 17.5a8.5 8.5 0 1 1 16 0" />
    <path d="m12 13.5 3.8-3.8" />
    <circle cx="12" cy="14" r="1.4" />`,
  layers: `
    <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.8 8.5 4.5 8.5-4.5" />`,
  cpu: `
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    <path d="M9 2.8v3.2M15 2.8v3.2M9 18v3.2M15 18v3.2M2.8 9H6M2.8 15H6M18 9h3.2M18 15h3.2" />`,
  database: `
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />`,
  shield: `
    <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m8.8 12 2.2 2.2 4.2-4.4" />`,
  zap: `<path d="M13 2.5 5 13.2h5.4L11 21.5l8-10.7h-5.4L13 2.5Z" />`,
  wrench: `
    <path d="M15.5 3.6a5.2 5.2 0 0 0-6.2 6.9L3.6 16.2a2.1 2.1 0 0 0 0 3l1.2 1.2a2.1 2.1 0 0 0 3 0l5.7-5.7a5.2 5.2 0 0 0 6.9-6.2l-3.2 3.2-3-3 3.3-3.1Z" />`,
  link: `
    <path d="M10 13.8a4.2 4.2 0 0 0 6 0l2.5-2.5a4.2 4.2 0 0 0-6-6L11 6.8" />
    <path d="M14 10.2a4.2 4.2 0 0 0-6 0L5.5 12.7a4.2 4.2 0 0 0 6 6L13 17.2" />`,
  external: `
    <path d="M14 4h6v6" />
    <path d="M20 4 10.5 13.5" />
    <path d="M19 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5h4.5" />`,
  filter: `<path d="M3.5 5h17l-6.5 7.6V20l-4-2.4v-5L3.5 5Z" />`,
  dots: `
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />`,
  inbox: `
    <path d="M4 5.5h16l1.5 9.5h-5l-1.3 2.5h-6.4L7.5 15h-5L4 5.5Z" />
    <path d="M3 15v3.5h18V15" />`,
  wave: `
    <path d="M3 12c2.2-3 4.4-3 6.6 0s4.4 3 6.6 0 4.4-3 6.6 0" />
    <path d="M3 17c2.2-3 4.4-3 6.6 0s4.4 3 6.6 0 4.4-3 6.6 0" />`,
  history: `
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
    <path d="M3.5 4v4.5H8" />
    <path d="M12 8v4.4l3 1.8" />`,
  power: `
    <path d="M12 3v8.5" />
    <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />`,
  download: `
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 19.5h16" />`,
  upload: `
    <path d="M12 15V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 19.5h16" />`,
  user: `
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M4.8 20c.6-3.7 3.4-5.8 7.2-5.8s6.6 2.1 7.2 5.8" />`,
  users: `
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.4 19.4c.5-3.2 2.8-5 5.6-5s5.1 1.8 5.6 5" />
    <path d="M16 5.3a3 3 0 0 1 0 5.7" />
    <path d="M17.4 14.7c2.2.5 3.6 2.1 4 4.7" />`,
  grid: `
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />`,
  extensions: `
    <path d="M10 3.6h4v2.2a2.2 2.2 0 0 0 2.6 2.2V12h-2.2a2.2 2.2 0 0 1-2.2-2.6H10V3.6Z" />
    <path d="M3.6 10H6a2.2 2.2 0 0 1 2.2 2.2V14h2.2v2.2A2.2 2.2 0 0 0 12.6 18v2.4" />
    <path d="M12.6 20.4H18a2.4 2.4 0 0 0 2.4-2.4v-3.4" />
    <path d="m18.4 11.2.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />`,
};

const BRAND_ICONS = {
  antigravity: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-ag" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stop-color="#4285F4" />
          <stop offset="0.55" stop-color="#7C6CF6" />
          <stop offset="1" stop-color="#A142F4" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#C7D2FE" stroke-width="1.2" />
      <path d="M12 4.6 19 19h-3.1L12 10.9 8.1 19H5L12 4.6Z" fill="url(#astand-ag)" />
      <circle cx="18.6" cy="6.2" r="1.4" fill="#4285F4" />
    </svg>`,
  codex: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6L12 3.2Z" fill="#111827" />
      <path d="M12 7.1 16.1 9.5v4.9L12 16.8 7.9 14.4V9.5L12 7.1Z" fill="none" stroke="#F9FAFB" stroke-width="1.3" />
      <path d="M12 10.1v3.8" stroke="#F9FAFB" stroke-width="1.3" stroke-linecap="round" />
    </svg>`,
  "claude-code": `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <g stroke="#D97757" stroke-width="2" stroke-linecap="round">
        <path d="M12 3.4v4.1" />
        <path d="M12 16.5v4.1" />
        <path d="M3.4 12h4.1" />
        <path d="M16.5 12h4.1" />
        <path d="m5.9 5.9 2.9 2.9" />
        <path d="m15.2 15.2 2.9 2.9" />
        <path d="m18.1 5.9-2.9 2.9" />
        <path d="m8.8 15.2-2.9 2.9" />
      </g>
      <circle cx="12" cy="12" r="2.4" fill="#D97757" />
    </svg>`,
  cursor: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Z" fill="#111827" />
      <path d="m12 6.4 4.7 2.7v5.8L12 17.6l-4.7-2.7V9.1L12 6.4Z" fill="none" stroke="#E5E7EB" stroke-width="1.2" />
      <path d="m12 9.4 2.4 1.4v2.8L12 15l-2.4-1.4v-2.8L12 9.4Z" fill="#E5E7EB" />
    </svg>`,
  workbuddy: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#2563EB" />
      <path d="M6.8 8.4 9 15.6l3-5.1 3 5.1 2.2-7.2" fill="none" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`,
  windsurf: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#0EA5E9" />
      <path d="M6 13.6c1.7-2.4 3.4-2.4 5.1 0s3.4 2.4 5.1 0 3.4-2.4 5.1 0" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" />
      <path d="M6 17c1.7-2.4 3.4-2.4 5.1 0s3.4 2.4 5.1 0 3.4-2.4 5.1 0" fill="none" stroke="#BAE6FD" stroke-width="1.4" stroke-linecap="round" />
    </svg>`,
  vscode: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M17.2 3.4 21 5.3v13.4l-3.8 1.9L8 13.4 4.3 16 2.5 14.2l2.1-2.2-2.1-2.2L4.3 8 8 10.6l9.2-7.2Z" fill="#007ACC" />
      <path d="M8 10.6v2.8L4.3 16 2.5 14.2l2.1-2.2-2.1-2.2L4.3 8 8 10.6Z" fill="#1F9CF0" />
      <path d="m17.2 3.4 3.8 1.9v13.4l-3.8 1.9V3.4Z" fill="#1F9CF0" />
    </svg>`,
  generic: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#E5E7EB" />
      <path d="M8 12h8" stroke="#6B7280" stroke-width="1.8" stroke-linecap="round" />
      <path d="M12 8v8" stroke="#6B7280" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="#9CA3AF" stroke-width="1.2" />
    </svg>`,
};

export const CLIENT_ICON_KEYS = [
  "antigravity",
  "codex",
  "claude-code",
  "cursor",
  "workbuddy",
  "windsurf",
  "vscode",
  "generic",
];

const UI_NAMESPACE = "astand-ui";

function withNamespace(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="${UI_NAMESPACE}">${inner}</svg>`;
}

/** Returns a 24x24 stroke icon that inherits the current text colour. */
export function iconSvg(name, size = 18) {
  const inner = UI_ICONS[name] || UI_ICONS.info;
  const svg = withNamespace(inner);
  if (size === 18) return svg;
  return svg.replace('width="18" height="18"', `width="${size}" height="${size}"`);
}

/** Returns a full-colour brand mark for a known upstream client key. */
export function clientIconSvg(key, size = 22) {
  const brand = BRAND_ICONS[key] || BRAND_ICONS.generic;
  if (size === 22) return brand;
  return brand.replace('width="22" height="22"', `width="${size}" height="${size}"`);
}

/** Maps an arbitrary client name/icon hint onto one of the supported brand keys. */
export function normalizeClientIconKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "generic";
  if (CLIENT_ICON_KEYS.includes(raw)) return raw;
  if (/anti.?gravity|gemini|agy/.test(raw)) return "antigravity";
  if (/codex|openai|gpt/.test(raw)) return "codex";
  if (/claude|anthropic/.test(raw)) return "claude-code";
  if (/cursor/.test(raw)) return "cursor";
  if (/work.?buddy|buddy/.test(raw)) return "workbuddy";
  if (/windsurf|codeium/.test(raw)) return "windsurf";
  if (/vs.?code|visual studio/.test(raw)) return "vscode";
  return "generic";
}
