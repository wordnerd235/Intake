// gemini.js - "Estimate a meal from a photo": sends one photo to Google's Gemini API with the person's own key and
// returns its list of foods. The key stays on the phone (settings); the photo goes to Google, nowhere else.
// Request/answer logic is pure in meal-photo-core.js.
import { MODELS, buildRequest, parseEstimate, explainError } from './meal-photo-core.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
/** Longest side of the photo sent: plenty to judge portions, and a small upload. */
const SIDE = 1280;
const TIMEOUT_MS = 90000;

/** Shrink a photo to a JPEG no larger than SIDE, as base64. */
async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const url = c.toDataURL('image/jpeg', 0.85);
  return url.slice(url.indexOf(',') + 1);
}

/** An error to show as is. */
export class GeminiError extends Error {}

/**
 * Ask Gemini what is on the plate.
 * @param {Blob} photo
 * @param {string} key the person's Google API key
 * @param {{signal?:AbortSignal, fetchFn?:typeof fetch}} [o]
 * @returns {Promise<ReturnType<typeof parseEstimate>>}
 */
export async function estimateMeal(photo, key, { signal, fetchFn = globalThis.fetch } = {}) {
  if (window.__intakeTestGemini) return parseEstimate(await window.__intakeTestGemini(photo)); // e2e stand-in
  const b64 = await toJpeg(photo);
  let last = null;
  for (const model of MODELS) {
    for (const withSchema of [true, false]) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const onAbort = () => ctl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      let res = null;
      let body = null;
      try {
        res = await fetchFn(`${API}${model}:generateContent`, {
          method: 'POST', credentials: 'omit', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(buildRequest(b64, 'image/jpeg', withSchema)),
        });
        body = await res.json().catch(() => null);
      } catch (e) {
        if (signal && signal.aborted) throw new GeminiError('Cancelled');
        throw new GeminiError(ctl.signal.aborted ? 'Gemini took too long to answer. Try again.' : explainError(0, null).message);
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      if (res.ok) return parseEstimate(body);
      // a model that rejects the answer schema gets one try without it; anything else moves on or stops
      if (res.status === 400 && withSchema && /schema|response_?mime|generation_?config/i.test(JSON.stringify(body || ''))) continue;
      last = explainError(res.status, body);
      if (!last.tryNext) throw new GeminiError(last.message);
      break;
    }
  }
  throw new GeminiError(last ? last.message : "Couldn't get an estimate.");
}
