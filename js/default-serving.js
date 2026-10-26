// default-serving.js - PURE: choose the most plausible default serving for a USDA food (the amount the "+" button logs).
// USDA lists portions in arbitrary order ("1 cup, mashed" before "1 medium", "1 stick" of butter, "1 unit (yield from 1 lb...)").
// Each portion gets a plausibility score from the kind of food and the kind of unit; the best one goes first.
import { parseAmount, cleanLabel } from './units.js';

export { cleanLabel };

const SIZE_WORDS = new Set(['medium', 'large', 'small', 'extra', 'jumbo']);
/** Units that mean one natural piece of the food. */
const ITEM_UNITS = new Set(['slice', 'slices', 'piece', 'pieces', 'egg', 'fruit', 'patty', 'link', 'bar', 'cookie', 'breast', 'thigh', 'drumstick', 'fillet',
  'potato', 'pancake', 'waffle', 'muffin', 'roll', 'biscuit', 'tortilla', 'wing', 'chop', 'steak', 'sandwich', 'doughnut', 'ear', 'strip', 'pat', 'leg', 'burrito', 'taco', 'bagel',
  'banana', 'apple', 'orange', 'tomato', 'onion', 'carrot', 'pepper', 'cutlet', 'frankfurter', 'hot', 'sausage']);
/** Units of a counted portion: "10 fries", "10 strips", "6 nuggets". Only when the count is above 1. */
const COUNT_UNITS = new Set(['fries', 'fry', 'strip', 'strips', 'nugget', 'nuggets', 'wedge', 'wedges', 'ring', 'rings', 'piece', 'pieces']);
const SERVING_UNITS = new Set(['serving', 'nlea', 'portion', 'container', 'individual', 'each', 'unit', 'item', 'order', 'packet']);
const BULK_UNITS = new Set(['package', 'jar', 'can', 'bottle', 'bag', 'box', 'loaf', 'pizza', 'pie', 'cake', 'roast', 'carton', 'quart', 'pint', 'gallon', 'lb', 'liter', 'stick',
  'cubic', 'head', 'melon', 'bunch', 'whole', 'recipe', 'bird', 'back', 'rack', 'pan', 'drink']);

const COOKED_NAME = /\b(cooked|boiled|steamed|canned|stewed|frozen|drained|prepared|baked|roasted|micro?waved|simmered|with water)\b/;
const SPREAD_NAME = /\b(butter|paste|tahini|spread|hummus|jam|jams|jelly|jellies|preserves|marmalade|honey|syrup|syrups|molasses|sauce|ketchup|catsup|mustard|salsa|dip|gravy|dressing|vinegar|extract|seasoning|relish|pickle|miso|cream)\b/;
const HEAD_SPREAD = /^(catsup|ketchup|relish|pickle relish|salsa|sauce|mustard|vinegar|hummus|guacamole|dip)\b/;
const FAT_NAME = /^(butter|margarine|shortening|lard|oil|mayonnaise|salad dressing|ghee|tallow|fat|spread|margarine-like)\b/;

/**
 * Split a portion label into amount, unit word and kind. "1 1/2 cup, diced" -> {amount:1.5, unit:'cup'}.
 * @param {string} label
 * @returns {{lower:string, amount:number|null, rest:string, unit:string, ozTotal:number|null}}
 */
export function parsePortion(label) {
  const lower = String(label == null ? '' : label).toLowerCase().replace(/\s+/g, ' ').trim();
  const m = /^(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)\s*(.*)$/.exec(lower);
  const amount = m ? parseAmount(m[1]) : null;
  const rest = m ? m[2] : lower;
  const unit = (/^[a-z]+/.exec(rest.replace(/^\(.*?\)\s*/, '')) || [''])[0];
  let ozTotal = null;
  if (unit === 'oz' && amount != null) ozTotal = amount;
  else {
    const p = /\((\d+(?:\.\d+)?)\s*oz\)/.exec(lower);
    if (p) ozTotal = amount != null ? amount * +p[1] : +p[1];
  }
  return { lower, amount, rest, unit, ozTotal };
}

