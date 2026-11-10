// nutrient-rows.js - PURE: how each row of the daily Nutrients table looks (bar, text, color status, note). No DOM.
import { NO_TARGET_KEYS, targetStatus } from './nutrition.js';

/**
 * How one row of the daily nutrients table looks. `status` picks the color ('over' red, 'under'/'met' green, '' none);
 * `bar` is the fill in percent (null: no bar); `note` is a line shown under the row. Total sugars get a plain bar for
 * their share of the day's carbs and never a status. Added sugars note how many foods didn't list them (those are left
 * out of the total, so it is shown "≥" and never called under the limit).
 * @param {string} k nutrient key
 * @param {{total:Record<string,number>, unknown:Record<string,boolean>, missing?:Record<string,number>, count?:number}} sum
 * @param {Object} targets from resolveTargets
 * @returns {{status:'over'|'under'|'met'|'', bar:number|null, text:string, note:string}}
 */
export function nutrientRow(k, sum, targets) {
  const v = sum.total[k] || 0;
  const unknown = !!(sum.unknown && sum.unknown[k]);
  if (NO_TARGET_KEYS.has(k)) {
    const carbs = sum.total.carbs || 0;
    if (!(carbs > 0) || !(v > 0)) return { status: '', bar: null, text: 'no target', note: '' };
    const pct = Math.min(100, (v / carbs) * 100);
    return { status: '', bar: pct, text: `${unknown ? '≥ ' : ''}${Math.round(pct)}% of carbs`, note: '' };
  }
  const t = targets[k] || { value: null, kind: null };
  const st = targetStatus(v, t, unknown);
  const label = { over: 'over limit', under: 'under limit', met: 'goal met' }[st] || '';
  const pct = t.value ? (v / t.value) * 100 : 0;
  const missing = (sum.missing && sum.missing[k]) || 0;
  const count = sum.count || 0;
  const note = k === 'addedSugar' && missing > 0 && count > 0
    ? (missing === count ? (count === 1 ? "This food doesn't list added sugars." : "None of these foods list added sugars.") : `Not listed for ${missing} of ${count} foods, so the real total may be higher.`)
    : '';
  return { status: st, bar: t.value ? Math.min(100, pct) : null, text: t.value ? `${Math.round(pct)}%${label ? ` · ${label}` : ''}` : 'no target', note };
}
