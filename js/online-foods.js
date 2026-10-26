// online-foods.js - fetch wrappers for Open Food Facts and USDA FoodData Central (search + barcode).
// Plain GETs only (no custom headers) so browsers never need a CORS preflight.
import { normalizeOFF, normalizeFDC, sameBarcode } from './normalize.js';

const OFF_FIELDS = 'code,product_name,brands,serving_size,serving_quantity,nutriments';
const TIMEOUT_MS = 9000;

/** Typed failure so the UI can say something useful. kind: timeout | network | rate | http | parse | aborted */
export class OnlineError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/**
 * GET JSON with a timeout; maps failures to OnlineError.
 * @param {string} url
 * @param {{signal?:AbortSignal, fetchFn?:typeof fetch, timeoutMs?:number}} [o]
 */
export async function getJson(url, { signal, fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const onAbort = () => ctl.abort();
  if (signal) signal.aborted ? ctl.abort() : signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchFn(url, { signal: ctl.signal, credentials: 'omit' });
    if (res.status === 429 || res.status === 503) throw new OnlineError('rate', 'Online database is busy — try again in a minute.', res.status); // OFF answers 503 when its global limit is hit
    if (!res.ok) throw new OnlineError('http', `The food service answered with an error (${res.status}).`, res.status);
    try {
      return await res.json();
    } catch {
      throw new OnlineError('parse', 'The food service sent an unreadable answer.');
    }
  } catch (e) {
    if (e instanceof OnlineError) throw e;
    if (timedOut) throw new OnlineError('timeout', 'The food service took too long to answer.');
    if (e && e.name === 'AbortError') throw new OnlineError('aborted', 'Cancelled');
    throw new OnlineError('network', navigator.onLine === false ? 'You are offline.' : "Couldn't reach the food service.");
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

const cache = new Map();
function remember(key, value) {
  cache.set(key, value);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return value;
}

/** True for a plausible product barcode (EAN-8/UPC-A/EAN-13/ITF-14). */
export const isBarcode = (s) => /^\d{6,14}$/.test(String(s).trim());

/**
 * Open Food Facts text search. Tries Search-a-licious first, then the legacy CGI search.
 * @param {string} q
 * @param {{signal?:AbortSignal, fetchFn?:typeof fetch}} [o]
 * @returns {Promise<Object[]>} Foods
 */
export async function searchOFF(q, o = {}) {
  const key = `off:${q.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  if (cache.has(key)) return cache.get(key);
  const enc = encodeURIComponent(q);
  const attempts = [
    [`https://search.openfoodfacts.org/search?q=${enc}&page_size=20&fields=${OFF_FIELDS}`, (j) => j && j.hits],
    [`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`, (j) => j && j.products],
  ];
  let lastErr = null;
  let answered = false; // at least one host replied, even if with no products
  for (const [url, pick] of attempts) {
    try {
      const list = pick(await getJson(url, o));
      answered = true;
      const foods = (Array.isArray(list) ? list : []).map(normalizeOFF).filter(Boolean);
      if (foods.length) return remember(key, foods);
    } catch (e) {
      if (e.kind === 'aborted' || e.kind === 'rate') throw e; // both hosts share one limit: do not ask again
      lastErr = e;
    }
  }
  if (lastErr && !answered) throw lastErr;
  return answered && !lastErr ? remember(key, []) : [];
}

/** Failures worth one more try: the service was slow, unreachable, busy or briefly broken. */
const RETRYABLE = new Set(['timeout', 'network', 'rate', 'http']);

/**
 * Open Food Facts text search that tries once more after a pause when the first attempt fails.
 * OFF is often slow or briefly busy; one retry clears most of those without hammering its rate limit.
 * @param {string} q
 * @param {{signal?:AbortSignal, fetchFn?:typeof fetch, retryDelayMs?:number}} [o]
 * @returns {Promise<Object[]>} Foods
 */
export async function searchOFFWithRetry(q, { retryDelayMs = 2500, ...o } = {}) {
  try {
    return await searchOFF(q, o);
  } catch (e) {
    if (!RETRYABLE.has(e.kind)) throw e;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, retryDelayMs);
      if (o.signal) o.signal.addEventListener('abort', () => { clearTimeout(t); reject(new OnlineError('aborted', 'Cancelled')); }, { once: true });
    });
    return searchOFF(q, o);
  }
}

/**
 * Open Food Facts product by barcode.
 * @param {string} code
 * @returns {Promise<{food:Object|null, reason?:'not-found'|'no-nutrition', name?:string}>}
 */
export async function barcodeOFF(code, o = {}) {
  const j = await getJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`, o);
  if (!j || j.status !== 1 || !j.product) return { food: null, reason: 'not-found' };
  const food = normalizeOFF({ code, ...j.product });
  return food ? { food } : { food: null, reason: 'no-nutrition', name: j.product.product_name || '' };
}

/**
 * USDA FoodData Central branded search.
 * @param {string} q
 * @param {string} apiKey user key or ''
 */
export async function searchFDC(q, apiKey, o = {}) {
  const k = apiKey || 'DEMO_KEY';
  const key = `fdc:${k === 'DEMO_KEY' ? 'demo' : 'key'}:${q.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  if (cache.has(key)) return cache.get(key);
  const j = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(k)}&query=${encodeURIComponent(q)}&dataType=Branded&pageSize=20`, o);
  return remember(key, (j && Array.isArray(j.foods) ? j.foods : []).map(normalizeFDC).filter(Boolean));
}

/**
 * USDA branded lookup by GTIN/UPC (search by number, keep exact matches).
 * @returns {Promise<{food:Object|null, reason?:string}>}
 */
export async function barcodeFDC(code, apiKey, o = {}) {
  const k = apiKey || 'DEMO_KEY';
  const j = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(k)}&query=${encodeURIComponent(code)}&dataType=Branded&pageSize=10`, o);
  const hit = (j && Array.isArray(j.foods) ? j.foods : []).find((f) => sameBarcode(f.gtinUpc, code));
  const food = hit ? normalizeFDC(hit) : null;
  return food ? { food } : { food: null, reason: hit ? 'no-nutrition' : 'not-found' };
}

/** Friendly sentence for any lookup failure. */
export function describeError(e, what = 'online foods') {
  if (e && e.kind === 'rate') return e.message;
  if (e && e.kind === 'network') return `${e.message} Local results still work.`;
  return e && e.message ? `${what}: ${e.message}` : `Couldn't search ${what}.`;
}
