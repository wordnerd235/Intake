// meal-photo-core.js - PURE parts of "Estimate a meal from a photo": the Gemini request, reading its answer, matching
// each item to a USDA food, and turning the reviewed list into diary entries. No DOM, no network: gemini.js sends the
// request; views/meal-photo.js shows the list.
import { emptyNutrients, scaleNutrients } from './nutrition.js';
import { LIMITS } from './units.js';

/** What Gemini is asked to do. Portions are the hard part, so it is told what to measure them against. */
export const PROMPT = `You estimate nutrition from food photos for a calorie tracker.
List each distinct food or drink in the photo that someone is about to eat (a plate may hold several; a single dish is one item unless its parts are clearly separate, like a burger and fries).
For each item give:
- name: short and plain, how a person would say it ("Grilled chicken thigh", "White rice", "Caesar salad with dressing").
- search: 2 to 5 plain words to find the plain food in the USDA database ("chicken thigh roasted", "rice white cooked", "broccoli cooked").
- grams: the edible weight you see. Judge size from the plate (a dinner plate is about 27 cm across), bowl, utensils, hands and packaging.
- kcal, protein, carbs, fat (grams) for that weight, including oil, butter, sauce or dressing you can see or that the dish is normally made with.
Also give note: one short sentence naming your biggest assumption (for example the cooking fat or a hidden ingredient).
If there is no food or drink in the photo, return an empty items list and say so in note.`;

/** The answer's shape (Gemini's OpenAPI-style schema). */
export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          search: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
        },
        required: ['name', 'search', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
      },
    },
    note: { type: 'STRING' },
  },
  required: ['items', 'note'],
};

/**
 * The generateContent request body for one photo.
 * @param {string} b64 the photo, base64 (no data: prefix)
 * @param {string} mime e.g. image/jpeg
 * @param {boolean} [withSchema] false sends JSON mode without the schema (a fallback if a model refuses the schema)
 */
