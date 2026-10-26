// units.js - unit conversion, number parsing (fractions) and display formatting. Pure.

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const ML_PER_OZ = 29.5735295625;
export const G_PER_OZ = 28.3495;
/** Largest amount accepted for one diary entry: servings, and grams. */
export const MAX_QTY = 10000;
export const MAX_GRAMS = 10000;
/** Sanity limits for typed numbers, one place for every field (a typo of an extra zero must not wreck a day's totals). */
export const LIMITS = {
  kcal: 10000, // one entry, one exercise, one custom-food serving
  macroGrams: 2000, // protein / carbs / fat in one quick-add entry
  exerciseMinutes: 1440, // a day
  exerciseKcal: 5000, // calories burned in one exercise entry
  calorieOverride: { min: 500, max: 10000 },
  waterGoal: { oz: 340, ml: 10000 },
  weight: 1500, // in the displayed unit (lb or kg)
  servings: 1000, // servings a recipe makes
  cookedGrams: 100000,
  nutrientTarget: 100000,
};
/** Largest value for one nutrient amount in a custom food, by unit. */
export const maxForUnit = (unit) => (unit === 'kcal' ? LIMITS.kcal : unit === 'g' ? MAX_GRAMS : 100000);

/** @param {number} n @returns {string} "10,000" */
const fmtLimit = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Say what is wrong with a typed number, in plain words and naming the limit that was broken. Empty string = fine.
 * @param {number|null} n parsed value (null when the text is not a number)
 * @param {{label?:string, unit?:string, min?:number, max?:number, allowZero?:boolean, raw?:string}} [o] `raw` is the typed text, used to explain an unclear comma
 * @returns {string}
 */
export function rangeProblem(n, o = {}) {
  const name = o.label || 'This value';
  const unit = o.unit ? ` ${o.unit}` : '';
  if (n == null && o.raw != null && ambiguousNumber(o.raw)) return `${name}: "${String(o.raw).trim()}" is unclear. Use a point for decimals (1.5) and no commas for thousands (1200).`;
  if (n == null || !Number.isFinite(n)) return `${name} must be a number.`;
  if (n === 0 && !o.allowZero) return `${name} must be above 0.`;
  if (o.max != null && n > o.max) return `${name} can be at most ${fmtLimit(o.max)}${unit}.`;
  if (o.min != null && n < o.min) return `${name} must be at least ${fmtLimit(o.min)}${unit}.`;
  return '';
}

/**
 * Check the Amount of a diary entry. The message names the limit the person actually typed against:
 * servings, grams, or (when a serving weighs something) the grams it comes to.
 * @param {number} n parsed amount, above 0
 * @param {{label?:string, grams?:number|null}} serving the unit chosen
 * @returns {string} '' when fine
 */
export function amountProblem(n, serving) {
  const g = serving && serving.grams > 0 ? serving.grams : null;
  if (serving && serving.label === 'g') return n > MAX_GRAMS ? `One entry can hold at most ${fmtLimit(MAX_GRAMS)} g.` : '';
  if (n > MAX_QTY) return `One entry can hold at most ${fmtLimit(MAX_QTY)} servings.`;
  if (g && n * g > MAX_GRAMS) return `That comes to ${fmtLimit(Math.round(n * g))} g. One entry can hold at most ${fmtLimit(MAX_GRAMS)} g, so try a smaller amount.`;
  return '';
}

/** @param {number} kg @returns {number} */
export const kgToLb = (kg) => kg / KG_PER_LB;
/** @param {number} lb @returns {number} */
export const lbToKg = (lb) => lb * KG_PER_LB;
/** @param {number} cm @returns {number} */
export const cmToIn = (cm) => cm / CM_PER_IN;
/** @param {number} inch @returns {number} */
export const inToCm = (inch) => inch * CM_PER_IN;
/** @param {number} ml @returns {number} */
export const mlToOz = (ml) => ml / ML_PER_OZ;
/** @param {number} oz @returns {number} */
export const ozToMl = (oz) => oz * ML_PER_OZ;

/**
 * Split centimetres into whole feet and inches (inches rounded; 12 in carries to a foot).
 * @param {number} cm
 * @returns {{ft:number, in:number}}
 */
export function cmToFtIn(cm) {
  const total = Math.round(cmToIn(cm));
  return { ft: Math.floor(total / 12), in: total % 12 };
}

