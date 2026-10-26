// foods-search.js - PURE tokenizer + ranking for the local USDA food list.
// No DOM, no fetch: foods-db.js feeds it rows; tests feed it fixtures.

/** USDA group codes (2 digits) whose members are normally eaten cooked: poultry, pork, beef, fish, legumes, lamb, grains. */
const COOKED_GROUPS = new Set(['05', '10', '13', '15', '16', '17', '20']);
/** Branded / prepared-food groups: baby foods, sausages and luncheon meats, fast food, snacks, native foods, restaurant. */
const SECONDARY_GROUPS = new Set(['03', '07', '21', '25', '35', '36']);
/** Words that mark processed / secondary forms; mildly demoted unless the query asks for them. */
const PROCESSED_WORDS = new Set(['breaded', 'deli', 'sliced', 'prepackaged', 'microwaved', 'imitation', 'substitute', 'mix', 'dehydrated', 'powder', 'instant', 'nuggets', 'tenders', 'ready', 'meatless', 'salad', 'spread', 'flavored', 'tofu']);
/** Diet versions: mildly demoted unless the query asks for them (plain "beer" means regular beer). */
const LIGHT_WORDS = new Set(['light', 'lite', 'diet']);
/** Single-word queries whose literal matches are misleading ("fries" also matches "-fry"); only the alias results are shown. */
const EXCLUSIVE_ALIASES = new Set(['fries', 'oatmeal', 'hamburger', 'soda', 'water', 'soy milk', 'rolled oats', 'old fashioned oats', 'quick oats', 'steel cut oats']);
/**
 * Everyday words and phrases -> the USDA vocabulary. A key may be several words ("rolled oats"); it replaces the same words in the query.
 * Alias results rank slightly below direct matches.
 */
export const ALIASES = {
  oatmeal: ['cereals oats cooked'], 'rolled oats': ['cereals oats regular quick'], 'old fashioned oats': ['cereals oats regular quick'], 'quick oats': ['cereals oats regular quick'],
  'steel cut oats': ['cereals oats regular quick'], yoghurt: ['yogurt'], ketchup: ['catsup'], fries: ['french fried'], mayo: ['mayonnaise'], soda: ['carbonated beverage'],
  hamburger: ['beef ground patty'], 'ground beef': ['beef ground'], pb: ['peanut butter'], oj: ['orange juice'], jam: ['jellies'], jelly: ['jellies'], cereal: ['cereals'],
  'hot dog': ['frankfurter'], hotdog: ['frankfurter'], 'soy milk': ['soymilk'], 'baby food': ['babyfood'], water: ['water tap drinking', 'water bottled generic'],
  noodles: ['pasta'], spaghetti: ['pasta'], chips: ['snacks'], coke: ['carbonated cola'], cola: ['carbonated cola'], 'french fries': ['french fried'],
};
const PREP_WORDS = new Set(['raw', 'cooked', 'roasted', 'baked', 'fried', 'grilled', 'boiled', 'broiled', 'steamed', 'canned', 'dried', 'frozen', 'stewed', 'braised', 'dry', 'uncooked', 'scrambled', 'poached', 'sauteed', 'smoked']);
const COOKED_WORDS = new Set(['cooked', 'roasted', 'baked', 'grilled', 'boiled', 'broiled', 'braised', 'stewed']);

export const WEIGHTS = {
  allInFirstSegment: 160,
  common: 450,
  exactFirstToken: 100,
  exactFirstSegment: 40,
  lengthPenalty: 0.9,
  segmentPenalty: 40,
  secondaryGroup: 130,
  extraFirstSegToken: 30,
  rawBonus: 70,
  cookedBonus: 140,
  wholeBonus: 40,
  processedPenalty: 170,
  aliasPenalty: 60,
  plainBonus: 60,
  exactLaterSegment: 260, // "Pork, cured, bacon, ...": the query is a whole later segment, the food itself
  lightPenalty: 80,
  regularBonus: 90, // USDA's word for the ordinary version ("Salad dressing, mayonnaise, regular")
  sliceBonus: 120, // the query is the whole food ("pizza") and this one is eaten by the slice
  packagePenalty: 500, // only "1 serving = 1/9 of a package" portions, no slice or piece to count
};

