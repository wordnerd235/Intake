// dates.js - local-calendar date helpers. A "day" is a local YYYY-MM-DD string.
// All arithmetic goes through Date.UTC / local-noon so DST shifts never move a day.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = (n) => String(n).padStart(2, '0');
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a Date using its LOCAL calendar fields (never UTC).
 * @param {Date} d
 * @returns {string} YYYY-MM-DD
 */
export function fmt(d) {
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Today's local date.
 * @param {Date} [now]
 * @returns {string}
 */
export function today(now = new Date()) {
  return fmt(now);
}

/**
 * True when s is a real calendar date in YYYY-MM-DD form.
 * @param {*} s
 * @returns {boolean}
 */
export function isValid(s) {
  if (typeof s !== 'string') return false;
  const m = RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @returns {number}
 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parse YYYY-MM-DD into [y, m, d]. Throws on bad input. */
function parts(s) {
  const m = RE.exec(s);
  if (!m) throw new Error(`Bad date: ${s}`);
  return [+m[1], +m[2], +m[3]];
}

/**
 * Parse to a Date at local noon (so DST changes cannot roll it to another day).
 * @param {string} s
 * @returns {Date}
 */
export function parse(s) {
  const [y, m, d] = parts(s);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Add n days (negative allowed). DST-safe because it counts calendar days in UTC.
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
export function addDays(s, n) {
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * Whole calendar days from a to b (b - a).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function diffDays(a, b) {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * Inclusive list of dates from..to (empty if to < from).
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function range(from, to) {
  const n = diffDays(from, to);
  const out = [];
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/**
 * Day of week, 0 = Sunday.
 * @param {string} s
 * @returns {number}
 */
export function weekday(s) {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Weekday name. style: 'long' | 'short' | 'narrow'
 * @param {string} s
 * @param {'long'|'short'|'narrow'} [style]
 * @returns {string}
 */
export function weekdayLabel(s, style = 'long') {
  const n = WEEKDAYS[weekday(s)];
  return style === 'long' ? n : style === 'short' ? n.slice(0, 3) : n[0];
}

/**
 * Month name for 1-12.
 * @param {number} month
 * @param {boolean} [short]
 * @returns {string}
 */
export function monthName(month, short = false) {
  const n = MONTHS[month - 1] || '';
  return short ? n.slice(0, 3) : n;
}

/**
 * "Fri, Oct 23" (adds the year when it differs from `ref`'s year).
 * @param {string} s
 * @param {string} [ref] reference date for the year check
 * @returns {string}
 */
export function formatDate(s, ref) {
  const [y, m, d] = parts(s);
  const base = `${weekdayLabel(s, 'short')}, ${monthName(m, true)} ${d}`;
  return ref && parts(ref)[0] !== y ? `${base}, ${y}` : base;
}

/**
 * "Oct 23" / "Oct 23, 2025".
 * @param {string} s
 * @param {string} [ref]
 * @returns {string}
 */
export function formatShort(s, ref) {
  const [y, m, d] = parts(s);
  const base = `${monthName(m, true)} ${d}`;
  return ref && parts(ref)[0] !== y ? `${base}, ${y}` : base;
}

/**
 * Friendly label: Today / Yesterday / Tomorrow, else formatDate.
 * @param {string} s
 * @param {string} todayStr
 * @returns {string}
 */
export function relativeLabel(s, todayStr) {
  const d = diffDays(todayStr, s);
  if (d === 0) return 'Today';
  if (d === -1) return 'Yesterday';
  if (d === 1) return 'Tomorrow';
  return formatDate(s, todayStr);
}

/**
 * Age in whole years from a birth year (birthday unknown, so year difference).
 * @param {number} birthYear
 * @param {Date} [now]
 * @returns {number}
 */
export function ageFromBirthYear(birthYear, now = new Date()) {
  return now.getFullYear() - birthYear;
}

/**
 * Meal index (0-3) that fits the clock: <10:30 Breakfast, <15:00 Lunch, <20:30 Dinner, else Snacks.
 * @param {Date} [now]
 * @returns {0|1|2|3}
 */
export function mealForClock(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 10 * 60 + 30) return 0;
  if (mins < 15 * 60) return 1;
  if (mins < 20 * 60 + 30) return 2;
  return 3;
}

/**
 * Consecutive logged days ending today (or yesterday if today has no log yet).
 * @param {Set<string>|string[]} loggedDates
 * @param {string} todayStr
 * @returns {number}
 */
export function streak(loggedDates, todayStr) {
  const set = loggedDates instanceof Set ? loggedDates : new Set(loggedDates);
  let day = set.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/**
 * "3:07 pm" style clock text for a ms timestamp (local).
 * @param {number} ms
 * @returns {string}
 */
export function formatClock(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Start-of-range date for chips like 1M/3M/6M/1Y relative to today.
 * @param {string} todayStr
 * @param {number} months
 * @returns {string}
 */
export function monthsAgo(todayStr, months) {
  const [y, m, d] = parts(todayStr);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
}

/**
 * Birth years the profile accepts: someone aged 13 to 110 this calendar year. Computed on each call, so a copy of the app
 * left open over New Year's Eve does not keep last year's limits.
 * @param {Date} [now]
 * @returns {{min:number, max:number}}
 */
export function birthYearRange(now = new Date()) {
  const y = now.getFullYear();
  return { min: y - 110, max: y - 13 };
}
