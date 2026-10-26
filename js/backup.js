// backup.js - PURE: backup file building/validation and CSV export. No DOM, no storage.
import { COLLECTIONS } from './sync-core.js';
import { NUTRIENTS, sumNutrients, entryTotal } from './nutrition.js';

export const BACKUP_VERSION = 1;

/**
 * Build the JSON backup object. Tombstones and local-only fields are dropped.
 * @param {Record<string, Object[]>} collections
 * @param {number} [now]
 * @returns {{app:'intake', version:number, exportedAt:number, collections:Record<string, Object[]>}}
 */
export function buildBackup(collections, now = Date.now()) {
  const out = {};
  for (const c of COLLECTIONS) {
    out[c] = (collections[c] || []).filter((r) => r && !r.deleted).map(cleanRecord);
  }
  return { app: 'intake', version: BACKUP_VERSION, exportedAt: now, collections: out };
}

/** Strip local-only underscore fields. */
function cleanRecord(rec) {
  const o = {};
  for (const [k, v] of Object.entries(rec)) if (!k.startsWith('_')) o[k] = v;
  return o;
}

/**
 * Validate a parsed backup. Never throws; returns usable records and human-readable problems.
 * @param {*} json
 * @returns {{ok:boolean, error?:string, collections:Record<string, Object[]>, skipped:number}}
 */
export function parseBackup(json) {
  const empty = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  if (!json || typeof json !== 'object' || json.app !== 'intake' || typeof json.collections !== 'object' || !json.collections) {
    return { ok: false, error: 'This file is not an Intake backup.', collections: empty, skipped: 0 };
  }
  if (typeof json.version === 'number' && json.version > BACKUP_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of Intake.', collections: empty, skipped: 0 };
  }
  let skipped = 0;
  const out = {};
  for (const c of COLLECTIONS) {
    const list = Array.isArray(json.collections[c]) ? json.collections[c] : [];
    out[c] = [];
    for (const r of list) {
      if (r && typeof r === 'object' && typeof r.id === 'string' && r.id && Number.isFinite(r.updatedAt)) {
        out[c].push({ ...cleanRecord(r), deleted: !!r.deleted });
      } else skipped++;
    }
  }
  return { ok: true, collections: out, skipped };
}

/**
 * Quote one CSV field (RFC 4180) and neutralise spreadsheet formula injection.
 * @param {*} v
 * @returns {string}
 */
export function csvField(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {Array<Array<*>>} rows @returns {string} */
export function toCsv(rows) {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : '');

/**
 * Food log CSV: one row per entry with totals for all 16 nutrients.
 * @param {Object[]} logs foodLogs (live)
 * @param {string[]} mealNames
 * @returns {string}
 */
export function foodLogCsv(logs, mealNames) {
  const head = ['date', 'meal', 'food', 'brand', 'amount', 'unit', ...NUTRIENTS];
  const rows = [head];
  const sorted = logs.slice().sort((a, b) => (a.date === b.date ? (a.meal - b.meal) || (a.createdAt - b.createdAt) : a.date < b.date ? -1 : 1));
  for (const e of sorted) {
    const t = entryTotal(e);
    rows.push([e.date, mealNames[e.meal] || `Meal ${e.meal + 1}`, e.name, e.brand || '', round(e.qty, 3), e.serving ? e.serving.label : '', ...NUTRIENTS.map((k) => (t[k] == null ? '' : round(t[k], 2)))]);
  }
  return toCsv(rows);
}

/**
 * Weights CSV in kg and lb.
 * @param {Array<{date:string, kg:number}>} weights
 * @returns {string}
 */
export function weightsCsv(weights) {
  const rows = [['date', 'kg', 'lb']];
  for (const w of weights.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) rows.push([w.date, round(w.kg, 2), round(w.kg / 0.45359237, 1)]);
  return toCsv(rows);
}

/**
 * Daily totals CSV (kcal + macros + exercise) - handy for spreadsheets.
 * @param {Object[]} logs
 * @param {Object[]} exercise
 * @returns {string}
 */
export function dailyTotalsCsv(logs, exercise) {
  const days = new Map();
  for (const e of logs) {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(entryTotal(e));
  }
  const ex = new Map();
  for (const x of exercise) ex.set(x.date, (ex.get(x.date) || 0) + (x.kcal || 0));
  const rows = [['date', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'exercise_kcal']];
  for (const d of [...days.keys()].sort()) {
    const { total } = sumNutrients(days.get(d));
    rows.push([d, round(total.kcal, 0), round(total.protein), round(total.carbs), round(total.fat), ex.get(d) || 0]);
  }
  return toCsv(rows);
}