/**
 * @param {number} ft
 * @param {number} inch
 * @returns {number} centimetres
 */
export function ftInToCm(ft, inch) {
  return inToCm(ft * 12 + inch);
}

const VULGAR = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅙': 1 / 6, '⅚': 5 / 6, '⅕': 0.2 };

const THOUSANDS = /^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/; // 1,200  12,500  1,234,567  1,234.5 (never a leading 0: "0,250" is a quarter)

/**
 * Parse a user-typed quantity. Accepts "2", "1.5", ".5", "1/2", "1 1/2", "1-1/2", "1½", "½", "1,5" (decimal comma)
 * and "1,200" or "1,234,567" (a comma followed by exactly three digits is a thousands separator).
 * Returns null when the text is not a finite non-negative number, including a comma that could mean either
 * ("1,2345", "1,2,3"); see `ambiguousNumber` for the message.
 * @param {string|number|null|undefined} input
 * @returns {number|null}
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  for (const [ch, v] of Object.entries(VULGAR)) {
    if (s.includes(ch)) {
      const rest = s.replace(ch, '').trim();
      const whole = rest === '' ? 0 : /^\d+$/.test(rest) ? +rest : NaN;
      return Number.isFinite(whole) ? whole + v : null;
    }
  }
  s = s.replace(/\s+/g, ' ');
  if (THOUSANDS.test(s)) s = s.replace(/,/g, '');
  else if (/^\d*,\d{0,2}$/.test(s) || /^0?,\d+$/.test(s)) s = s.replace(',', '.'); // decimal comma: 1,5  0,75  ,5  0,250 (a leading 0 is never a thousands group)
  else if (s.includes(',')) return null; // 1,2345  1,2,3  1.234,5: could be a decimal or a thousands mark, so do not guess
  let m = /^(\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)$/.exec(s); // 1 1/2
  if (m) return +m[3] === 0 ? null : +m[1] + +m[2] / +m[3];
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(s); // 1/2
  if (m) return +m[2] === 0 ? null : +m[1] / +m[2];
  if (/^(\d+\.?\d*|\.\d+)$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * True when the text is made of digits with a comma that parseAmount refuses to guess about ("1,2345", "12,34,567", "1.234,5").
 * @param {string} raw
 * @returns {boolean}
 */
export function ambiguousNumber(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return s.includes(',') && /^[\d,.\s]+$/.test(s) && parseAmount(s) == null;
}

/**
 * Trim a number to at most `dp` decimals without trailing zeros ("1.50" -> "1.5").
 * @param {number} n
 * @param {number} [dp]
 * @returns {string}
 */
export function trimNum(n, dp = 2) {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1e21) return `${n < 0 ? '-' : ''}${BigInt(Math.round(Math.abs(n))).toString()}`; // toFixed would switch to exponent form
  const s = n.toFixed(dp);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Thousands-separated integer ("1,850"). Non-finite -> "0".
 * @param {number} n
 * @returns {string}
 */
export function fmtInt(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n);
  const digits = Math.abs(r) >= 1e21 ? BigInt(Math.abs(r)).toString() : String(Math.abs(r)); // String(1e22) is "1e+22"; never group an exponent
  const s = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (r < 0 ? '-' : '') + s;
}

/**
 * Format a decimal quantity for a qty field: 1.5 -> "1.5", 0.3333 -> "0.33".
 * @param {number} q
 * @returns {string}
 */
export function formatQty(q) {
  return trimNum(q, 2);
}

/**
 * Weight in the user's unit, rounded to 0.1.
 * @param {number} kg
 * @param {'lb'|'kg'} unit
 * @returns {number}
 */
export function weightToDisplay(kg, unit) {
  const v = unit === 'lb' ? kgToLb(kg) : kg;
  return Math.round(v * 10) / 10;
}

/**
 * @param {number} value value in the user's unit
 * @param {'lb'|'kg'} unit
 * @returns {number} kg
 */
export function weightFromDisplay(value, unit) {
  return unit === 'lb' ? lbToKg(value) : value;
}

/**
 * "176.4 lb" / "80.0 kg".
 * @param {number|null|undefined} kg
 * @param {'lb'|'kg'} unit
 * @returns {string} "-" when unknown
 */
