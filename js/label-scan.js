// label-scan.js - read a Nutrition Facts label from a photo: on-device text recognition (Tesseract, loaded from a CDN on
// demand the first time), then label-parse.js turns the text into nutrients. Nothing leaves the phone except the library
// download.
import { h, sheet, button, spinner } from './ui.js';
import { parseNutritionLabel } from './label-parse.js';

const CDN = 'https://unpkg.com/';
const TESSERACT_URL = `${CDN}tesseract.js@5.1.1/dist/tesseract.min.js`;
const PATHS = {
  workerPath: `${CDN}tesseract.js@5.1.1/dist/worker.min.js`,
  corePath: `${CDN}tesseract.js-core@5.1.1`,
  langPath: `${CDN}@tesseract.js-data/eng@1.0.0/4.0.0_best_int`,
};
/** Longest side, in pixels, the photo is shrunk to: plenty for label text, and keeps phones from running out of memory. */
const MAX_SIDE = 2000;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = h('script', { src, crossorigin: 'anonymous' });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The label reader could not be downloaded. Check the connection and try again.'));
    document.head.append(s);
  });
}

/** The photo as a grayscale canvas no larger than MAX_SIDE. */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}

/**
 * Recognize the text in a label photo.
 * @param {Blob} file
 * @param {(msg:string)=>void} [onStatus]
 * @returns {Promise<string>}
 */
export async function readLabelText(file, onStatus = () => {}) {
  onStatus('Getting the label reader…');
  await loadScript(TESSERACT_URL);
  const canvas = await prepare(file);
  const worker = await window.Tesseract.createWorker('eng', 1, {
    ...PATHS,
    logger: (m) => {
      if (m.status === 'recognizing text') onStatus(`Reading the label… ${Math.round((m.progress || 0) * 100)}%`);
      else if (/load/.test(m.status || '')) onStatus('Getting the label reader… (first time only)');
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    worker.terminate();
  }
}

/**
 * Ask for a photo of a Nutrition Facts label, read it, and hand back what was found.
 * @param {{onRead:(r:{per:Object,label:string,grams:number|null,found:string[]})=>void, onManual:()=>void}} o
 */
export function scanLabel({ onRead, onManual }) {
  const pick = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'ls-file', hidden: true });
  const status = h('p', { class: 'muted scan-status', role: 'status' }, 'Take a photo of the Nutrition Facts panel: flat, straight on, filling the frame, in good light.');
  const again = button('Take photo', () => pick.click(), { variant: 'primary', cls: 'grow' });
  // iPhone Live Text (or any copy from a photo) is often cleaner than our own OCR: paste it and the same parser reads it.
  const pasted = h('textarea', { class: 'input', id: 'ls-text', rows: 5, maxlength: 5000, 'aria-label': 'Label text', placeholder: 'Calories 230\nTotal Fat 8g\n…' });
  const paste = h('details', { class: 'more ls-paste' }, h('summary', null, 'Paste the label text instead'),
    h('p', { class: 'muted small' }, 'On iPhone: open the photo in Photos, press and hold on the label text, Select All, Copy, then paste here.'),
    pasted, h('div', { class: 'btn-row left' }, button('Use this text', () => {
      const r = parseNutritionLabel(pasted.value);
      if (!use(r)) status.textContent = "Couldn't find nutrition numbers in that text. Check it has lines like \"Calories 230\" and \"Total Fat 8g\".";
    }, { variant: 'secondary' })));
  /** Hand over a parse that found something; false when it found too little to be a label. */
  const use = (r) => {
    if (r.per.kcal == null && r.found.length < 2) return false;
    s.close();
    onRead(r);
    return true;
  };
  const s = sheet({
    title: 'Scan a nutrition label', size: 'sm',
    content: [status, paste, pick],
    footer: h('div', { class: 'btn-row' }, button('Type it in', () => { s.close(); onManual(); }, { variant: 'ghost' }), again),
  });
  pick.addEventListener('change', async () => {
    const file = pick.files && pick.files[0];
    pick.value = '';
    if (!file) return;
    again.disabled = true;
    const say = (t) => status.replaceChildren(spinner('Reading'), ` ${t}`);
    try {
      if (!use(parseNutritionLabel(await readLabelText(file, say)))) {
        status.textContent = "Couldn't read that label. Try again closer, straight on and in good light, paste the text, or type it in.";
        again.lastChild.textContent = 'Try again';
      }
    } catch (e) {
      status.textContent = (e && e.message) || "Couldn't read that photo.";
      again.lastChild.textContent = 'Try again';
    } finally {
      again.disabled = false;
    }
  });
  pick.click(); // straight to the camera; the sheet stays for retries and status
  return s;
}
