// gemini.js - "Estimate a meal from a photo": sends one photo to Google's Gemini API with the person's own key and
// returns its list of foods. The key stays on the phone (settings); the photo goes to Google, nowhere else.
// Request/answer logic is pure in meal-photo-core.js.
import { MODELS, buildRequest, parseEstimate, explainError } from './meal-photo-core.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
/** Longest side of the photo sent: plenty to judge portions, and a small upload. */
const SIDE = 1024;
/** How long to wait for each model: Flash gets 30 s before the lighter Flash-Lite (its own capacity) is asked instead. */
const TIMEOUT_MS = [30000, 60000];

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
 * @param {{signal?:AbortSignal, fetchFn?:typeof fetch, onStatus?:(text:string)=>void}} [o] onStatus hears when it moves on
 * @returns {Promise<ReturnType<typeof parseEstimate>>}
 */
export async function estimateMeal(photo, key, { signal, fetchFn = globalThis.fetch, onStatus } = {}) {
  if (window.__intakeTestGemini) return parseEstimate(await window.__intakeTestGemini(photo)); // e2e stand-in
  const b64 = await toJpeg(photo);
  let last = null;
  // "simple" sends the key in the URL as text/plain: a request the browser makes without a CORS preflight. It is the
  // fallback when the normal request can't get through (some phones, content blockers and networks stop the preflight).
  let simple = false;
  let quick = true; // low thinking; dropped if a model rejects the setting
  for (const [mi, model] of MODELS.entries()) {
    const isLast = mi === MODELS.length - 1;
    for (let withSchema = true; ;) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS[Math.min(mi, TIMEOUT_MS.length - 1)]);
      const onAbort = () => ctl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      let res = null;
      let body = null;
      try {
        const payload = JSON.stringify(buildRequest(b64, 'image/jpeg', withSchema, quick));
        res = simple
          ? await fetchFn(`${API}${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', credentials: 'omit', signal: ctl.signal, headers: { 'content-type': 'text/plain' }, body: payload })
          : await fetchFn(`${API}${model}:generateContent`, { method: 'POST', credentials: 'omit', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: payload });
        body = await res.json().catch(() => null);
      } catch (e) {
        if (signal && signal.aborted) throw new GeminiError('Cancelled');
        if (ctl.signal.aborted) {
          // a busy model: ask the next one rather than keep waiting
          last = { message: 'Gemini is very busy right now and took too long to answer. Try again in a few minutes.', tryNext: true };
          if (!isLast) { if (onStatus) onStatus('Gemini is busy. Asking its lighter model instead…'); break; }
          throw new GeminiError(last.message);
        }
        if (!simple) { simple = true; continue; }
        // Both forms failed before any answer. Safari does this when Google refuses the key before the photo has
        // finished uploading, so ask about the model alone, without the photo: a small request whose answer arrives.
        let check = null;
        try {
          const r = await fetchFn(`${API}${model}`, { credentials: 'omit', headers: { 'x-goog-api-key': key } });
          check = { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
        } catch { /* Google unreachable from here */ }
        if (check && !check.ok) throw new GeminiError(explainError(check.status, check.body).message);
        throw new GeminiError(check
          ? 'Google accepts the key, but your phone stopped its answer about the photo (code: blocked-answer). Try once on cellular, or with a smaller photo.'
          : explainError(0, null).message);
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      if (res.ok) return parseEstimate(body);
      // a model that rejects the answer schema gets one try without it; anything else moves on or stops
      if (res.status === 400 && quick && /thinking/i.test(JSON.stringify(body || ''))) { quick = false; continue; }
      if (res.status === 400 && withSchema && /schema|response_?mime|generation_?config/i.test(JSON.stringify(body || ''))) { withSchema = false; continue; }
      last = explainError(res.status, body);
      if (!last.tryNext) throw new GeminiError(last.message);
      break;
    }
  }
  throw new GeminiError(last ? last.message : "Couldn't get an estimate.");
}
