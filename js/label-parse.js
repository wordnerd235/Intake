// label-parse.js - PURE parser for the text read off a US "Nutrition Facts" label (by OCR, so expect noise).
// No DOM: label-scan.js feeds it the recognized text; tests feed it fixtures.

/**
 * Label lines -> nutrient keys. Each pattern is the start of a line (after OCR noise is trimmed); the first number after it
 * is the amount per serving. Order matters: the more specific names come first ("saturated fat" before "fat").
 */
const ROWS = [
  ['satFat', /^(?:sat(?:urated)?\.?\s*fat)/],
  ['transFat', /^(?:trans\s*fat)/],
  ['fat', /^(?:total\s*fat|fat)/],
  ['cholesterol', /^(?:cholest(?:erol|\.)?)/],
  ['sodium', /^(?:sodium)/],
  ['fiber', /^(?:dietary\s*fib(?:er|re)|fib(?:er|re))/],
  ['sugar', /^(?:total\s*sugars?|sugars?)/],
  ['carbs', /^(?:total\s*carb(?:ohydrate|ohydrates|s|\.)?)/],
  ['protein', /^(?:protein)/],
  ['vitD', /^(?:vit(?:amin|\.)?\s*d)/],
  ['calcium', /^(?:calcium)/],
  ['iron', /^(?:iron)/],
  ['potassium', /^(?:potas(?:sium|\.)?)/],
  ['vitA', /^(?:vit(?:amin|\.)?\s*a)/],
  ['vitC', /^(?:vit(?:amin|\.)?\s*c)/],
];

/** The unit each nutrient is stored in, and what a label unit converts to it. */
const STORE_UNIT = { fat: 'g', satFat: 'g', transFat: 'g', fiber: 'g', sugar: 'g', carbs: 'g', protein: 'g', cholesterol: 'mg', sodium: 'mg', calcium: 'mg', iron: 'mg', potassium: 'mg', vitC: 'mg', vitD: 'µg', vitA: 'µg' };
const TO_BASE = { g: 1, mg: 1e-3, mcg: 1e-6, µg: 1e-6, ug: 1e-6 };
/** Most a single serving can plausibly hold, in the stored unit; anything above is an OCR misread. */
const SANE = { kcal: 3000, fat: 200, satFat: 100, transFat: 50, fiber: 100, sugar: 300, carbs: 400, protein: 200, cholesterol: 3000, sodium: 20000, calcium: 5000, iron: 200, potassium: 10000, vitC: 5000, vitD: 500, vitA: 10000 };

/**
 * Tidy one OCR line: lowercase, unify the micro sign, turn letter-O / l / I inside numbers into digits, drop stray symbols.
 * @param {string} line
 * @returns {string}
 */