/** The coarse kind of a portion. */
function kindOf(p) {
  if (/yield|refuse/.test(p.lower)) return 'yield';
  const u = p.unit;
  if (u === 'tbsp' || u === 'tablespoon') return 'tbsp';
  if (u === 'tsp' || u === 'teaspoon') return 'tsp';
  if (u === 'cup' || u === 'cups') return 'cup';
  if (u === 'fl') return 'floz';
  if (u === 'oz') return 'oz';
  if (SIZE_WORDS.has(u)) return 'size';
  if (u === 'serving' && /\bcup\b/.test(p.lower)) return 'cup';
  if (COUNT_UNITS.has(u) && p.amount != null && p.amount > 1 && p.amount <= 20) return 'count';
  if (ITEM_UNITS.has(u)) return 'item';
  if (SERVING_UNITS.has(u)) return 'serving';
  if (BULK_UNITS.has(u)) return 'bulk';
  if (/\bcup\b/.test(p.lower)) return 'cup';
  return 'other';
}

/** Which kind of food this is, from its USDA group, its name and what portions it offers. */
function classify(name, group, kcal100, kinds) {
  const n = name.toLowerCase();
  const has = (k) => kinds.includes(k);
  if (/^egg\b/.test(n) && has('size')) return 'egg';
  if (/^(soup|broth|stock)\b/.test(n) && !/\b(dry|dehydrated|mix|powder|instant)\b/.test(n)) return 'cooked'; // dry ramen and soup mixes are dense foods
  if (kcal100 <= 130 && (has('floz') || group === '14' || /\b(juice|milk|beverage|drink|coffee|tea|smoothie|nectar|lemonade|cocoa)\b/.test(n)) && has('cup') && !/\b(dry|powder|mix|instant|dehydrated|concentrate|frozen)\b/.test(n)) return 'liquid';
  if (group === '14' && kcal100 <= 130 && has('floz')) return 'liquid';
  if (/^(sugars?|salt)\b/.test(n) || group === '02') return 'tsp';
  if (group === '04' || FAT_NAME.test(n)) return kcal100 >= 150 ? 'fat' : 'spread';
  if (/^cheese, (cottage|ricotta)/.test(n)) return 'cooked';
  if (/^cheese\b/.test(n) && !/spread|sauce|cream/.test(n)) return 'cheese';
  if (group === '12' && !/\b(butter|paste|milk|oil|cream|flour|meal)\b/.test(n)) return 'nut';
  if (group === '20' && kcal100 >= 300 && (/\bdry\b/.test(n) || !COOKED_NAME.test(n))) return 'dry'; // rice, pasta, grains, flour by the dry measure
  if (group === '16' && kcal100 >= 250 && /\b(dry|raw|uncooked|dried)\b/.test(n) && !COOKED_NAME.test(n)) return 'dry'; // beans and lentils
  if (HEAD_SPREAD.test(n) && (has('tbsp') || has('tsp'))) return 'spread';
  if (SPREAD_NAME.test(n) && (has('tbsp') || has('tsp')) && !['09', '11', '05', '10', '13', '15'].includes(group)) return 'spread';
  if (['05', '10', '13', '15', '17'].includes(group)) return kcal100 >= 400 ? 'dense' : 'meat';
  if (['08', '11', '16', '20', '06', '22'].includes(group) && COOKED_NAME.test(n)) return 'cooked';
  if (group === '09' || group === '11') return 'produce';
  if (kcal100 >= 350) return 'dense';
  return 'generic';
}

/** Typical gram weight of one default serving, used only to break ties between similar units. */
const TARGET_G = { liquid: 240, fat: 14, spread: 16, tsp: 4, nut: 28, cheese: 28, meat: 90, cooked: 200, produce: 150, dense: 35, egg: 50, generic: 100, dry: 50 };

