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
      <defs>
        <linearGradient id="astand-eng-codex" x1="4" y1="2" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#6366F1" />
          <stop offset="100%" stop-color="#4F46E5" />
        </linearGradient>
      </defs>
      <path d="M14 2.2 24 8v12l-10 5.8L4 20V8l10-5.8Z" fill="url(#astand-eng-codex)" />
      <path d="m9.5 11.2 3.2 2.8-3.2 2.8" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M14.5 17h4.2" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" />
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
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="astand-eng-doubao" x1="3" y1="3" x2="25" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38BDF8" />
          <stop offset="52%" stop-color="#2563EB" />
          <stop offset="100%" stop-color="#4F46E5" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="url(#astand-eng-doubao)" />
      <circle cx="14" cy="13.8" r="6.6" fill="#FFFFFF" />
      <circle cx="11.6" cy="13.3" r="1.25" fill="#1E3A8A" />
      <circle cx="16.4" cy="13.3" r="1.25" fill="#1E3A8A" />
      <path d="M11.6 16.4c1.3 1.2 3.5 1.2 4.8 0" fill="none" stroke="#2563EB" stroke-width="1.5" stroke-linecap="round" />
    </svg>`,
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