export function buildRequest(b64, mime, withSchema = true, quick = true) {
  return {
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: {
      temperature: 0.2, responseMimeType: 'application/json', ...(withSchema ? { responseSchema: SCHEMA } : {}),
      // Gemini 3 Flash thinks at "medium" by default; "low" (Google's advice for recognition tasks) answers much sooner
      ...(quick ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
    },
  };
}

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN);
const clampNum = (v, max) => { const n = num(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Read Gemini's answer (the response JSON, or just its text) into a clean list. Anything malformed is dropped.
 * @param {Object|string} res generateContent response, or the model's text
 * @returns {{items:Array<{name:string, search:string, grams:number, kcal:number, protein:number|null, carbs:number|null, fat:number|null}>, note:string, blocked:string}}
 */
export function parseEstimate(res) {
  let t = res;
  let blocked = '';
  if (res && typeof res === 'object') {
    const c = res.candidates && res.candidates[0];
    if (!c && res.promptFeedback && res.promptFeedback.blockReason) blocked = String(res.promptFeedback.blockReason);
    t = c && c.content && Array.isArray(c.content.parts) ? c.content.parts.map((p) => p.text || '').join('') : '';
  }
  t = String(t || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let j = null;
  try { j = JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); if (m) try { j = JSON.parse(m[0]); } catch { /* not JSON */ } }
  const raw = j && Array.isArray(j.items) ? j.items : [];
  const items = [];
  for (const r of raw.slice(0, 20)) {
    if (!r || typeof r !== 'object') continue;
    const name = text(r.name, 80);
    const grams = clampNum(r.grams, 5000);
    const kcal = clampNum(r.kcal, LIMITS.kcal);
    if (!name || !grams || kcal == null) continue;
    items.push({ name, search: text(r.search, 80) || name, grams: Math.round(grams), kcal: Math.round(kcal),
      protein: clampNum(r.protein, LIMITS.macroGrams), carbs: clampNum(r.carbs, LIMITS.macroGrams), fat: clampNum(r.fat, LIMITS.macroGrams) });
  }
  return { items, note: text(j && j.note, 240), blocked };
}

/** Restaurant and brand entries in the USDA list start with the brand in capitals ("McDONALD'S, Cheeseburger"). */
const BRANDED = /^[A-Z0-9'&.\- ]*[A-Z]{3}[A-Z0-9'&.\- ]*,/;

/**
 * Pick the USDA food for an item: the best search hit whose calories per gram agree with Gemini's estimate (within
 * 20%, or 25 kcal per 100 g for light foods), preferring plain foods over restaurant items. A dish fried in oil or
 * covered in sauce will not agree with the plain food, so it keeps Gemini's own numbers instead of borrowing the
 * wrong ones.
 * @param {{grams:number, kcal:number}} item
 * @param {Array<{name:string, per100g?:Object}>} candidates USDA foods, best search hit first
 * @returns {Object|null}
 */
export function pickMatch(item, candidates) {
  if (!item.grams) return null;
  const est = (item.kcal / item.grams) * 100;
  const close = (f) => f && f.per100g && typeof f.per100g.kcal === 'number' && Math.abs(f.per100g.kcal - est) <= Math.max(25, 0.2 * est);
  const top = (candidates || []).slice(0, 8);
  return top.find((f) => close(f) && !BRANDED.test(f.name)) || top.find(close) || null;
}

/**
 * The nutrients for an item at `grams`: from its USDA match, else Gemini's estimate scaled to the new weight.
 * @param {{grams:number, kcal:number, protein:number|null, carbs:number|null, fat:number|null}} item as Gemini sent it
 * @param {Object|null} match USDA food
 * @param {number} grams
 * @returns {Record<string, number|null>}
 */
export function itemNutrients(item, match, grams) {
  if (match && match.per100g) return scaleNutrients(match.per100g, grams / 100);
  const k = item.grams ? grams / item.grams : 0;
  return { ...emptyNutrients(), kcal: item.kcal * k, protein: item.protein == null ? null : item.protein * k, carbs: item.carbs == null ? null : item.carbs * k, fat: item.fat == null ? null : item.fat * k };
}

/**
 * A reviewed item as a diary entry (without date and meal), under the plain name Gemini gave it. A USDA match logs as
 * that food by the gram, so it can be edited like any other; an estimate logs like a Quick add.
 * @param {{name:string, grams:number, kcal:number, protein:number|null, carbs:number|null, fat:number|null}} item
 * @param {Object|null} match
 * @param {number} grams
 */
export function itemEntry(item, match, grams) {
  if (match) return { foodKey: match.key, name: item.name, brand: '', serving: { label: 'g', grams: 1 }, qty: grams, per: scaleNutrients(match.per100g, 0.01) };
  return { foodKey: 'quick', name: `${item.name} (photo estimate)`, brand: '', serving: { label: `${Math.round(grams)} g`, grams: Math.round(grams) }, qty: 1, per: itemNutrients(item, null, grams) };
}

/** Models to try, best first: Google's recommended Flash, then the lighter Flash-Lite (its own free quota). */
export const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

/**
 * What a failed Gemini call means for the person, and whether the next model is worth trying.
 * @param {number} status HTTP status (0 when the request never got an answer)
 * @param {Object|null} body the error JSON, if any ({error:{status, message}})
 * @returns {{message:string, tryNext:boolean}}
 */
export function explainError(status, body) {
  const e = (body && body.error) || {};
  const msg = String(e.message || '');
  const reason = JSON.stringify(e.details || '') + msg;
  if (!status) return { message: typeof navigator !== 'undefined' && navigator.onLine === false ? 'You are offline. Estimating a meal needs a connection.' : "Couldn't reach Google's Gemini server (generativelanguage.googleapis.com). If a content blocker, VPN or Wi-Fi filter is on, allow that site or try on cellular.", tryNext: false };
  if (/ACCESS_TOKEN_TYPE_UNSUPPORTED/.test(reason)) return { message: "Google didn't accept this key. In aistudio.google.com/apikey, use the key's copy button (the key shown on screen is shortened), then paste it in More > Units and display.", tryNext: false };
  if (/API_KEY_INVALID|API key not valid/i.test(reason)) return { message: "Google says this API key isn't valid. In aistudio.google.com/apikey, use the key's copy button (the key shown on screen is shortened), then paste it in More > Units and display.", tryNext: false };
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(reason)) return { message: 'This key\'s Google project doesn\'t have the Gemini API turned on. Turn on "Generative Language API" for it in Google Cloud, or make a key at aistudio.google.com (those work right away).', tryNext: false };
  if (/referer|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_SERVICE_BLOCKED/i.test(reason)) return { message: "This key's restrictions block Intake. Allow the Generative Language API (and this website) for the key in Google Cloud, or use an AI Studio key.", tryNext: false };
  if (status === 429) return { message: "Gemini's free limit is used up for now. Try again later (limits reset daily), or log it with Quick add.", tryNext: true };
  if (status === 404) return { message: 'Gemini model not available for this key.', tryNext: true };
  if (status >= 500) return { message: 'Gemini is busy right now. Try again in a minute.', tryNext: true };
  return { message: `Gemini answered with an error (${status}${e.status ? ` ${e.status}` : ''}).`, tryNext: false };
}
