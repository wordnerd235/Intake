// normalize.js - PURE: Open Food Facts / USDA FoodData Central JSON -> internal Food shape.
// Units are the whole point: OFF stores minerals/vitamins in GRAMS per 100 g, FDC mixes MG/UG/G/IU/kJ.
import { NUTRIENTS } from './nutrition.js';

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
/**
 * Text from a field that may arrive as a string, an array, or a language object ({en:..., fr:...} or {main:...}).
 * @param {*} v
 * @returns {string}
 */
export function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const pick = v.main ?? v.en ?? v['en-US'] ?? Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return textOf(pick);
  }
  return '';
}
const r3 = (n) => (n == null ? null : Math.round(n * 1000) / 1000);

/** Title-case text that arrives ALL CAPS (FDC branded descriptions). Leaves mixed case alone. */
export function tidyName(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) {
    return t.toLowerCase().replace(/(^|[\s(\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  }
  return t;
}

// ---------- Open Food Facts ----------

/** key in OFF nutriments (per 100 g) -> [our key, multiplier to our unit]. OFF mineral/vitamin values are grams. */
const OFF_MAP = [
  ['proteins_100g', 'protein', 1],
  ['carbohydrates_100g', 'carbs', 1],
  ['fat_100g', 'fat', 1],
  ['fiber_100g', 'fiber', 1],
  ['sugars_100g', 'sugar', 1],
  ['saturated-fat_100g', 'satFat', 1],
  ['trans-fat_100g', 'transFat', 1],
  ['cholesterol_100g', 'cholesterol', 1000],
  ['sodium_100g', 'sodium', 1000],
  ['potassium_100g', 'potassium', 1000],
  ['calcium_100g', 'calcium', 1000],
  ['iron_100g', 'iron', 1000],
  ['vitamin-c_100g', 'vitC', 1000],
  ['vitamin-a_100g', 'vitA', 1e6],
  ['vitamin-d_100g', 'vitD', 1e6],
];

/**
 * OFF nutriments -> per-100 g nutrients in our units. Returns null when there is no energy value.
 * @param {Object} nm product.nutriments
 * @returns {Record<string, number|null>|null}
 */
export function offNutrients(nm) {
  if (!nm || typeof nm !== 'object') return null;
  let kcal = num(nm['energy-kcal_100g']);
  if (kcal == null) {
    const kj = num(nm['energy_100g']) ?? num(nm['energy-kj_100g']);
    if (kj != null) kcal = kj / 4.184;
  }
  if (kcal == null) return null;
  const out = {};
  for (const k of NUTRIENTS) out[k] = null;
  out.kcal = r3(kcal);
  for (const [src, key, mult] of OFF_MAP) {
    const v = num(nm[src]);
    if (v != null) out[key] = r3(v * mult);
  }
  if (out.sodium == null) {
    const salt = num(nm['salt_100g']);
    if (salt != null) out.sodium = r3((salt / 2.5) * 1000); // salt (g) -> sodium (mg)
  }
  return out;
}

/**
 * Normalize one Open Food Facts product.
 * @param {Object} p product (from /product/{code} or search hits)
 * @returns {Object|null} Food, or null when unusable (no code/name/energy)
 */
export function normalizeOFF(p) {
  if (!p || typeof p !== 'object') return null;
  const code = String(p.code || p._id || '').trim();
  const name = (textOf(p.product_name) || textOf(p.product_name_en) || textOf(p.generic_name)).replace(/\s+/g, ' ').trim();
  if (!code || !name) return null;
  const per100g = offNutrients(p.nutriments);
  if (!per100g) return null;
  const brand = textOf(p.brands).split(',')[0].trim();
  const servings = [];
  const q = num(p.serving_quantity);
  if (q != null && q > 0) {
    const label = textOf(p.serving_size).replace(/\s+/g, ' ').trim() || `${q} g`;
    servings.push({ label, grams: q });
  }
  if (!servings.length) servings.push({ label: '100 g', grams: 100 });
  return { key: `off:${code}`, name, brand, source: 'off', per100g, servings };
}

// ---------- USDA FoodData Central ----------

/** Target [unit] for each key; FDC rows are converted from their own unitName. */
const TARGET_UNIT = { kcal: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g', sugar: 'g', satFat: 'g', transFat: 'g', cholesterol: 'mg', sodium: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg', vitA: 'ug', vitC: 'mg', vitD: 'ug' };

/** FDC nutrient number (string, "208") / id -> our key. Order matters for fallbacks. */
const FDC_IDS = {
  208: 'kcal', 1008: 'kcal', 203: 'protein', 1003: 'protein', 205: 'carbs', 1005: 'carbs', 204: 'fat', 1004: 'fat',
  291: 'fiber', 1079: 'fiber', 269: 'sugar', 2000: 'sugar', 1063: 'sugar', 606: 'satFat', 1258: 'satFat', 605: 'transFat', 1257: 'transFat',
  601: 'cholesterol', 1253: 'cholesterol', 307: 'sodium', 1093: 'sodium', 306: 'potassium', 1092: 'potassium', 301: 'calcium', 1087: 'calcium',
  303: 'iron', 1089: 'iron', 320: 'vitA', 1106: 'vitA', 401: 'vitC', 1162: 'vitC', 328: 'vitD', 1114: 'vitD',
};
const FDC_KJ = new Set(['268', '1062']);
const FDC_VITA_IU = new Set(['318', '1104']);
const FDC_VITD_IU = new Set(['324', '1110']);

/**
 * Convert a value between mass units used by FDC.
 * @param {number} v
 * @param {string} from unitName (G, MG, UG/µG, KCAL, KJ, IU)
 * @param {string} to 'g'|'mg'|'ug'|'kcal'
 * @returns {number|null}
 */
export function convertMass(v, from, to) {
  const f = String(from || '').toLowerCase().replace('µ', 'u').replace('μ', 'u');
  const g = { g: 1, mg: 1e-3, ug: 1e-6, mcg: 1e-6 }[f];
  const t = { g: 1, mg: 1e-3, ug: 1e-6 }[to];
  if (g == null || t == null) return null;
  return (v * g) / t;
}

/**
 * Nutrient rows (per 100 g) -> our nutrients; null when there is no energy.
 * @param {Array<Object>} rows food.foodNutrients
 * @returns {Record<string, number|null>|null}
 */
export function fdcNutrients(rows) {
  if (!Array.isArray(rows)) return null;
  const out = {};
  for (const k of NUTRIENTS) out[k] = null;
  let kj = null;
  let vitAIu = null;
  let vitDIu = null;
  for (const r of rows) {
    if (!r) continue;
    const id = String(r.nutrientNumber ?? r.number ?? r.nutrient?.number ?? ''); // search results use nutrientNumber; the OpenAPI schema names it number
    const nid = String(r.nutrientId ?? r.nutrient?.id ?? '');
    const unit = r.unitName ?? r.nutrient?.unitName ?? '';
    const v = num(r.value ?? r.amount);
    if (v == null) continue;
    if (FDC_KJ.has(id) || FDC_KJ.has(nid)) { kj = v; continue; }
    if (FDC_VITA_IU.has(id) || FDC_VITA_IU.has(nid)) { vitAIu = v; continue; }
    if (FDC_VITD_IU.has(id) || FDC_VITD_IU.has(nid)) { vitDIu = v; continue; }
    const key = FDC_IDS[id] || FDC_IDS[nid];
    if (!key || out[key] != null) continue;
    if (key === 'kcal') {
      out.kcal = String(unit).toLowerCase() === 'kj' ? v / 4.184 : v;
      continue;
    }
    const conv = convertMass(v, unit, TARGET_UNIT[key]);
    if (conv != null) out[key] = r3(conv);
  }
  if (out.kcal == null && kj != null) out.kcal = kj / 4.184;
  if (out.kcal == null) return null;
  out.kcal = r3(out.kcal);
  if (out.vitA == null && vitAIu != null) out.vitA = r3(vitAIu * 0.3); // IU retinol -> µg RAE
  if (out.vitD == null && vitDIu != null) out.vitD = r3(vitDIu * 0.025); // IU -> µg
  return out;
}

/**
 * Normalize one FDC food (Branded search result).
 * @param {Object} f
 * @returns {Object|null}
 */
export function normalizeFDC(f) {
  if (!f || typeof f !== 'object' || f.fdcId == null) return null;
  const name = tidyName(f.description || '');
  if (!name) return null;
  const per100g = fdcNutrients(f.foodNutrients);
  if (!per100g) return null;
  const brand = tidyName(f.brandName || f.brandOwner || '');
  const size = num(f.servingSize);
  const unit = String(f.servingSizeUnit || '').toLowerCase();
  const servings = [];
  if (size != null && size > 0 && ['g', 'grm', 'gm', 'ml', 'mlt'].includes(unit)) {
    const n1 = Math.round(size * 10) / 10;
    const sizeTxt = unit.startsWith('m') ? `${n1} ml, about ${n1} g` : `${n1} g`; // FDC gives no density for liquids: 1 ml is taken as 1 g, and the label says so
    const hh = String(f.householdServingFullText || '').replace(/\s+/g, ' ').trim();
    servings.push({ label: hh ? `${hh} (${sizeTxt})` : sizeTxt, grams: size });
  }
  if (!servings.length) servings.push({ label: '100 g', grams: 100 });
  return { key: `fdc:${f.fdcId}`, name, brand, source: 'fdc', per100g, servings, gtin: f.gtinUpc ? String(f.gtinUpc) : undefined };
}

/**
 * Compare two barcodes ignoring leading zeros (UPC-A vs EAN-13).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameBarcode(a, b) {
  const x = String(a || '').replace(/^0+/, '');
  const y = String(b || '').replace(/^0+/, '');
  return !!x && x === y;
}