export function formatWeight(kg, unit) {
  if (kg == null || !Number.isFinite(kg)) return '-';
  return `${weightToDisplay(kg, unit).toFixed(1)} ${unit}`;
}

/**
 * Height text: 5'10" or "178 cm".
 * @param {number|null|undefined} cm
 * @param {'ftin'|'cm'} mode
 * @returns {string}
 */
export function formatHeight(cm, mode) {
  if (cm == null || !Number.isFinite(cm)) return '-';
  if (mode === 'cm') return `${Math.round(cm)} cm`;
  const { ft, in: i } = cmToFtIn(cm);
  return `${ft}'${i}"`;
}

/**
 * Water amount in the user's unit: "64 oz" / "1,500 ml".
 * @param {number} ml
 * @param {'oz'|'ml'} unit
 * @returns {string}
 */
export function formatWater(ml, unit) {
  const v = unit === 'oz' ? Math.round(mlToOz(ml || 0)) : Math.round((ml || 0) / 10) * 10;
  return `${fmtInt(v)} ${unit}`;
}

/**
 * Size in ml of one "glass" tap: 8 oz or 250 ml.
 * @param {'oz'|'ml'} unit
 * @returns {number}
 */
export function glassMl(unit) {
  return unit === 'oz' ? ozToMl(8) : 250;
}

/**
 * Weekly pace choices for the goal picker, in the user's unit, each with its kg value.
 * @param {'lb'|'kg'} unit
 * @returns {{label:string, kg:number}[]}
 */
export function paceChoices(unit) {
  return unit === 'lb'
    ? [0.5, 1, 1.5, 2].map((lb) => ({ label: `${lb} lb / week`, kg: lbToKg(lb) }))
    : [0.25, 0.5, 0.75, 1].map((kg) => ({ label: `${kg} kg / week`, kg }));
}

/**
 * Tidy a USDA portion label for display.
 * "1 serving 9 servings per 24 oz package" -> "1 serving (1/9 of 24 oz package)"; "1 serving 1 serving per 8 oz box" -> "1 serving (whole 8 oz box)";
 * "1 NLEA serving" -> "1 serving (label)"; "3/4 cup (1 NLEA serving)" -> "3/4 cup (label serving)"; "2 oz 1 NLEA serving" -> "2 oz (label serving)".
 * A phrase written twice at the end ("1 serving 8 fl oz 8 fl oz") is kept once. Safe to call on a label that is already tidy.
 * @param {string} label
 * @returns {string}
 */
export function cleanLabel(label) {
  let t = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+(\d+(?:\.\d+)?)\s+servings?\s+per\s+([^()]*?(?:package|pkg|box|container|bag|can|bottle|jar))\b/i, (m, n, pkg) => (+n > 1 ? ` (1/${n} of ${pkg})` : ` (whole ${pkg})`));
  t = t.replace(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)\s+NLEA\s+serving$/i, '$1 serving (label)'); // the whole label is "N NLEA serving"
  t = t.replace(/\(\s*(?:\d+\s+)?NLEA\s+serving/gi, '(label serving'); // "(1 NLEA serving)", "(NLEA serving)", "(1 NLEA serving for adults)"
  t = t.replace(/\s+\d+\s+NLEA\s+serving$/i, ' (label serving)'); // "2 oz 1 NLEA serving"
  t = t.replace(/\bNLEA\s+/gi, 'label ').replace(/\bNLEA\b/gi, 'label');
  t = t.replace(/^(.*?)\s*(\d+(?:\.\d+)?(?:\/\d+)?\s+(?:fl\s+)?[a-z]+)\s+\2$/i, (m, head, dup) => `${head} ${dup}`.trim());
  return t;
}

/**
 * Shorten a long serving label for a select/row ("1 chop, excluding refuse (yield from ...)" -> "1 chop, excluding refuse"), after cleanLabel.
 * Callers keep the full label in a title/tooltip.
 * @param {string} label
 * @param {number} [max]
 * @returns {string}
 */
export function shortLabel(label, max = 46) {
  const s = cleanLabel(label);
  if (s.length <= max) return s;
  const cut = s.indexOf(' (');
  if (cut >= 4 && cut <= max) return `${s.slice(0, cut)}…`;
  const hard = s.slice(0, max - 1);
  const sp = hard.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? hard.slice(0, sp) : hard).replace(/[,\s]+$/, '')}…`;
}
