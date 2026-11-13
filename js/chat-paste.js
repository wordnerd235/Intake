// chat-paste.js - PURE: read nutrition pasted from a Claude chat (or any "Label: value" list) into Quick add entries.
// No DOM: views/chat-paste.js shows the result; tests feed it text. Every number goes through units.js parseAmount.
import { NUTRIENT_INFO, emptyNutrients, impossibleAddedSugar } from './nutrition.js';
import { parseAmount, ambiguousNumber, LIMITS, MAX_GRAMS, maxForUnit, fmtInt } from './units.js';

/** What to ask Claude for, so its answer ends with a block Intake can read. Shown with a Copy button in the app. */
export const PROMPT = `When you estimate the nutrition of food for me, end your answer with a block I can paste into my food tracker, Intake. Put it in one code block, in exactly this format, one block per food (or one block for the whole meal if I ask for that), with a blank line between foods:

Intake
Name: <short food name>
Amount: <portion in words> (<grams> g)
Calories: <number>
Protein: <number> g
Carbs: <number> g
Fiber: <number> g
Total sugars: <number> g
Added sugars: <number> g
Fat: <number> g
Saturated fat: <number> g
Trans fat: <number> g
Cholesterol: <number> mg
Sodium: <number> mg
Potassium: <number> mg
Calcium: <number> mg
Iron: <number> mg
Vitamin A: <number> mcg
Vitamin C: <number> mg
Vitamin D: <number> mcg

Rules for the block:
- One number per line, your best single estimate: no ranges and no "~".
- Calories are required. If you don't know another value, write "unknown" (never 0 for unknown).
- Added sugars are the sugars added when the food was made, as on a US label ("Includes 8g Added Sugars"): never more than total sugars. The natural sugar in fruit, vegetables and plain milk is not added.
- Use only the units shown (g, mg, mcg).`;

/** Line labels (lowercase, without brackets or a trailing unit) -> field. Unlisted labels are ignored. */
const LABELS = {
  name: 'name', food: 'name', item: 'name',
  amount: 'amount', portion: 'amount', serving: 'amount', 'serving size': 'amount', weight: 'weight',
  calories: 'kcal', calorie: 'kcal', energy: 'kcal', kcal: 'kcal', cal: 'kcal',
  protein: 'protein',
  carbs: 'carbs', carb: 'carbs', carbohydrate: 'carbs', carbohydrates: 'carbs', 'total carbs': 'carbs', 'total carbohydrate': 'carbs', 'total carbohydrates': 'carbs',
  fiber: 'fiber', fibre: 'fiber', 'dietary fiber': 'fiber', 'dietary fibre': 'fiber',
  'total sugars': 'sugar', 'total sugar': 'sugar', sugars: 'sugar', sugar: 'sugar',
  'added sugars': 'addedSugar', 'added sugar': 'addedSugar', 'includes added sugars': 'addedSugar',
  fat: 'fat', 'total fat': 'fat',
  'saturated fat': 'satFat', 'sat fat': 'satFat', saturated: 'satFat',
  'trans fat': 'transFat',
  cholesterol: 'cholesterol', sodium: 'sodium', potassium: 'potassium', calcium: 'calcium', iron: 'iron',
  'vitamin a': 'vitA', 'vit a': 'vitA', 'vitamin c': 'vitC', 'vit c': 'vitC', 'vitamin d': 'vitD', 'vit d': 'vitD',
};
const UNKNOWN = /^(?:unknown|not listed|not known|n\/?a|none listed|no data|\?+|-+|—|–)$/;
const TO_BASE = { g: 1, mg: 1e-3, mcg: 1e-6, µg: 1e-6, ug: 1e-6 };
const STORED = { g: 'g', mg: 'mg', 'µg': 'mcg' };