export function cleanLine(line) {
  return String(line || '')
    .toLowerCase()
    .replace(/[μµ]/g, 'µ')
    .replace(/\[[^\]]{0,3}\]|\|[^|]{0,2}\|/g, ' ') // a boxed "[7]" or "|0|" is a checkbox or rule line, not a number
    .replace(/(\d)\s*meg\b/g, '$1mcg') // OCR reads "mcg" as "meg"
    .replace(/(\d)[o](?=\s*(?:m?c?g|µg|%|\b))/g, '$10') // "1o g" -> "10 g"
    .replace(/(^|\s)[o](?=\s*(?:m?c?g|µg)\b)/g, '$10') // "o g" -> "0 g"
    .replace(/(^|\s)s(?=\s*(?:m?c?g|µg)\b)/g, '$15') // "smg" -> "5mg"
    .replace(/(^|\s)0(\d)(?=\s*(?:m?c?g|µg)\b)/g, '$10.$2') // "07mg": the decimal point was lost (0.7 mg)
    .replace(/(\d)[il|](?=\d)/g, '$11')
    .replace(/(^|[^a-z])ron(?=\s*\d)/g, '$1iron') // the "i" of "Iron" is often lost against a rule line
    .replace(/[^a-z0-9µ.,/%()\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Row names as printed, for repairing OCR misspellings ("dietary fber", "potassaum", "satarated fat", "totalsugars"). */
const NAMES = ['serving size', 'calories', 'total fat', 'saturated fat', 'trans fat', 'cholesterol', 'sodium', 'total carbohydrate', 'dietary fiber', 'total sugars', 'protein', 'vitamin d', 'calcium', 'iron', 'potassium', 'vitamin a', 'vitamin c'];

/** Levenshtein distance, stopping early once it exceeds `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Put the printed row name back when OCR misspelled it or ran words together: the words before the first number are
 * compared (spaces ignored) with each known name, allowing about one wrong letter in five. Lines that already read
 * correctly, and lines that are not near any name, are returned unchanged.
 * @param {string} line a cleaned line
 * @returns {string}
 */
export function repairName(line) {
  const m = line.match(/^([a-z][a-z .]*?)\s*(?=\d|$|\()/);
  if (!m) return line;
  const head = m[1].replace(/[ .]/g, '');
  if (head.length < 4) return line;
  let best = null;
  for (const name of NAMES) {
    const want = name.replace(/ /g, '');
    if (head === want) return `${name} ${line.slice(m[0].length)}`.trim(); // "ca lories" -> "calories"
    const d = editDistance(head, want, Math.max(1, Math.floor(want.length / 5)));
    if (d <= Math.max(1, Math.floor(want.length / 5)) && (!best || d < best.d)) best = { name, d };
  }
  return best ? `${best.name} ${line.slice(m[0].length)}`.trim() : line;
}

/** Where a nutrient row starts, for labels that print several on one line ("Calcium 390mg 30% · Potassium 470mg 10%"). */
const ROW_START = /total\s*fat|sat(?:urated)?\.?\s*fat|trans\s*fat|cholest|sodium|total\s*carb|dietary\s*fib|total\s*sugars|incl(?:udes|\.)|protein|vit(?:amin|\.)?\s*[adc](?![a-z])|vitamin\s*b|calcium|iron|potas|thiamin|riboflavin|niacin|folate|zinc|magnesium|phosphorus/g;

/**
 * Split a cleaned line into one line per nutrient row. A row name starts a new row only once a number has been read on
 * the line, so "not a significant source of saturated fat, trans fat" stays whole. A short stray word before the first
 * row name (text from beside the label) is dropped. Bilingual names lose their translation ("total fat/grasa total 2g").
 * @param {string} line a cleaned line
 * @returns {string[]}
 */
export function splitRows(line) {
  const cuts = [];
  for (const m of line.matchAll(ROW_START)) if (m.index > 0 && /\d/.test(line.slice(0, m.index))) cuts.push(m.index);
  const parts = [];
  let from = 0;
  for (const c of cuts) { parts.push(line.slice(from, c)); from = c; }
  parts.push(line.slice(from));
  return parts.map((p, i) => {
    let t = p.trim();
    ROW_START.lastIndex = 0;
    const first = i === 0 && t.search(ROW_START);
    if (first > 0 && /^[a-z]{1,6}\s+$/.test(t.slice(0, first))) t = t.slice(first);
    return t.replace(/^([a-z][a-z .]*?)\s*\/\s*[a-z][a-z .]*?(?=\s*[\d<(]|$)/, '$1 ').trim();
  }).filter(Boolean);
}

/** FDA Daily Values (2016 label rules), in label units, to check an amount against the % DV printed next to it. */
const DV = { fat: 78, satFat: 20, cholesterol: 300, sodium: 2300, carbs: 275, fiber: 28, protein: 50, vitD: 20, calcium: 1300, iron: 18, potassium: 4700 };

/**
 * The first amount on a label line: number + optional unit ("8g", "160 mg", "2.5 g", "<1g", "1,200mg"), skipping % DV
 * numbers. Also returns the % DV printed after it, if any. A comma between digits is a thousands separator on US labels.
 * @param {string} rest text after the nutrient name
 * @returns {{n:number, unit:string, raw:string, pct:number|null}|null}
 */
function amount(rest) {
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mcg|µg|ug|mg|g)?/g;
  let m;
  while ((m = re.exec(rest))) {
    const before = rest[m.index - 1];
    if (before && /[a-z]/.test(before)) continue; // part of a word ("b12")
    const after = rest.slice(m.index + m[0].length);
    if (!m[2] && /^\s*%/.test(after)) continue; // a % DV, not an amount
    const p = after.match(/^\s*(\d{1,3})\s*%/);
    return { n: Number(m[1].replace(/,/g, '')), unit: m[2] || '', raw: m[1], pct: p ? Number(p[1]) : null };
  }
  return null;
}

/** Grams per serving above which a bare number ending in 9 is more likely a misread "g" than a real amount. */
const TYPICAL_G = { fat: 100, satFat: 40, transFat: 10, fiber: 40, sugar: 100, carbs: 150, protein: 80 };
/**
 * Most a serving normally holds, for numbers read with no unit beside them: above this a bare number is more likely a
 * misread "%" ("1%" read as "196") or a merged column than a real amount, so it is left blank for the person to fill.
 */
const TYPICAL_BARE = { ...TYPICAL_G, cholesterol: 400, sodium: 3000, calcium: 1500, iron: 40, potassium: 2500, vitD: 50, vitC: 500, vitA: 2000 };

/**
 * OCR often reads the "g" of "8g" as a 9 ("89"). With no unit and a trailing 9: when a % DV is printed beside it, keep
 * whichever reading (89 or 8) agrees better with it; with no % DV, take the short reading when the long one is more
 * than a serving normally holds ("Total Sugars 129").
 */
function fixLostG(key, a) {
  if (a.unit || !/^\d+9$/.test(a.raw)) return a;
  const short = Number(a.raw.slice(0, -1));
  const asShort = { ...a, n: short, unit: STORE_UNIT[key] === 'µg' ? 'mcg' : STORE_UNIT[key] };
  if (a.pct != null && DV[key]) {
    const off = (n) => Math.abs((n / DV[key]) * 100 - a.pct);
    return off(short) < off(a.n) ? asShort : a;
  }
  return TYPICAL_G[key] && a.n > TYPICAL_G[key] && short <= TYPICAL_G[key] ? asShort : a;
}

/** Convert a label amount to the stored unit. A bare number is taken in the stored unit. */
function toStored(key, n, unit) {
  const want = STORE_UNIT[key];
  if (!unit) return n;
  const u = unit === 'ug' ? 'µg' : unit;
  return Math.round(((n * TO_BASE[u]) / TO_BASE[want === 'µg' ? 'µg' : want]) * 1000) / 1000;
}

/**
 * Serving size line: "Serving size 2/3 cup (55g)" -> { label: '2/3 cup', grams: 55 }. Also "1 bar (40g)", "(240mL)", "28g".
 * @param {string} text cleaned text after "serving size"
 */
function serving(text) {
  const t = text.replace(/^[\s:.-]+/, '');
  // "(55g)", and OCR's "(559)" or "(55" for it: the weight in brackets is always grams or mL
  const withG = t.match(/(\d+(?:\.\d+)?)\s*g\b/);
  const bare = !withG && t.match(/\((\d+(?:\.\d+)?)\s*(?:\)|$)/);
  const label = t
    .replace(/\(.*$|\s\d+(?:\.\d+)?\s*(?:g|ml)\b.*$/, '') // the weight, and anything OCR read beside the label after it
    .replace(/([a-z])\s*\/.*$/, '$1') // "1 cup/1 taza": the translation
    .replace(/\babout\b/, '')
    .trim();
  const grams = withG ? Number(withG[1]) : bare ? Number(/^\d{2,}9$/.test(bare[1]) ? bare[1].slice(0, -1) : bare[1]) : null;
  const plainGrams = /^\d+(?:\.\d+)?\s*g$/.test(label);
  return { label: plainGrams || !label ? '1 serving' : label.slice(0, 60), grams: grams && grams > 0 && grams <= 5000 ? grams : null };
}

/**
 * Read a Nutrition Facts label.
 * @param {string} text the recognized text, lines separated by newlines
 * @returns {{per:Record<string,number>, label:string, grams:number|null, found:string[]}} per-serving amounts in the app's
 *   units (only the nutrients that were read), the serving, and which keys were found (calories first when present)
 */
export function parseNutritionLabel(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).flatMap(splitRows);
  const per = {};
  let label = '1 serving';
  let grams = null;
  for (let i = 0; i < lines.length; i++) {
    const line = repairName(lines[i].replace(/^[^a-z0-9]+/, ''));
    const sv = line.match(/^serving\s*size\s*(.*)$/);
    if (sv) {
      const next = !/\d/.test(sv[1]) && lines[i + 1] ? `${sv[1]} ${lines[i + 1]}` : sv[1]; // the amount may sit on the next line
      ({ label, grams } = serving(next));
      continue;
    }
    if (/^servings?\s*per/.test(line) || /^amount\s*per/.test(line)) continue;
    const cal = line.match(/^calories(?!\s*from)\s*(.*)$/);
    if (cal && per.kcal == null) {
      const here = cal[1].match(/^(\d{1,4})\b/);
      const after = !here && lines[i + 1] && lines[i + 1].match(/^(\d{1,4})\b/); // big-print labels put the number on its own line
      const before = !here && !after && i > 0 && lines[i - 1].match(/^amount\s*per\s*serving\s+(\d{1,4})$/); // "Amount per serving 140" beside the big number
      const n = here ? Number(here[1]) : after ? Number(after[1]) : before ? Number(before[1]) : null;
      if (n != null && n <= SANE.kcal) per.kcal = n;
      continue;
    }
    if (/^(includes|incl\.?)\s/.test(line) || /added\s*sugars?/.test(line.slice(0, 20)) || /^sugar\s*alcohol/.test(line)) continue; // "Includes 10g Added Sugars" is part of Total Sugars
    for (const [key, re] of ROWS) {
      const m = line.match(re);
      if (!m) continue;
      if (per[key] == null) {
        const got = amount(line.slice(m[0].length));
        const a = got && fixLostG(key, got);
        if (a && !(a.unit === '' && a.n > TYPICAL_BARE[key])) {
          const v = toStored(key, a.n, a.unit);
          if (v >= 0 && v <= SANE[key]) per[key] = v;
        }
      }
      break;
    }
  }
  const found = ['kcal', ...ROWS.map(([k]) => k)].filter((k) => per[k] != null);
  return { per, label, grams, found };
}