/**
 * Lowercase, strip accents and punctuation, split to tokens.
 * @param {string} s
 * @returns {string[]}
 */
export function tokenize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Simple plural folding: berries->berry, tomatoes->tomato, bananas->banana.
 * @param {string} t token
 * @returns {string}
 */
export function fold(t) {
  if (t.length <= 3 || /^\d+$/.test(t)) return t;
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('oes')) return t.slice(0, -2);
  if (/(ss|us|is)$/.test(t)) return t;
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/**
 * Build a searchable index.
 * @param {Array<{name:string, group?:string|number, common?:boolean|number, slice?:boolean, pkg?:boolean, ref?:*}>} items (`slice`: its first listed portion is a slice; `pkg`: lists a portion that is a share of a package)
 * @returns {Array<Object>} index entries
 */
export function buildIndex(items) {
  return items.map((it, i) => {
    const segs = String(it.name).split(',').map((seg) => tokenize(seg));
    const flat = [];
    segs.forEach((toks, si) => toks.forEach((t) => flat.push({ raw: t, folded: fold(t), seg: si })));
    const g = it.group == null ? '' : String(it.group).padStart(2, '0');
    const group = g.length >= 4 ? g.slice(0, 2) : g;
    return {
      i,
      ref: it.ref === undefined ? it : it.ref,
      name: it.name,
      len: String(it.name).length,
      common: !!it.common,
      slice: !!it.slice,
      pkg: !!it.pkg,
      baby: !!(segs[0] && /^baby/.test(segs[0][0] || '')), // "Babyfood, cereal, ...": hidden unless the search names a baby
      group,
      segs,
      flat,
      words: new Set(flat.filter((f, k) => !(f.raw === 'sliced' && k > 0 && flat[k - 1].raw === 'pre')).map((f) => f.folded)), // "pre-sliced" bacon is ordinary bacon
      seg1: new Set((segs[1] || []).map(fold)),
      seg1First: segs[1] && segs[1][0] ? segs[1][0] : '',
      firstFolded: segs[0] && segs[0][0] ? fold(segs[0][0]) : '',
      firstSegFolded: (segs[0] || []).map(fold),
      segsFolded: segs.slice(0, 4).map((sg) => sg.map(fold)),
      lastFolded: segs.length ? segs[segs.length - 1].map(fold).join(' ') : '',
      nSegs: segs.length,
    };
  });
}

/** Does query token q match name token n? Digits need an exact match; words match by prefix. */
function tokenMatches(q, n) {
  if (/^\d+$/.test(q.raw)) return n.raw === q.raw;
  if (q.whole) return n.raw === q.raw || n.folded === q.folded; // a finished short word ("oat" in "oat milk") is not the start of "oatmeal"
  if (n.raw.startsWith(q.raw) || n.folded.startsWith(q.raw)) return true; // typed prefix
  // A plural query ("fries" -> "fry") must equal the folded name token, not prefix it ("fryers").
  return q.folded !== q.raw ? n.folded === q.folded : false;
}

/**
 * Rank index entries against a query.
 * @param {Array<Object>} index from buildIndex
 * @param {string} query
 * @param {{limit?:number}} [opts]
 * @returns {Array<{ref:*, score:number, name:string}>}
 */
export function searchIndex(index, query, { limit = 40 } = {}) {
  const main = rank(index, query);
  const toks = tokenize(query);
  const folded = toks.map(fold);
  const extra = [];
  let exclusive = false;
  for (const [key, alts] of Object.entries(ALIASES)) {
    const k = tokenize(key).map(fold);
    for (let i = 0; i + k.length <= folded.length; i++) {
      if (!k.every((t, j) => folded[i + j] === t)) continue;
      if (toks.length === k.length && EXCLUSIVE_ALIASES.has(key)) exclusive = true;
      for (const alt of alts) extra.push(...rank(index, [...toks.slice(0, i), alt, ...toks.slice(i + k.length)].join(' '), WEIGHTS.aliasPenalty));
    }
  }
  let hits = main;
  if (extra.length) {
    const best = new Map(exclusive ? [] : main.map((h) => [h.i, h]));
    for (const h of extra) if (!best.has(h.i) || best.get(h.i).score < h.score) best.set(h.i, h);
    hits = [...best.values()];
  }
  hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.i - b.i);
  return hits.slice(0, limit).map(({ ref, score, name }) => ({ ref, score, name }));
}