/** Base preference per kind of unit, by class (0-100). */
const BASE = {
  generic: { size: 80, item: 80, serving: 70, cup: 60, oz: 40, floz: 30, tbsp: 30, tsp: 20, bulk: 10, other: 25 },
  egg: { size: 80, item: 80, serving: 50, cup: 30, oz: 20, tbsp: 15, tsp: 10, bulk: 5, other: 20 },
  liquid: { cup: 100, floz: 20, serving: 70, size: 40, item: 40, bulk: 40, oz: 15, tbsp: 5, tsp: 5, other: 20 },
  fat: { tbsp: 90, tsp: 70, item: 70, serving: 60, cup: 20, oz: 30, size: 30, bulk: 5, floz: 25, other: 15 },
  spread: { tbsp: 90, tsp: 70, serving: 60, item: 55, cup: 25, oz: 30, size: 30, bulk: 10, floz: 40, other: 20 },
  tsp: { tsp: 90, tbsp: 70, serving: 60, item: 55, cup: 15, oz: 25, size: 30, bulk: 5, other: 15 },
  nut: { oz: 95, serving: 70, cup: 40, item: 40, size: 40, tbsp: 30, tsp: 15, bulk: 5, other: 20 },
  cheese: { item: 92, oz: 90, serving: 80, size: 60, cup: 30, tbsp: 20, tsp: 10, bulk: 5, other: 20 },
  meat: { oz: 40, item: 80, size: 80, serving: 70, cup: 30, tbsp: 10, tsp: 5, bulk: 10, other: 25 },
  cooked: { cup: 85, item: 75, size: 75, serving: 70, oz: 40, floz: 30, tbsp: 20, tsp: 10, bulk: 15, other: 25 },
  produce: { size: 90, item: 82, serving: 62, cup: 65, oz: 35, floz: 30, tbsp: 20, tsp: 10, bulk: 10, other: 25 },
  dense: { item: 80, size: 80, serving: 75, oz: 70, cup: 55, tbsp: 30, tsp: 15, bulk: 10, other: 25 },
  dry: { oz: 80, cup: 50, serving: 70, item: 60, size: 60, tbsp: 20, tsp: 10, bulk: 10, floz: 10, other: 25 },
};

const CUP_AMOUNT = (a) => (a === 1 ? 0 : a === 0.5 ? -5 : a != null && a < 1 ? -10 : a === 2 ? -25 : -35);

/**
 * Plausibility score of one portion for a food (higher is better). Exported for tests.
 * @param {{label:string, grams:number}} portion
 * @param {{name:string, group:string, kcal100:number|null}} food
 * @param {string} [cls] food class (computed when omitted)
 * @returns {number}
 */