/** Lowercase label without markdown, brackets ("Vitamin A (RAE)"), or a trailing unit ("Protein g"). */
function labelKey(raw) {
  return raw.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*_`#>]/g, ' ').replace(/\s+(?:g|mg|mcg|µg|kcal|grams)$/, '').replace(/\s+/g, ' ').trim();
}

/** Split "Label: value" (also "Label | value", "Label = value", "Label – value", or a table row "| Label | value |"). */
function splitLine(line) {
  let t = line.replace(/^\s*(?:[-*•+]|\d+[.)])\s+/, '').replace(/[*_`]/g, '').trim(); // bullets, numbering, bold, code
  t = t.replace(/^\|/, '').replace(/\|\s*$/, '').trim(); // a markdown table row
  if (!t || /^[-|: ]+$/.test(t)) return null; // empty, or a table rule
  const m = t.match(/^([^:|=\t]+?)\s*(?::|\||=|\t|\s[–—-]\s)\s*(.*)$/);
  return m ? { label: m[1].trim(), value: m[2].trim() } : null;
}

/**
 * One value -> a number in the nutrient's stored unit, null for "unknown", or a problem in plain words.
 * @param {string} key nutrient key
 * @param {string} raw the text after the label
 * @returns {{v:number|null}|{problem:string}}
 */
