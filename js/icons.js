// icons.js - inline stroke icons (24x24 viewBox). No icon fonts, no external assets.
const P = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  diary: '<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 17 20.5H6z"/><path d="M6 3.5v17M9.5 8h5M9.5 11.5h5"/>',
  progress: '<path d="M4 19.5V5M4 19.5h16"/><path d="m7.5 14.5 3.5-4 3 2.5 4.5-6"/>',
  foods: '<path d="M12 7.5c-1.2-1.4-3-2-4.8-1.4C4.8 7 4 9.6 4.8 12.6c.9 3.3 3 6.9 5.1 6.9 1 0 1.3-.5 2.1-.5s1.1.5 2.1.5c2.1 0 4.2-3.6 5.1-6.9.8-3-.0-5.6-2.4-6.5-1.8-.6-3.6 0-4.8 1.4z"/><path d="M12 7.5c0-1.7.7-3 2.2-3.8"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevL: '<path d="m14.5 6-6 6 6 6"/>',
  chevR: '<path d="m9.5 6 6 6-6 6"/>',
  chevD: '<path d="m6 9.5 6 6 6-6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  barcode: '<path d="M4 6v12M7 6v12M11 6v12M14 6v12M17.5 6v12M20 6v12"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
  starFill: '<path fill="currentColor" d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7M10 11v5M14 11v5"/>',
  edit: '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5z"/><path d="m14 8 3 3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  drop: '<path d="M12 3.5c3.2 3.7 5.5 6.6 5.5 9.7a5.5 5.5 0 0 1-11 0c0-3.1 2.3-6 5.5-9.7z"/>',
  scale: '<rect x="4" y="4.5" width="16" height="15" rx="3"/><path d="m9 9.5 3 3 2.5-2.5"/><path d="M8.5 9.5a4.5 4.5 0 0 1 7 0"/>',
  flame: '<path d="M12 3.5c.5 3-1.8 4.3-3.2 6.3-1.3 1.8-1.3 4 .1 5.7 1.1 1.3 2.8 1.8 4.1 1.3 2.4-.9 3.3-3.5 2.2-5.8 1.2.8 2 2 2.1 3.5.2-1.5-.2-3-.9-4.3-1-1.9-3.3-3.2-4.4-6.7z"/>',
  cloud: '<path d="M7 18.5a4 4 0 0 1-.6-7.9 5.5 5.5 0 0 1 10.7 1.3 3.3 3.3 0 0 1-.4 6.6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5"/>',
  bolt: '<path d="m13 3.5-7 10h5l-1 7 7-10h-5z"/>',
  list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4.5M12 17h.01"/>',
  bowl: '<path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-1.5 1.5-1.5 1.5-3M12.5 7c0-1.5 1.5-1.5 1.5-3"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
};

/**
 * Inline SVG markup for a named icon (trusted constants only).
 * @param {string} name
 * @param {number} [size]
 * @returns {string}
 */
export function iconSvg(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}
