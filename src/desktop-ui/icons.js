/**
 * A.stand desktop console — zero-dependency inline SVG icon set.
 *
 * Every icon is a pure string constant: no network requests, no external sprite
 * sheets, no dynamic SVG injection. UI icons inherit `currentColor`; brand marks
 * use their own fixed palette so they stay recognisable in light and dark themes.
 */

const UI_ICONS = {
  brand: `
    <defs>
      <linearGradient id="astand-brand-bg" x1="16" y1="8" x2="112" y2="120" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#27272A" />
        <stop offset="50%" stop-color="#141416" />
        <stop offset="100%" stop-color="#09090B" />
      </linearGradient>
      <linearGradient id="astand-brand-back" x1="60" y1="26" x2="108" y2="102" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#A1A1AA" />
        <stop offset="55%" stop-color="#63636B" />
        <stop offset="100%" stop-color="#3F3F46" />
      </linearGradient>
      <linearGradient id="astand-brand-front" x1="32" y1="24" x2="80" y2="104" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FAFAFA" />
        <stop offset="45%" stop-color="#D4D4D8" />
        <stop offset="100%" stop-color="#71717A" />
      </linearGradient>
      <linearGradient id="astand-brand-bar" x1="40" y1="74" x2="104" y2="82" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#52525B" />
        <stop offset="50%" stop-color="#A1A1AA" />
        <stop offset="100%" stop-color="#3F3F46" />
      </linearGradient>
    </defs>
    <g transform="scale(0.1875)" stroke="none">
      <rect x="6" y="6" width="116" height="116" rx="28" fill="url(#astand-brand-bg)" stroke="#3F3F46" stroke-width="2" />
      <path d="M77 28L108 98H96.5L77 52.5L57.5 98H46.5L77 28Z" fill="url(#astand-brand-back)" />
      <path d="M40 72H94C99 72 103 76 105 82H95C93 79 90 78 86 78H38L40 72Z" fill="url(#astand-brand-bar)" />
      <path d="M51 28L82 98H70L51 53.5L32 98H20.5L51 28Z" fill="url(#astand-brand-front)" />
    </g>`,
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
  arrowDown: `<path d="M12 5v14" /><path d="m6 13 6 6 6-6" />`,
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
        <linearGradient id="astand-ag-base" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#EA4335" />
          <stop offset="32%" stop-color="#34A853" />
          <stop offset="68%" stop-color="#2580FF" />
          <stop offset="100%" stop-color="#1A73E8" />
        </linearGradient>
        <radialGradient id="astand-ag-warm" cx="56%" cy="22%" r="48%">
          <stop offset="0%" stop-color="#FF5E3A" />
          <stop offset="48%" stop-color="#FBBC05" stop-opacity="0.92" />
          <stop offset="100%" stop-color="#2580FF" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="astand-ag-green" cx="34%" cy="32%" r="42%">
          <stop offset="0%" stop-color="#34A853" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#2580FF" stop-opacity="0" />
        </radialGradient>
      </defs>
      <path d="M12 3.2c2.5 0 4.3 3.2 6.2 8.7 1.1 3.3 2.5 6.4 3.2 7.5.5.8-.1 1.7-1.1 1.5-1.5-.3-3.2-2.2-4.8-4.7-1.1-1.7-2.2-2.6-3.5-2.6s-2.4.9-3.5 2.6c-1.6 2.5-3.3 4.4-4.8 4.7-1 .2-1.6-.7-1.1-1.5.7-1.1 2.1-4.2 3.2-7.5C7.7 6.4 9.5 3.2 12 3.2Z" fill="url(#astand-ag-base)" />
      <path d="M12 3.2c2.5 0 4.3 3.2 6.2 8.7 1.1 3.3 2.5 6.4 3.2 7.5.5.8-.1 1.7-1.1 1.5-1.5-.3-3.2-2.2-4.8-4.7-1.1-1.7-2.2-2.6-3.5-2.6s-2.4.9-3.5 2.6c-1.6 2.5-3.3 4.4-4.8 4.7-1 .2-1.6-.7-1.1-1.5.7-1.1 2.1-4.2 3.2-7.5C7.7 6.4 9.5 3.2 12 3.2Z" fill="url(#astand-ag-green)" />
      <path d="M12 3.2c2.5 0 4.3 3.2 6.2 8.7 1.1 3.3 2.5 6.4 3.2 7.5.5.8-.1 1.7-1.1 1.5-1.5-.3-3.2-2.2-4.8-4.7-1.1-1.7-2.2-2.6-3.5-2.6s-2.4.9-3.5 2.6c-1.6 2.5-3.3 4.4-4.8 4.7-1 .2-1.6-.7-1.1-1.5.7-1.1 2.1-4.2 3.2-7.5C7.7 6.4 9.5 3.2 12 3.2Z" fill="url(#astand-ag-warm)" />
    </svg>`,
  codex: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#10A37F" />
      <g fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 6.1a3.2 3.2 0 0 1 3.1 2.3l2.2 1.3a3.2 3.2 0 0 1 .4 5.2l-.1 2.5a3.2 3.2 0 0 1-4.7 2.2L12 19a3.2 3.2 0 0 1-4.9-1.5l-1.9-1.1a3.2 3.2 0 0 1-.4-5.2l.1-2.5a3.2 3.2 0 0 1 4.7-2.2L12 6.1Z" />
        <polygon points="12,9.2 14.4,10.6 14.4,13.4 12,14.8 9.6,13.4 9.6,10.6" />
        <path d="M12 6.1v3.1M17.1 9.7l-2.7 1.5M16.9 15.7l-2.5-1.4M12 17.9v-3.1M6.9 14.3l2.7-1.5M7.1 8.3l2.5 1.4" />
      </g>
    </svg>`,
  "claude-code": `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#D97757" />
      <g stroke="#FFF8F3" stroke-width="1.75" stroke-linecap="round">
        <path d="M12 5.2v5.1M12 13.7v5.1M5.2 12h5.1M13.7 12h5.1" />
        <path d="m7.1 7.1 3.5 3.5M13.4 13.4l3.5 3.5M16.9 7.1l-3.5 3.5M10.6 13.4l-3.5 3.5" />
      </g>
      <circle cx="12" cy="12" r="2.2" fill="#FFF8F3" />
    </svg>`,
  cursor: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <polygon points="12,2.4 20.4,7.2 12,12 3.6,7.2" fill="#E5E7EB" />
      <polygon points="3.6,7.2 12,12 12,21.6 3.6,16.8" fill="#52525B" />
      <polygon points="20.4,7.2 20.4,16.8 12,21.6 12,12" fill="#18181B" />
      <polygon points="12,12 18.6,8.2 12,19.4" fill="#FAFAFA" opacity="0.92" />
    </svg>`,
  workbuddy: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-wb-bg" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#06C896" />
          <stop offset="100%" stop-color="#10B981" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#astand-wb-bg)" />
      <path d="M5 12.2 4.3 9.7c-.2-.6.4-1.1 1-.9l3 .8c1.1-.7 2.4-1.3 3.8-1.6l1.8-3.4c.3-.6 1.1-.6 1.5-.1l2.7 3.2c1.1.3 2.1.8 2.9 1.5v7.3c0 2.5-2 4.5-4.5 4.5H7.8C6.2 19.7 5 17.6 5 15.2v-3Z" fill="#FFFFFF" opacity="0.94" />
      <rect x="7.3" y="10.4" width="12.5" height="9.2" rx="4.2" transform="rotate(-24 13.5 15)" fill="#05B384" />
      <rect x="10.1" y="13.4" width="1.9" height="4.1" rx="0.95" transform="rotate(-24 11 15.4)" fill="#FFFFFF" />
      <rect x="14.7" y="11.3" width="1.9" height="4.1" rx="0.95" transform="rotate(-24 15.6 13.3)" fill="#FFFFFF" />
    </svg>`,
  windsurf: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0B1F2A" />
      <path d="M5.2 16.5c1.8-4.8 4.4-8.2 9.4-8.6 1.5-.1 2.7.2 3.8.7-2.6.8-4.1 2.6-5 5.4-1 2.9-3.1 4.4-6.2 4.4-.8 0-1.4-.1-2-.3Z" fill="#09B6A2" />
      <path d="M8.8 18.2c1.4-3.1 3.4-5.2 7.2-5.5 1.1-.1 2 .1 2.8.5-2 .6-3.1 1.9-3.9 3.8-.7 1.7-2.2 2.4-4.5 2.4-.6 0-1.1-.1-1.6-.2Z" fill="#38BDF8" />
    </svg>`,
  vscode: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M17.2 3.2 21 5.1v13.8l-3.8 1.9L8.2 13.4 4.4 16.2 2.6 14.4l2.2-2.4-2.2-2.4 1.8-1.8 3.8 2.8 9-7.4Z" fill="#007ACC" />
      <path d="M8.2 10.6v2.8L4.4 16.2 2.6 14.4l2.2-2.4-2.2-2.4 1.8-1.8 3.8 2.8Z" fill="#1F9CF0" />
      <path d="M17.2 3.2 21 5.1v13.8l-3.8 1.9V3.2Z" fill="#29B6F6" />
    </svg>`,
  generic: `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="#374151" />
      <path d="m8 9.2 3 2.8-3 2.8" fill="none" stroke="#F9FAFB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12.5 15h3.8" stroke="#9CA3AF" stroke-width="1.8" stroke-linecap="round" />
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

const ENGINE_ICONS = {
  codex: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#10A37F" />
      <g transform="translate(14 14) scale(1.5) translate(-12 -12)" fill="none" stroke="#FFFFFF" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 6.1a3.2 3.2 0 0 1 3.1 2.3l2.2 1.3a3.2 3.2 0 0 1 .4 5.2l-.1 2.5a3.2 3.2 0 0 1-4.7 2.2L12 19a3.2 3.2 0 0 1-4.9-1.5l-1.9-1.1a3.2 3.2 0 0 1-.4-5.2l.1-2.5a3.2 3.2 0 0 1 4.7-2.2L12 6.1Z" />
        <polygon points="12,9.2 14.4,10.6 14.4,13.4 12,14.8 9.6,13.4 9.6,10.6" />
        <path d="M12 6.1v3.1M17.1 9.7l-2.7 1.5M16.9 15.7l-2.5-1.4M12 17.9v-3.1M6.9 14.3l2.7-1.5M7.1 8.3l2.5 1.4" />
      </g>
    </svg>`,
  "deepseek-harness": `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#EEF4FF" stroke="#D5E3FF" />
      <path d="M6.2 15.8c0-4.6 3.7-7.8 8.4-7.8 3.1 0 5.4 1.3 6.9 3.6.7-1 1.5-1.7 2.4-2-.2 1.6-.6 3-1.4 4.1 1 .5 1.7 1.3 2 2.3-1.2.4-2.5.3-3.6-.1-1.3 2.5-3.8 4.1-7.2 4.1-4.3 0-7.5-1.7-7.5-4.2Z" fill="#4D6BFE" />
      <circle cx="11.5" cy="13.4" r="1.25" fill="#FFFFFF" />
      <path d="M9.6 17.3c1.8 1.2 4.4 1.3 6.4.2" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round" />
    </svg>`,
  opencode: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="#18181B" />
      <rect x="7" y="6.2" width="14" height="15.6" rx="2.2" fill="none" stroke="#FAFAFA" stroke-width="2.5" />
      <rect x="11" y="10.2" width="6" height="7.6" rx="1" fill="#71717A" />
    </svg>`,
  doubao: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false"><defs><clipPath id="astand-eng-doubao-clip"><rect x="1.5" y="1.5" width="25" height="25" rx="6.5" /></clipPath></defs><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEwAAABMCAYAAADHl1ErAAAACXBIWXMAAAsTAAALEwEAmpwYAAABaWlDQ1BEaXNwbGF5IFAzAAB4nHWQvUvDUBTFT6tS0DqIDh0cMolD1NIKdnFoKxRFMFQFq1OafgltfCQpUnETVyn4H1jBWXCwiFRwcXAQRAcR3Zw6KbhoeN6XVNoi3sfl/Ticc7lcwBtQGSv2AijplpFMxKS11Lrke4OHnlOqZrKooiwK/v276/PR9d5PiFlNu3YQ2U9cl84ul3aeAlN//V3Vn8maGv3f1EGNGRbgkYmVbYsJ3iUeMWgp4qrgvMvHgtMunzuelWSc+JZY0gpqhrhJLKc79HwHl4plrbWD2N6f1VeXxRzqUcxhEyYYilBRgQQF4X/8044/ji1yV2BQLo8CLMpESRETssTz0KFhEjJxCEHqkLhz634PrfvJbW3vFZhtcM4v2tpCAzidoZPV29p4BBgaAG7qTDVUR+qh9uZywPsJMJgChu8os2HmwiF3e38M6Hvh/GMM8B0CdpXzryPO7RqFn4Er/QcXKWq8MSlPPgAAAA50RVh0U29mdHdhcmUARmlnbWGesZZjAAAgR0lEQVR4Ac18C3Rc9Xnn785Lmoek0cuSLNl62/iJbB7GPIIhhBRSCAndvLobcJvtknZ3oedszvb07BaTXU7OCbsbsm03m5zTYlIIJU0CCSkJj4AIBRtjjIzxG9uyJEu2nqORZjSamTu3v++7945kA9aMsGn/Ptczo7n3zv3/5nv8vt/3v2PgX2C8fcKKZn3osry4FDl0GQaiFtClb1poOWtnA738W8wAYnzVY3nQa5jY68uiZ0OrEcPHPAx8TOPNfmtLDtjiMXA9wdmCCzB48d186CGgP79imdGNj2FcVMDEktI+3EcLupcvo7iIg19Crwd4OpvBdze3Gr24SOOiACbWxDPff6EsaRFju2Hh0YthdRcUsH8FQJ01xGVpcVsvpMVdEMDE9TI+bIPtekWPTHIavQd70HfsAGKjp5GMjcLMpBEoDSFSWYv6pha0rtmAmqYOGF4fFjG2mxk8cCGA+8iAvdFn3WF48AiKjFE5fvVH9ryKXS/+HIff3on45AQsy9JNI5J7ec4V+n1+LGvpwDW3/BtsuvVLMHwBFDMkxvFh26Ym41F8hLFowBZrVdnMLA7s+A1+9dhf4VTfMeRM5k5mBQEqmyNgudxZwBn85/E4m2HoJbetWI27/ux/o2Z5J4odPOvDAVrbYinJogDbMWS1eHN4+X2c6XyDAAydOIinvv8tHNm3G15aTElJEOlMBrOzswpkzjSdfV0bE+D0f32UIcB5uUWj1bj324+ivn01srMz8PoD8BTormJtuQxuWIyLFg3YawNWl9/AU8WAJVaz89nH8cyjfwl/IIBIeQWS09MYOXOaIGXffxWW++AAxf9yCpxYH23O4+EhFurqm3DllZuwc8erCEUqsPnmz+O6O74KP2PfgtdE0PjJn7umyehBEaMowBQs0LKKiFfZ9Cye++H/wu5XnsPytg6Mj42i/8QxZGhV7hUY7mW4V+OGMNfOBCwFLQdiz+c5tVAvLWpJTQ0ytE6DgbSmshKbP/FJXP75P4InWIECRiwD3FAMaAUDthiwZmem8Nz2hzB+up8WUI6eXTswNRlz4pOELmN+XHeeGHmrcoe7vxvbTKKWpfsG6NIWH/0+jx6a43serxfNzW343bv+M1ZsuqmQrFoUaAUBthiwMrMJvPz3/xfmbBJnBk/h3T27MZuayX+k4THmXYSh7jcH0jmmptZl5S1Ntkw2iwytTU5TFixhbPPoPpJEBFCxwE2fuBmf+5O/UGqywCgYtAUBW0yAtxiXdj37CLLJSRzY24OD7/Qgk07nP1Fd0LBhOutiDGPeo2N6AoJkTyuXty5TQKFlpdJZ+LweRCMhdUl1WdnHFNcVND3oYEbd+uf/B9XLzp9RC00EnvO9KdShaLB4wUd2/Ro+izxr/7s4tG/vHFjnXKLCZQhl8NIifPD5/UwKJbr5mPV8tBJ5T6zHBVMypDwX4OQcApgmAQdj55S6T45WePjgu/j+tv+E2NDJ8143D2nx+PGyzPl8+50XMOVZxVAHjpET+zA92k+OdXIeWNZ8KpqPScKrvIw5AlTABYogGcrLGKc4Yd1osWJRYjVibXIOL0ESIAM81o1flnUuCoZSlePvHcLj3/lvmE3Ez3vtAlraj/vPt8+HArZrwLq7WFI6m4ihb/8OpAnS3jffQCqVclwJeffT54aA5dE4Y1tUgM+9dmxiSTTL49KzKXKztNIOax5Y8ijwS4YsDfjVwjSD5l0157iwBdetJUG8/ebr+M2Pvw/AwgKg3SfVC4oBTOKWFNEoaljo3fsKyWiAMWsvJmMT9mQdgNx99EMJlo8uGCBQfr9PLSqbyWpSSJNuWDkThmXZqcB6/4acjbyP1hkKhZgtA/rc4yQSBVczRM5xT3oLCfJLv/wHTCzgmjKk1Psw1/xAwBi37i/WFeOnT2BqbBCjI2cw0HtceZYLlpvd9APpRl6JVTJJgiVvitsKWBbdzyNoaPDmluVz/s3g5tXHjL6GAmrCKy7N85WQqAZKg+reXlqcbDLMnBP8YYM3Pj6G1599spDpRD/MNd+XJTUrmjiBIoaAse+lH8HDNLPz1W6WPu9ghgpEPqg4yClYWhLRDQmaTEiAzbiu57iSwUc/5yyPdDjUlJWhsWEJmpbWI1xeDkIHQobjJwew/8hR5GhZdiVgaMwzCayZk4xqkn6YcKtSKZ1WrF6Lbzz8Y/jI4RYapsWseY6m9j5W5zPxiIXixuTQMdZzCUyMjZFzDdJiHBZvh3ibQhgezXgClLijBPE098um0xqYxaJo2fBR+RPPKieoq1uW4aoN69Dc2YnKunqEWFKVlJSqZQr4Mp559td45IknEU/MKIj6kYZkTdN2fS+NUq3Mq6/jJM4j/YfR0NG14Ly8dljqPguf+S9EACxW/JN4c/r4OxqHpORJ8IJsN7DBms+tBCiJWfK+G9QFOItfZdArgOZ4QR5s7GjGNVdsQMsllyBav5RWFaXLlSr18LgBkQBLnXT7Lb+D1Ss68dBffQ9HT/arZdmGLV+SZWdiiZHc1+8v1c8/c/JoQYBxbNlBTOZb2VmAsSNzF4o0r8T4INLJGMZGhtW60k6NaFc59kXLK4krfmY1mYwLlgR6+UM5/27yeVtNFbZcfilWdq2nWNiMSLQKJcGQWqXB+GTo+exi3i0MJGO2tbbgoQf+O/72sR/h5y+8jByss8ovDQX8q9ScQQIvhLrQca6V5QHTzGjibhQ5JgYOaiofPNmLqVhM44aLmM0l7TTl8itx1ywzVjZj6odHCJZBAK5d1YGrLu9C44qViNYtRagsStWhRK3ScNzPsqw5VpDTv+SlIMmWf/y1raisiGL7T55inLO5mVIYuQaGA7GykZERfm7WtlDDU8gUt0jGdPWz/BGMXUXLyxkW19MTw5hg9hk+fZq61sw8xXROgZBvWOKOyaxnClgMzKKXBjkb1qi4ad0qXHPVZVi2eg1dsImxSlzwbLBsxBzQcjYRtubXl86HfeFzt+NrX7wTnvks1rBrV8mo8fFxnD41gFw6gUJHNjCHTf5qKDPdgSJHYrRPM5xcQJzWJYVvnjDmr9Vm81oHihsya/n4vIS7hEktbly7Cl1da9DQ3omy6iUoDUXgCwRUdcjLPnn1wmb5lqvM5uZqiDxH45dw+2duwe9/9lZmbcf8LPuKPA7J3c+SzconpoUHD7nvLMC021Mk75KzxM8cJ1CTGDk9pDzKdABzIXPUGs2OEq+EPEqsKuXfQrS4azvbsHp1B5a0tCJcVaNND82AkuXyYNnBSs9nOWBp9ZBzBEUrT0dca5N9f+/223DnzTdoYnDP41Fq4UEfy7ZxNluKGFEJ/nnAeJ7PosiRnp7ATGIKZ4YGMTkxoYCcbV1udvTo5MS6BLASzpqZHhtIGTqZDWuXLUc4WmmD5fU5WdUGRU1DrARzOr+t+Z/72gUslwdPONcXP/9ZrG9vIaEyYXsyP5tfXjKRILk+imIGJbfr5wBz1zUUMZLj/Ugmkyozp/iYy+XO6fg4libKgmkX0ZYQVLrkivol6GhqQM3SBoQErFBYa0PDLQvU3XLKz+aDYINjzoHmlEA5Z598rekYldSp/3Hrv0UZ4yF0H9O+Lu53qvc9FDP4MVsUMMkAxXIvOXomPqpy8+TEuJY27wv2cMsiSyduEqjMbBoNFWTtlVFUVlYoZRBuBcMzB4hTzsjk3Nd5cNzXzvP85uhjbgzNORZHB0RV7RL8u9s+rV+Cqho5O3OeGVi4pjxnaLb0ySoaFDlymRSS8TGMDp9R81byme/zzIPMsttnEttmZlI6oZOjE+gbn8RzB44iXBpAWTiCivIIqqJRLGtqwsYNXejo7GBBLSqqqzjMxTPLqTOteWApUXasLe+ezj+P4cWmKy7HC6+9gcODw/yLqbL1xNiwnssojFroSBErn7PkqKiRnh5Dgl2fGOmEENWcna5clPKTU0rgWFiSgEWY/eqj5Vi+pBpVVZVahGcY+6bp0n29fTh24iR27+nBKiaDrX/4Bwqaqg2W4ZzSBcxSyUeTjFpvNi/7zJEJw+k6WVqYf+rqTTjy46f5HRp6fHJ6yk4I3sIBY+K+1Gfk0FJs7Zgl/4rHJzEdn1JXgzWX3u1sNnfhYgkGJ7ZqaS3WNS3F6uZGLGXAr25ajlBFJYvgEgU1NjKKI4eP4OChIziw/xDPHUNlda1zQkdNc+OZxCp+riiqQoSP8rhDx46xNs2oZFTPGNmybBkq2EVywVuzshMNVVEMTk7b2lmuSCuRkaOFYREBfzYxSToxwa6QBHvHHT8QdTsI+znhOqoMDYxbZZEISx27zS9B3qvFuB/1LWWoY8bcfN21mJ6cRLisXC3X40qP87KigGWqGpvB0YOH8P3H/57Fd1KZvE3FDJSwgmhdvgy33LgFzcsaUcqS6LKVHTj1xh5IrtOmbxHuqJfA/rEAVty6LV5ROjVNC4uza52ea4E5oNnhxsqHHZPvVzFLVUXCmJiZxf6egzj4j92Y4YTLwiGsam/D1Zddis1XbKSuFWTGjKC2rEKLZg32wsksl9m7gd7MB/lSxsGNrcsRpQQU4flK+VlTyRROjY7i+NAwHv6bH+Kma67Cliu7sOGSTjyz4y36loVQuOzsKqKAQUbEGEbUiiq4edEpauOJxPQc97LmzuiwLxswR9s6PjqON/sGOUEW2gzua9Zfiqn+frzz3jEcOH4Sz77yGlrprn9x7x+hs71dlVOLSoAcaxlnqZBOEjFtzYuPSxoacNvnb1cgtRfgqCQbtd1mYnjoDJ5/dQd+8cIkbrh8HSKsLib5XjVLsMUMT7EMP2emlbDOJmccnuTIBsrN88q9XfByhMncb1rdiZvXrkRDczO++if3ojRShvcOH1S3qKLOFamuRoIAPfQ3T+D48RPK29TVrbm4CDiYqUtm7UBvZrSQd/leYmYGEyzRZuieso9wu8bWVnz5zjuwtm25vhZLl8xY19iKRYyWohdbWfxmZ3hhIv7lnMA5x8GsOZ5vt3IQYYxqrKpAE10tEqpDZXkZ9r+xA1duvprgHGMM86GE6cdMp3DrV76OJ559Hv/1nkab9fsw1x23bMuRL0m7SLwOkYlEsd359j785MXf4vggSzRavZ+Z7xK66Vdu/RSu2NiFIONm56qV9IyEyju+5CzWXHEdFjOKc2LYgqF0dZS5u4HYEVbhPKhu5bhGBbvSEqva21rR0rgUoyzU162+BL/3pS9rhSCLUjJ89HDyKcraG2/8HfT1D5Iruf1GW61VGZbn1AzHoC90Zppx9Hs/+ike3P4E3u0bwJmxCaT43rWfuQNjWS+++YO/w09/9aKew0+l1hugFsZztq1ci+aV67CYUTRgEsNEoZCLzisEZyspLhPQk4veFaKVVUWCaOBWSfDG+vvwnW89iCAnIYqC/L2lvg7trW3Y0HUpEGDwD5Rq601qP6/TzJUT21zLvoaX9hzA3sFRVC+pd+IXlEjvY4vvq/f8MWlLFX74y+fx1489iVnpj1INTDOO3vm1b+SV4GIH7V7XwbcUeoAufDOz+drRdcd8ltQMaWdJaX0FpUPEift4zJraUkw0NGJnVTVKGXzjM2lUl4XQRrDMSDnWUg/zZWbQSveR1pmrPKilyQIUI2OruARwkjG0vHMtPC//Ftv+54N4/LHH8cxTP1MgpsdG0Mx4uXbjZbiivgI3fWKzftHx+DQq6J7Laxe9oLu3eAsTeMx5igHOUUIdTUd1MD4L8FstFX1LnqeTaMxOYCtVhFoqox1k/PUsizK0qLv+Ay3CSqOO2k+Ek5IaU3Q01cVEopaaU87K137GoTCpR2d7K6pDpfjFk0/gnT1v2ZZI960tiyiBX8s49kmCFeL5REBM0PXXL1+CwIHn4T25C7CKpeyI+Qy5uwLFZco8iz9HnXCBmt980PjBwC4KqoDmY7JYURXB//j6HyBF4CWmiEuVBLmfOUOgSmxC6ayPUP1eX9slkV/WYHCTlluZN4ya+noMv3cEMpGlDXWoIZgr2DyJ+AK4Yd0K1C5ZQgqU0POcPjOMy9esRGkwiJKJY0jS7dMN61HEiEl5W/xaz/kWdVb8mpcp+Z+fYJQ6E5TFJYFgGAESxgD1d4+fyYD0oobyjsQFj9Ppma966J9EDxOK4XAvsTgBTerMqlwKt336ZmY+tuTqarCBklELgfzUp2+Bb3QITbRgUVKU6DJJtdRWslyKamYWIbEs3gsjM4NChxiXXGsPirRMN6i7KR/Oa5y1QI4BlhPMmPZaLZ8sNCkp0QaqgOf12TK01+tn9vLDE7A7QzZJdSoHBYvZWHoBrBPTyQT87E16nKLeQ6u5ZkUrlt71+zjG4n2KvcmOlSvQVFUGGpHK0FkCI0ALXwsECLYkE7q4cEAfVUFvYgTZ6PKC5i33Ofn4xe31FpEwDMfNDEdGlv9zbg8S9qpneGymnyYnGp1OaIYyGPg9BM1L0Ly0LgFRAZOllwGfxiiJM8Y8K5N1ZpYU92zKmqQRJvU01bUcvV8/ka8boxWoX9GurTvVyyZH+ZnU2lgu5aStRsoix3ulsSu1q99eTiXJg28WMXlaWGkWPRl/4cfAAUzKF11FqJbmxi/7rK47ybM4ZZ0x8qNGXnBEjhVgxCUEKGnMEkj9m0RpWo6UQpYj36SmphA7PUixclLLIC9rzSBBkMnq0gOfV1f+WKGgJiHpCumSA8mqorLy+jLsZKVoeTmC6eMX49UvrVRXXUvpZAbKC566P4W9Hqff1l3wUbCByjdWgQ/gNHMxKE2XHGG5kqACoWsoMMel7H/aysAcNck5jdqcunCYFCRYUYHScJiMPaxA29TCWU0tXE1ACBKEcBBeyt0e8UdZkShJJTVL0FI00ll7kZ5YuKq8wBRpjRWuLnDe6BastDTi53e7mnUhgEkGdLc8WHPLKBzWauA0eU+EFxhjKTI2OoaKujo74EvZ47FjlOEW1fby6HylQGSYWX324hWqsmI54kJCNQQo1cWkSNcSKsskErBDgyer55UvxlShIKmxLyTWJfRErDCXwVQ8iXj9ZVpfFjZr6PpX3Zsx9ZWC45hhd4LcCxfQcgKcqyYD+Rg3QVcYDEyhubYGQ8Nj7GiPqHyjsUOt1CakkgWVxYsAKpNyNH6TNavFYG+wxW9x8zDgy36qTDgyj2hmphzrLMiz7yjJKljC+kXNzUyOw0feZ03HmRgSSPtYgHdeB399BwodVKafzgMmiy12DVjimgVRYMO5jWV+GZRX8/NZ06NviIa/jMV3bSSEkyf6VYfyyopDyZRe+cbpglnYtSmTQ3ygH5QbkJ6cQoYyspVKMlizPcaaNLy8FZHWThi0WiXPWVNXF+acZegiKGayaaUSAtbEeAz7jvejdfVGpClgBipqUNLQjpL6NqCI0ogz693UYLySB8yeIB7ml7OtkKOtc6zJOUP+f8OJMZL+pemw5+QgauiKfpp/mAHaXxqcW/SrS5cMZegW/x5lUzczMoyAdKZ4MhZDLHVGYZ4ZwSg1tZKjRxGkvF22tAl+xiqx7Kxpr4eVGJliySR6fWwihidf3oHQiitw7WfvwUcZcuOq+zwPmC+N7zJbblv4cDswa0trno6fjz0OtXBBkzcTpAMvHjqGm/hugNwn4KxplX1CCmyQIcujoOV4RSaDeGxogFp4Sl2/rDwEqywoC9zga2xEcOky+q4vLwAIz5oVtYPKh/QZhNn/9JWdePGNXawoCpjSAkPu8n0fYJIB6JbdWLBHabfkRZfKu2PePa05/UoXf3gd1m9gitnqhYPHlMj6ZeU0t8Z8ZUUNntbiYyCVDBauZfPjss2YOLAPyRESy5S9WC7Y1IgwwbIbJxLbbalawEpMxlXuiZP3Pf7rl/Dbt/ey3izD8o41+Ihj+/y1+2elCH6DD/Cat5z3cG9A12s52OWJbF51dQAQSiuNiFTaloJkTJOLST9ygtzsEw6Lz7Vl8ssCDDZ2fboU3YeKhqUoq28gw087cnQ2T1S1k85kIOu9ZsSqJmOYYsw7xDbd3/7jC+hnzRikFVctaUC4vKB7js4zX2yf//IswJzg343zWJmvJIwV66/GGIXAN8cnkJFM5qydn5M+bEvzaKljF85OvUMLM/HGiT4MMSDfSKpxBTNppnMGWcYkK0rZJ2THN4+Ttj3CmSSbmj6tB+WWGREPZ9hTSE5O6mKY8YkJPNW9Ay++9TaSsxn7ZgduK9ZdvmjdyxndVzrB/gMBk7GglfECalZtxm2dG3H9+AgGTh5H33vsBO15HUMnDpHzxBHIkWHTKkQVCBErtRDpI+qae7bO+PrE6TN4lIDtp6x848AprF23GjXNrYhSXSilNmZ3vu1Mq7K01JJk7QLUNFt8k+wKjdCSXnv3CJ5+/U2MTNo3Lbi3MMmKoSqqIB9lsGWw9X3T/6Ad3xywvkNjuA9FDnGX8eEhHN23C8f3v41bvnIPpeEgs1YcI0P92PPSL/HaD/8fSghcnPvGCOaSCioYtKJL2Hy9bv0qysedbPIu0yavX+s9QylDmj1QqRYmh89g6GQfdr9zCD/bewDDJKbuVMSYVIPze1HB+PWFr/8Z7vz3/wWLHNuvbDIKA0xvT/br0vML91sTtKpv/+Hv4uTObiz12qXViLTSysLU/MPOquoM6irKsLqlCe3Ny7CktlqJrFjX2Pg4DpLHvXOsD4cJWID7k9KinwV+1mkqaBiAZGIvKqPl2PqNb+HTX/waih3WeW7U+sC6QDLmG33WVoafp3ABhqT+7r/7a5za/SoivJwsXy+TlhcnGM9kVJsKUNefJTBxZtNf73kXqZ17EJJsSFCSjFliSaOpNCK0uFZSkHKPXf74WfIMZi0kcq5a4qwY4utwpPDC+pyx7cPuavvQQmrTcuNpuubDi3HN+UMu/pmH/hwHn/wBOrUT5ENa7mfkiZfw06tIGGQxcc5TiaqKciTDJsoY+EWznyBIU+xQpeS2GsbAEgK8kp3uOlYH4nozPI8oICU8b9WKddhw+5cpQzOJyF0lLJsu2bgZxQ5e1sPn++WB81aevgweyARwR7HN3vnj8D89j6M/2446cqZyP/Uow+ZmGQJZQSsT8htlbTQ+NkZlw9SFJNVUJSaZfSPTpYgTgGnSkMp4As3UoSulScxZJUz7fsigxDgWw1b/e+hi+6zt2k9hsUNcUX5x4Hz7nLcJIq5penCDdpYWMbIM1Lt+8G1UmaKF5fTDxG1KOMlalkRhjzB9j66/iBLQCma/5Ml+lBHR5ppKtDGeLePz1UwS1wd9WOk3UOGxV5wHeGwNY1VYZHC+DrKGPPzzx5BffljkcOPWQj/PsGDXaHOD0Zux8DkUq/3LauUn/z9Kju1HnWGpO8lUUvz7MGNVTARCupRYSDWzmqldbbb3WQdOHDwCo3cA5adOoZ3N3XaCTYEH0+RgszxmKQlxGwXCCgImYEuRVklgJ3b/Fpn4on6OIia/MFDIzzIUJAbJvdCvDVg3FHPf9yipxcHt30UFyUxE1ukzzqQZiBOinDJLjqaziMmNDpxwLTNhDbc4AQkThKhkUU5cwEjxKx2ly00TqOXsVQad84wxrs1Iv4DnaCV4NbTYaVpZYvQMomzgFjGKukm+4LUVxYCWmZrEqw/+KbLkX6NCWjmZBmazMoJRlvNgigCIxYmVHU/Zi0lWsL/YXOJXoiNFtoCVYEU1IovkhLVTh5fiSCoqcQsBqKnUoy4tRUGa5vsuE0P/4X2Itq9CgaPon2EoqpErJ5YPWCimHfnVk0ifOgk/M1WaEz+UTOkmPxVTxYkuDwbQRHA6aBlXUYW4lFqZTDyr6iv7kyIf03r6qHLU0P1qSWxDpBJiic08tj1Ugg4CXMfXEg9ned5B1pzDzKi7f/KINk8WGhKzigVLxqIKrYV+aeDVv/wmBp/ajorZBIISl7jjGbpQjBawnrp7A8ES8MS9pAE7a1p687vfsDtGQ1JYWza4AblPSZvCUEBJuTT22e6dU9ecpKXKuVWujlZhoHM9OllHdl39SXSu7qISEsa5YH1sPyXjDv0dQ7/+Vliep6XJf/a/9Rp++r0H4R0cQBtDebNJKyFtKPcYGtiHWBwLUHV+OxqIcitWIqaekdjEOOYjY66U9RgS40RN5XsS3wSgaVmR7fzAUakDssSxMM8pa8zepZryK/qnx2nSSFd946Yt+OqfPqDtNetf4seK5g+5mT6VTN7/+gtPtfzmF49jmMJflsF3lu7k5WTbmeavojkupZQTJioMO7QQW1Mr5SQj0l5zrCZu2oQ06tzaPCu359B6xuU2QdgABYVGSGXgrNYRqxNgZY8RCu8/m8niuMjf+YaJrdTd8Jkvxe6+75tbhZDjI4yPDJiMu+++p+Xtt169P2Nm71ZhL+cqoXajopHbNbKulPpVtYLmUYuQTdZLCGOXOFTCv4foewLCFN00aZq6jKCaCaPUYy8Xl+JHEoLXoSmSILIEp48KyYvsBPVkTErXIV0+KqDZN7X6Hy4JZh7o6en9yL/KeUEAc0cLB+f7CM1ji/vLTPIB+tsUdNd2Uoz1NKHOgEdBk/gl7uX2N/W1qBicdIjHVJKfRcRKBHxYbl9deZc8Sjwbo02+lbbw3PgkRqR+ZCHvd9w9a2a7edS206dHX8EFGhcUMHe0NDVdz/rlbgJxt1iZdJzlthmLhfYXSr1opgOFNOAb+mipReW4mWoxEr/KCJSweZm66LWuC8omLj3NfY+xGN+ZzOD1GRbwsg6NQMny8oA/0J3NZLcNnD59wYByx0UBzB0tLfUtZsa4l7O8g2bSIgtKbiZnaDdMUgq/xqsYAZ3Um+TtWFRJF5K4JgW1XUbZC08kISSUsGbwHoE6xq61JIxqUpPdrN8GLCPG7tPD6WzuuzEOXKRxUQGbP+praq43c7k7Ooxc160h/5YoQUsSLAngtbTAoMeT73Nm9d5G5PUtsbxx0oYDiVkcnJlV8lof8GJ5wN9dRWvqDwS6v9d74a3pg8bHBtj8cV80Gi0rxaVrQiVd9NAWAtBFFh8lflES3RYJ6qYqEgTVtHp7qYedSps9k1kzVmpYPXTjHq8vu/fpGC6aJX3Y+Ge+Wiqo3aXKQAAAAABJRU5ErkJggg==" x="1.5" y="1.5" width="25" height="25" preserveAspectRatio="xMidYMid slice" clip-path="url(#astand-eng-doubao-clip)" /></svg>`,
  "qoder-cn": `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#0F766E" />
      <path d="M12.2 6.8c-3.5 0-6.2 2.8-6.2 6.5 0 3.7 2.6 6.4 6 6.4 1.6 0 3-.6 4-1.6l1.7 1.7c.7.7 1.8.7 2.5 0 .7-.7.7-1.8 0-2.5l-1.2-1.2c1.5-1.1 2.4-2.8 2.4-4.8 0-2.8-2-4.8-4.7-4.8-1.4 0-2.6.6-3.4 1.5-.3-.7-.7-1.2-1.1-1.2Z" fill="#FFFFFF" />
      <circle cx="12.2" cy="13.3" r="3" fill="#0F766E" />
      <circle cx="16.8" cy="12" r="2.1" fill="#0F766E" />
    </svg>`,
  qoder: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#FFFFFF" stroke="#D4D4D8" />
      <path d="M12.2 6.8c-3.5 0-6.2 2.8-6.2 6.5 0 3.7 2.6 6.4 6 6.4 1.6 0 3-.6 4-1.6l1.7 1.7c.7.7 1.8.7 2.5 0 .7-.7.7-1.8 0-2.5l-1.2-1.2c1.5-1.1 2.4-2.8 2.4-4.8 0-2.8-2-4.8-4.7-4.8-1.4 0-2.6.6-3.4 1.5-.3-.7-.7-1.2-1.1-1.2Z" fill="#18181B" />
      <circle cx="12.2" cy="13.3" r="3" fill="#FFFFFF" />
      <circle cx="16.8" cy="12" r="2.1" fill="#FFFFFF" />
    </svg>`,
  minimax: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="astand-eng-minimax" cx="38%" cy="32%" r="68%">
          <stop offset="0%" stop-color="#67E8F9" />
          <stop offset="48%" stop-color="#3B82F6" />
          <stop offset="100%" stop-color="#6D28D9" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="#0B1224" />
      <circle cx="14" cy="14" r="9" fill="url(#astand-eng-minimax)" />
      <path d="M8.5 16.5V11.5l3 3.4 2.5-3.4 2.5 3.4 3-3.4v5" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`,
  kimi: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#111111" />
      <g transform="translate(5 5) scale(0.75)">
        <path fill="#FFFFFF" d="M19.514 7.342C19.711 7.862 19.814 8.413 19.816 8.969C19.816 12.494 15.998 14.697 12.946 12.934C11.529 12.116 10.657 10.605 10.657 8.969C10.657 5.646 14.085 3.431 17.115 4.793C15.26 3.373 12.99 2.607 10.655 2.612C4.772 2.614 0.005 7.381 0 13.265C0.002 19.148 4.772 23.918 10.655 23.92C16.538 23.916 21.306 19.147 21.31 13.265C21.312 11.155 20.687 9.095 19.514 7.342ZM14.841 4.666C14.841 8.191 18.657 10.395 21.709 8.632C23.127 7.814 24 6.302 24 4.666C24 1.14 20.184-1.061 17.13 0.699C15.714 1.519 14.841 3.03 14.841 4.666" />
      </g>
    </svg>`,
  codearts: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-eng-codearts" x1="3" y1="2" x2="25" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#2286FF" />
          <stop offset="100%" stop-color="#1464F6" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="url(#astand-eng-codearts)" />
      <g transform="translate(0.5 0.5) scale(0.25)">
        <path d="M55.78 76.58L76.78 51.56C77.21 51.04 77.27 50.3 76.91 49.72L68.89 36.74C68.6 36.28 68.09 36 67.55 36L41.59 36C41.05 36 40.54 36.28 40.25 36.74L32.23 49.72C31.87 50.3 31.93 51.04 32.36 51.56L53.36 76.58C53.99 77.33 55.15 77.33 55.78 76.58Z" fill="#FFFFFF" fill-rule="evenodd" />
      </g>
    </svg>`,
  junie: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#14171A" />
      <g transform="translate(4 4) scale(0.5)">
        <path d="M25 15H35V16.75C35 29 30.5001 35 16.5001 35H15V25H16.5001C22.6251 25 25 22.875 25 16.75V15Z" fill="#47E054" />
        <rect x="5" y="15" width="10" height="10" fill="#47E054" />
        <rect x="15" y="5" width="10" height="10" fill="#47E054" />
      </g>
    </svg>`,
  kiro: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-eng-kiro" x1="3" y1="2" x2="25" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#9046FF" />
          <stop offset="100%" stop-color="#612EF0" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="url(#astand-eng-kiro)" />
      <g transform="translate(2.5 2.5) scale(0.72)">
        <path fill="#FFFFFF" fill-rule="evenodd" d="M17.383 5.422a7.556 7.556 0 0 1 6.008 3.805c.148.257.406.796.52 1.085.394 1 .632 2.157.769 3.75.035.38.05 1.965.023 2.407-.125 2.168-.625 4.183-1.515 6.078a9.77 9.77 0 0 1-.801 1.437c-.93 1.305-2.320 2.332-3.480 2.570-.895.184-1.602-.1-2.048-.827a3.420 3.420 0 0 1-.25-.528c-.035-.097-.062-.129-.086-.09-.003.008-.09.075-.191.153-.95.722-2.02 1.175-3.059 1.293-.273.03-.859.023-1.085-.016-.715-.121-1.286-.441-1.649-.93a2.563 2.563 0 0 1-.328-.632c-.117-.36-.156-.813-.117-1.227.054-.55.226-1.184.484-1.766a.48.48 0 0 0 .043-.117 2.11 2.11 0 0 0-.137.055c-.363.16-.898.305-1.308.351-.844.098-1.426-.14-1.715-.699-.106-.203-.149-.39-.16-.676-.008-.261.008-.43.066-.656.059-.23.121-.367.403-.89.382-.72.492-.946.636-1.348.328-.899.48-1.723.688-3.754.148-1.469.254-2.14.433-2.766.028-.09.078-.277.114-.414.796-3.074 3.113-5.183 6.148-5.601.129-.016.309-.04.399-.047.238-.016.96-.02 1.195 0ZM16.754 11.336a.815.815 0 0 0-.375.219c-.176.18-.293.441-.356.804-.039.235-.058.602-.039.868.028.406.082.64.204.894.128.262.304.426.546.496.106.031.383.031.5 0 .422-.113.703-.531.801-1.191a4.822 4.822 0 0 0-.012-.95c-.062-.378-.183-.675-.359-.863a.808.808 0 0 0-.648-.293.804.804 0 0 0-.262.016ZM20.375 11.328a1.01 1.01 0 0 0-.363.188c-.164.144-.293.402-.364.718-.05.23-.07.426-.07.743 0 .32.02.511.07.742.11.496.352.808.688.898.121.031.379.031.5 0 .402-.105.68-.5.781-1.11.035-.198.047-.648.024-.87-.063-.63-.293-1.059-.649-1.23a1.513 1.513 0 0 0-.219-.079 1.362 1.362 0 0 0-.398 0Z" />
      </g>
    </svg>`,
  codebuddy: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-eng-cb" x1="2" y1="2" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#06C896" />
          <stop offset="100%" stop-color="#10B981" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="url(#astand-eng-cb)" />
      <path d="M6.2 14.2 5.4 11.4c-.2-.7.4-1.3 1.1-1.1l3.5.9c1.3-.8 2.8-1.5 4.4-1.8l2-3.9c.3-.7 1.3-.7 1.7-.1l3.1 3.7c1.2.4 2.4 1 3.3 1.8v8.4c0 2.9-2.3 5.2-5.2 5.2H9.4c-1.8 0-3.2-2.4-3.2-5.1v-5.2Z" fill="#FFFFFF" opacity="0.95" />
      <rect x="8.8" y="12.2" width="14.2" height="10.4" rx="4.8" transform="rotate(-24 15.9 17.4)" fill="#05B384" />
      <rect x="12" y="15.5" width="2.1" height="4.5" rx="1" transform="rotate(-24 13 17.7)" fill="#FFFFFF" />
      <rect x="17.2" y="13.2" width="2.1" height="4.5" rx="1" transform="rotate(-24 18.2 15.4)" fill="#FFFFFF" />
    </svg>`,
  qwen: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#6D28D9" />
      <path d="M14 5.5 21 9.5v9L14 22.5 7 18.5v-9L14 5.5Z" fill="none" stroke="#EDE9FE" stroke-width="2" />
      <circle cx="14" cy="14" r="3.2" fill="#A78BFA" />
      <path d="M16.4 16.4 20.5 20.5" stroke="#FFFFFF" stroke-width="2.1" stroke-linecap="round" />
    </svg>`,
  gemini: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-eng-gm" x1="4" y1="4" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#3B82F6" />
          <stop offset="55%" stop-color="#8B5CF6" />
          <stop offset="100%" stop-color="#EC4899" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#0F172A" />
      <path d="M14 5.2c1.2 4.8 4 7.6 8.8 8.8-4.8 1.2-7.6 4-8.8 8.8-1.2-4.8-4-7.6-8.8-8.8 4.8-1.2 7.6-4 8.8-8.8Z" fill="url(#astand-eng-gm)" />
    </svg>`,
  "cursor-cli": BRAND_ICONS.cursor,
  "claude-code": BRAND_ICONS["claude-code"],
  antigravity: BRAND_ICONS.antigravity,
  api: `
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="25" height="25" rx="6.5" fill="#F3F4F6" stroke="#D1D5DB" />
      <path d="M9.5 10.5 6.5 14l3 3.5M18.5 10.5l3 3.5-3 3.5M15.2 9.5l-2.4 9" fill="none" stroke="#374151" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`,
};

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

/** Returns a full-colour brand mark for a known CLI engine or API provider. */
export function engineIconSvg(engineId, size = 24) {
  const key = String(engineId || "").trim().toLowerCase();
  const raw = ENGINE_ICONS[key] || ENGINE_ICONS[normalizeClientIconKey(key)] || ENGINE_ICONS.api;
  return raw.replace(/width="\d+"\s+height="\d+"/, `width="${size}" height="${size}"`);
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