/** Score every entry that matches all query tokens (unsorted). */
function rank(index, query, penalty = 0) {
  const words = tokenize(query);
  // Only the last word can still be half typed. An earlier word of up to 3 letters must match a whole word, so "oat milk" does not find "oatmeal".
  const qtoks = words.map((raw, k) => ({ raw, folded: fold(raw), whole: words.length > 1 && k < words.length - 1 && raw.length < 4 }));
  if (!qtoks.length) return [];
  const wantsBaby = qtoks.some((q) => /^(baby|babies|babyfood|infant|toddler)/.test(q.raw));
  const qWords = new Set(qtoks.map((q) => q.folded));
  const queryHasPrep = qtoks.some((q) => PREP_WORDS.has(q.raw) || PREP_WORDS.has(q.folded));
  const wantsPlain = !['white', 'yolk', 'whites', 'substitute'].some((w) => qWords.has(w));
  const hits = [];
  for (const e of index) {
    if (e.baby && !wantsBaby) continue;
    let ok = true;
    let segSum = 0;
    let allFirst = true;
    for (const q of qtoks) {
      let best = -1;
      for (const n of e.flat) {
        if (tokenMatches(q, n)) {
          best = n.seg;
          break; // flat is in segment order, so the first hit is the earliest segment
        }
      }
      if (best < 0) {
        ok = false;
        break;
      }
      segSum += best;
      if (best !== 0) allFirst = false;
    }
    if (!ok) continue;
    let s = 0;
    if (allFirst) {
      s += WEIGHTS.allInFirstSegment;
      const extra = e.firstSegFolded.filter((t) => !qWords.has(t)).length;
      s -= extra * WEIGHTS.extraFirstSegToken;
      if (extra === 0) {
        s += WEIGHTS.exactFirstSegment;
        if (e.slice) s += WEIGHTS.sliceBonus;
        if (!queryHasPrep && e.seg1First && PREP_WORDS.has(e.seg1First)) s += WEIGHTS.plainBonus; // "Potatoes, baked, ..." is the plain food
      }
    } else {
      s -= segSum * WEIGHTS.segmentPenalty;
    }
    for (let si = 2; si < e.segsFolded.length; si++) { // "Pork, cured, bacon": an item two levels down is the food itself (one level down is the usual pattern and needs no help)
      const sf = e.segsFolded[si];
      if (sf.length === qtoks.length && qtoks.every((q, k) => sf[k] === q.folded)) { s += WEIGHTS.exactLaterSegment; break; }
    }
    if (e.common) s += WEIGHTS.common;
    if (e.pkg && !e.slice) s -= WEIGHTS.packagePenalty;
    if (!qWords.has('regular') && e.nSegs <= 3 && e.lastFolded === 'regular') s += WEIGHTS.regularBonus; // "Name, kind, regular" is the ordinary version of the kind
    if (e.firstFolded && e.firstFolded === qtoks[0].folded) s += WEIGHTS.exactFirstToken;
    s -= e.len * WEIGHTS.lengthPenalty;
    if (!queryHasPrep) {
      if (e.words.has('raw')) s += WEIGHTS.rawBonus;
      if (COOKED_GROUPS.has(e.group)) {
        for (const w of COOKED_WORDS) {
          if (e.words.has(w)) {
            s += WEIGHTS.cookedBonus;
            break;
          }
        }
      }
    }
    if (wantsPlain && e.seg1.has('whole')) s += WEIGHTS.wholeBonus;
    if (SECONDARY_GROUPS.has(e.group)) s -= WEIGHTS.secondaryGroup;
    for (const w of PROCESSED_WORDS) if (e.words.has(w) && !qWords.has(w)) s -= WEIGHTS.processedPenalty;
    for (const w of LIGHT_WORDS) if (e.words.has(w) && !qWords.has(w)) { s -= WEIGHTS.lightPenalty; break; }
    hits.push({ ref: e.ref, score: s - penalty, name: e.name, i: e.i });
  }
  return hits;
}