export function scorePortion(portion, food, cls) {
  const p = parsePortion(portion.label);
  const kind = kindOf(p);
  const kcal100 = Number.isFinite(food.kcal100) ? food.kcal100 : 0;
  const g = portion.grams;
  const kcal = (g * kcal100) / 100;
  const c = cls || 'generic';
  const base = BASE[c] || BASE.generic;
  let s = kind === 'yield' ? 0 : base[kind] ?? 25;
  const amount = p.amount;
  if (kind === 'cup') {
    s += CUP_AMOUNT(amount);
    if (g > 300) s -= 20;
    if (c === 'produce' && kcal > 200) s -= (kcal - 200) / 4; // a cup of avocado or dried fruit is a lot of calories for one helping
    if (kcal > 300 && kcal100 >= 280) s -= (kcal - 300) / 2.5; // a cup of an energy-dense food (dry grains, granola, meatless bacon) is a meal, not one serving
    if (c === 'dry' && amount != null && amount <= 0.34) s += 40; // 1/4 cup and 1/3 cup dry are the label servings
    if (/pur[eé]e|mashed/.test(p.lower)) s -= 12; // "1 cup, pureed" is an ingredient measure, not a helping
  } else if (kind === 'tbsp' || kind === 'tsp') {
    if (amount === 2 && c === 'spread' && /\b(nut|peanut|almond|cashew|seed)/i.test(food.name)) s += 5;
    else if (amount !== 1) s -= amount === 2 ? 5 : 12;
  } else if (kind === 'item' || kind === 'size') {
    const floor = c === 'dense' ? 5 : c === 'produce' ? 40 : 15;
    if (g < floor || g > 350) s = Math.min(s, c === 'produce' && g >= 15 ? 55 : 30);
    if (amount !== 1) s -= amount === 0.5 ? 3 : 15;
    if (/\bmedium\b/.test(p.lower)) s += 10;
    else if (/\blarge\b/.test(p.lower) && !/extra|jumbo/.test(p.lower)) s += 8;
    else if (/extra|jumbo/.test(p.lower)) s -= 5;
    if (c === 'egg' && /\blarge\b/.test(p.lower) && !/extra/.test(p.lower)) s += 15;
  } else if (kind === 'count') {
    // "10 fries", "10 strips": a counted portion is how these foods are eaten
    s = (base.item ?? 70) - 6;
    if (g < 30 || g > 250) s = Math.min(s, 30);
  } else if (kind === 'oz') {
    if (c === 'meat') {
      if (p.ozTotal != null && p.ozTotal >= 3 && p.ozTotal <= 4) s = p.ozTotal === 3 ? 90 : 86;
    } else if (c === 'dry' && amount === 2) s += 4; // 2 oz dry pasta is the label serving
    else if (amount !== 1) s -= amount >= 2 && amount <= 3.2 ? 2 : 20;
  } else if (kind === 'bulk') {
    // one small package ("1 package without flavor packet", 81 g) is a single serving; big ones stay penalised
    if (amount === 1 && g >= 30 && g <= 130 && kcal <= 400 && !['liquid', 'fat', 'spread', 'tsp'].includes(c) && !/\bmix\b/.test(food.name.toLowerCase())) s = Math.max(s, base.serving ?? 70);
  } else if (kind === 'floz') {
    s = amount === 8 ? 100 : amount === 6 ? 90 : base.floz ?? 20;
  } else if (kind === 'other') {
    // An unlisted noun with a count of one ("1 croissant, medium", "1 date, pitted") is a countable item.
    if (amount === 1 && g >= 15 && g <= 350 && !['liquid', 'fat', 'spread', 'tsp', 'nut'].includes(c)) {
      s = Math.max(s, (base.item ?? 80) - 10);
      if (/\bmedium\b/.test(p.lower)) s += 10;
      else if (/\blarge\b/.test(p.lower)) s += 8;
    }
  } else if (kind === 'serving') {
    if (amount !== 1 && !/nlea/.test(p.lower)) s -= 15;
    if (c === 'meat' && p.ozTotal != null && p.ozTotal >= 3 && p.ozTotal <= 4) s = 89;
    if (/nlea/.test(p.lower)) s += 5;
    if (g < 5 && c !== 'tsp') s -= 20;
    if (g < 10 && kcal100 >= 150 && ['generic', 'dense', 'cooked', 'produce', 'meat', 'dry'].includes(c)) s -= 40; // a seasoning packet is not the food
  }
  if (kind === 'cup' && /nlea/.test(p.lower)) s += 5;
  if (c === 'produce' && kcal > 250 && ['item', 'size', 'other'].includes(kind)) s -= (kcal - 250) * 0.5; // a whole avocado is a lot; a listed label serving is the better default
  // plausibility of the resulting amount
  const target = TARGET_G[c] || 100;
  s -= 4 * Math.abs(Math.log(Math.max(g, 0.5) / target));
  if (/yield|refuse/.test(p.lower)) s -= 200;
  if (kcal > 600) s -= 120;
  if (g > 400) s -= 120;
  if (kcal < 5 && kcal100 >= 10 && kind !== 'tsp') s -= 60;
  return s;
}

