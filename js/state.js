// state.js - UI state shared by views: the selected date (persists across tabs) and "today" tracking.
import { bus } from './bus.js';
import { today, isValid } from './dates.js';

let selected = today();
let followToday = true;

/** @returns {string} currently selected YYYY-MM-DD */
export const getDate = () => selected;

/**
 * Select a date and notify listeners.
 * @param {string} d
 */
export function setDate(d) {
  if (!isValid(d) || d === selected) return;
  selected = d;
  followToday = d === today();
  bus.emit('date:change', d);
}

/** Called when the app regains focus: if the user was looking at "today", roll over after midnight. */
export function refreshToday() {
  const t = today();
  if (followToday && selected !== t) {
    selected = t;
    bus.emit('date:change', t);
    return true;
  }
  return false;
}

/** @returns {boolean} true when the selected date is today */
export const isToday = () => selected === today();

/** App-level flags shared with the router gate (set by main.js and the onboarding view). */
export const appFlags = { onboarded: false };