export function readValue(key, raw) {
  const info = NUTRIENT_INFO[key];
  const name = info.label;
  let t = raw.toLowerCase().replace(/[*_`]/g, '').replace(/\([^)]*\)/g, ' ').trim();
  if (!t || UNKNOWN.test(t)) return { v: null };
  t = t.replace(/^(?:~|≈|about|approx\.?|approximately|around|roughly|est\.?|estimated|<|≤|under|less than)\s*/, '').replace(/^~\s*/, '');
  if (/\d\s*(?:-|–|—|to)\s*\d/.test(t)) return { problem: `${name}: give one number, not a range ("${raw.trim()}").` };
  if (/%/.test(t)) return { problem: `${name}: give an amount, not a % Daily Value ("${raw.trim()}").` };
  const m = t.match(/^([\d.,/ ]*\d)\s*(kcal|calories|cal|kj|grams?|g|mg|mcg|µg|μg|ug|iu)?\b/);
  if (!m) return { problem: `${name}: "${raw.trim()}" isn't a number.` };
  const n = parseAmount(m[1].trim());
  if (n == null) return { problem: ambiguousNumber(m[1]) ? `${name}: "${m[1].trim()}" is unclear. Use a point for decimals (1.5) and no commas for thousands (1200).` : `${name}: "${raw.trim()}" isn't a number.` };
  const unit = (m[2] || '').replace('μg', 'µg').replace(/^grams?$/, 'g');
  let v = n;
  if (key === 'kcal') {
    if (unit === 'kj') v = n / 4.184;
    else if (unit && !['kcal', 'calories', 'cal'].includes(unit)) return { problem: `Calories: "${raw.trim()}" isn't in kcal.` };
  } else if (unit === 'iu') {
    if (key === 'vitA') v = n * 0.3; // IU retinol -> µg RAE
    else if (key === 'vitD') v = n * 0.025; // IU -> µg
    else return { problem: `${name}: IU only works for vitamins A and D.` };
  } else if (unit) {
    if (!TO_BASE[unit]) return { problem: `${name}: "${raw.trim()}" isn't in ${STORED[info.unit] || info.unit}.` };
    v = (n * TO_BASE[unit]) / TO_BASE[info.unit === 'µg' ? 'µg' : info.unit];
  }
  v = Math.round(v * 1000) / 1000;
  const max = key === 'kcal' ? LIMITS.kcal : ['protein', 'carbs', 'fat'].includes(key) ? LIMITS.macroGrams : maxForUnit(info.unit);
  if (v > max) return { problem: `${name}: ${fmtInt(v)} ${info.unit} is more than one entry can hold (${fmtInt(max)}).` };
  return { v };
}

/** "1 bowl (450 g)" -> {label:'1 bowl', grams:450}; "450 g" -> {label:'450 g', grams:450}; "1 cup" -> {label:'1 cup', grams:null}. */
export function readAmount(raw) {
  const t = raw.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  const g = t.match(/(?:^|\(|\s)~?\s*([\d.,/ ]*\d)\s*(?:g|grams?)\b\.?\)?/i);
  const grams = g ? parseAmount(g[1].trim()) : null;
  const label = t.replace(/\s*\(([^)]*)\)\s*$/, '').trim();
  const ok = grams != null && grams > 0 && grams <= MAX_GRAMS ? Math.round(grams * 10) / 10 : null;
  return { label: (label || (ok ? `${ok} g` : '')).slice(0, 60), grams: ok };
}

/**
 * Read pasted text into Quick add items. When an "Intake" header line is present, only what follows it is read. A "Name:" line (or a nutrient repeated within an item) starts the next item;
 * lines that aren't "Label: value" pairs, and labels it doesn't know, are skipped, so the rest of a chat answer can be
 * pasted along with the block. An item needs calories; a value it can't read is left out and named in `problems`.
 * Added sugars above total sugars can't be right, so they are left as not listed (with a note).
 * @param {string} text
 * @returns {{items:Array<{name:string, amount:{label:string, grams:number|null}|null, per:Record<string, number|null>}>, problems:string[]}}
 */
export function parseChatNutrition(text) {
  const items = [];
  const problems = [];
  let cur = null;
  const fresh = () => ({ name: '', amount: null, per: {}, seen: new Set() });
  const finish = () => {
    if (!cur || (!cur.name && !cur.seen.size)) return;
    const label = cur.name || 'Quick add';
    if (cur.per.kcal == null) { problems.push(`${label}: no calories, so it was left out.`); return; }
    const per = { ...emptyNutrients(), ...cur.per };
    if (impossibleAddedSugar(per)) { per.addedSugar = null; problems.push(`${label}: added sugars were more than total sugars, so they're left as not listed.`); }
    items.push({ name: label.slice(0, 80), amount: cur.amount, per });
  };
  let lines = String(text || '').replace(/```[a-z]*\n?/gi, '\n').split(/\r?\n/);
  const head = lines.findIndex((l) => /^\W*intake\W*$/i.test(l));
  if (head >= 0) lines = lines.slice(head + 1); // the whole answer was pasted: read only the block, not the prose above it
  for (const line of lines) {
    const pair = splitLine(line);
    if (!pair) continue;
    const field = LABELS[labelKey(pair.label)];
    if (!field) continue;
    if (field === 'name') {
      finish();
      cur = fresh();
      cur.name = pair.value.replace(/[*_`]/g, '').trim();
      continue;
    }
    if (!cur) cur = fresh();
    if (field === 'amount' || field === 'weight') {
      const a = readAmount(pair.value);
      if (field === 'weight' && !a.grams) continue;
      cur.amount = field === 'weight' && cur.amount ? { ...cur.amount, grams: a.grams } : a;
      continue;
    }
    if (cur.seen.has(field)) { finish(); cur = fresh(); } // a second "Calories:" without a name: the next food
    cur.seen.add(field);
    const r = readValue(field, pair.value);
    if ('problem' in r) problems.push(cur.name ? `${cur.name}: ${r.problem}` : r.problem);
    else cur.per[field] = r.v;
  }
  finish();
  if (!items.length && !problems.length) problems.push('No nutrition found. Paste the Intake block from the chat: lines like "Calories: 450" and "Protein: 30 g".');
  return { items, problems };
}

/**
 * A read item as a Quick add diary entry (without date and meal).
 * @param {{name:string, amount:{label:string, grams:number|null}|null, per:Object}} item
 */
export function chatEntry(item) {
  const a = item.amount;
  return { foodKey: 'quick', name: item.name, brand: '', serving: { label: (a && a.label) || 'serving', grams: a && a.grams ? a.grams : null }, qty: 1, per: item.per };
}