/**
 * Fluid ounces of one standard drink for an alcoholic beverage (beer 12, wine 5, spirits 1.5), or null.
 * @param {string} name
 * @returns {number|null}
 */
export function pourOz(name) {
  const n = String(name || '').toLowerCase();
  const m = /^alcoholic bev[a-z]*,\s*([a-z ]+)/.exec(n); // the kind is the segment right after "Alcoholic beverage," (cocktails and mixes are not a pour)
  if (!m || /cooking/.test(n)) return null;
  const kind = m[1].trim();
  if (kind === 'beer') return 12;
  if (kind === 'wine') return 5;
  if (/^(distilled|liqueur|creme de|schnapps|cordial)\b/.test(kind)) return 1.5;
  return null;
}

/** Total fluid ounces a portion label stands for: "12 fl oz", "1 can or bottle (12 fl oz)", "1 Jigger 1.5 fl oz". Null when it names none. */
function flOzOf(label) {
  const all = [...String(label).toLowerCase().matchAll(/(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)\s*fl\.?\s*oz/g)];
  return all.length ? parseAmount(all[all.length - 1][1]) : null;
}

/**
 * Order USDA portions best-default first. Adds a standard drink for alcohol (beer 12 fl oz, wine 5 fl oz, spirits 1.5 fl oz),
 * "8 fl oz" for a drink that only lists "1 fl oz", and "1/4 cup" for dry rice and grains that only list "1 cup".
 * Labels are tidied with cleanLabel.
 * @param {{name:string, group?:string|number, kcal100:number|null, servings:Array<{label:string, grams:number}>}} food
 * @returns {Array<{label:string, grams:number}>}
 */
export function orderServings(food) {
  const group = food.group == null ? '' : String(food.group).padStart(2, '0');
  const list = (food.servings || []).map((s, i) => ({ label: s.label, grams: s.grams, i }));
  const f = { name: String(food.name || ''), group, kcal100: food.kcal100 };
  const kinds = list.map((s) => kindOf(parsePortion(s.label)));
  const cls = classify(f.name, group, Number.isFinite(f.kcal100) ? f.kcal100 : 0, kinds);
  const oneFlOz = list.find((s) => /^1 fl oz/i.test(s.label));
  let pinned = null; // the portion that must come first
  const pour = pourOz(f.name);
  if (pour) {
    pinned = list.find((s) => { const oz = flOzOf(s.label); return oz != null && Math.abs(oz - pour) < 0.05; });
    if (!pinned && oneFlOz) { pinned = { label: `${pour} fl oz`, grams: Math.round(oneFlOz.grams * pour * 10) / 10, i: list.length }; list.push(pinned); }
  } else if (cls === 'liquid' && !kinds.includes('cup') && oneFlOz) {
    list.push({ label: '8 fl oz', grams: Math.round(oneFlOz.grams * 8 * 10) / 10, i: list.length });
  } else if (cls === 'dry') {
    const cup = list.find((s) => /^1 cup$/i.test(s.label));
    if (cup && !list.some((s) => /^(1\/4|1\/3) cup/i.test(s.label))) list.push({ label: '1/4 cup', grams: Math.round((cup.grams / 4) * 10) / 10, i: list.length });
  }
  return list
    .map((s) => ({ ...s, score: s === pinned ? 1000 : scorePortion(s, f, cls) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ label, grams }) => ({ label: cleanLabel(label), grams }));
}

/**
 * Food class used to pick the default (exposed for tests and debugging).
 * @param {{name:string, group?:string|number, kcal100:number|null, servings:Array<{label:string}>}} food
 * @returns {string}
 */
export function foodClass(food) {
  const group = food.group == null ? '' : String(food.group).padStart(2, '0');
  const kinds = (food.servings || []).map((s) => kindOf(parsePortion(s.label)));
  return classify(String(food.name || ''), group, Number.isFinite(food.kcal100) ? food.kcal100 : 0, kinds);
}
