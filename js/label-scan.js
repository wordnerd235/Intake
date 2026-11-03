// label-scan.js - read a Nutrition Facts label: a photo read on the phone by PaddleOCR (ppocr.js, downloaded the first
// time), or text copied with the iPhone's own Live Text and pasted. label-parse.js turns the text into nutrients.
// Nothing leaves the phone except the one-time reader download.
import { h, sheet, button, spinner } from './ui.js';
import { parseNutritionLabel } from './label-parse.js';

/**
 * Recognize the text in a label photo, as lines.
 * @param {Blob} file
 * @param {(msg:string)=>void} [onStatus]
 * @returns {Promise<string>}
 */
export async function readLabelText(file, onStatus = () => {}) {
  if (window.__intakeTestOcr) return window.__intakeTestOcr(file); // e2e stand-in for the 25 MB reader
  const { recognizeText } = await import('./ppocr.js');
  return recognizeText(file, onStatus);
}

/**
 * Ask for a photo of a Nutrition Facts label, read it, and hand back what was found.
 * @param {{onRead:(r:{per:Object,label:string,grams:number|null,found:string[]})=>void, onManual:()=>void}} o
 */
export function scanLabel({ onRead, onManual }) {
  const pick = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'ls-file', hidden: true });
  const status = h('p', { class: 'muted scan-status', role: 'status' }, 'Take a photo of the Nutrition Facts panel: flat, straight on, filling the frame, in good light.');
  const again = button('Take photo', () => pick.click(), { variant: 'primary', cls: 'grow' });
  // Apple's Live Text reads labels very well: copy with it in the Camera or Photos app, then paste here in one tap.
  const pasted = h('textarea', { class: 'input', id: 'ls-text', rows: 5, maxlength: 5000, 'aria-label': 'Label text', placeholder: 'Calories 230\nTotal Fat 8g\n…' });
  const useText = (t) => { if (!use(parseNutritionLabel(t))) status.textContent = "Couldn't find nutrition numbers in that text. Check it has lines like \"Calories 230\" and \"Total Fat 8g\"."; };
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) { pasted.value = t; useText(t); return; }
      status.textContent = 'The clipboard is empty. Copy the label text first, or paste it in the box below.';
    } catch {
      status.textContent = 'Paste into the box below (press and hold, then Paste).';
    }
    paste.open = true;
    pasted.focus();
  };
  const paste = h('details', { class: 'more ls-paste' }, h('summary', null, 'Paste the label text instead'),
    h('p', { class: 'muted small' }, "Most accurate on iPhone: in the Camera app point at the label, tap the text button, then Copy All (or press and hold the text in a photo, Select All, Copy). Then paste here."),
    pasted, h('div', { class: 'btn-row left' }, button('Use this text', () => useText(pasted.value), { variant: 'secondary' })));
  /** Hand over a parse that found something; false when it found too little to be a label. */
  const use = (r) => {
    if (r.per.kcal == null && r.found.length < 2) return false;
    s.close();
    onRead(r);
    return true;
  };
  const s = sheet({
    title: 'Scan a nutrition label', size: 'sm',
    content: [status, navigator.clipboard && navigator.clipboard.readText ? h('div', { class: 'btn-row left' }, button('Paste copied label text', fromClipboard, { variant: 'secondary', ic: 'copy' })) : null, paste, pick],
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
        status.textContent = "Couldn't read that label. Try again closer, straight on and in good light, or paste text copied with Live Text.";
        again.lastChild.textContent = 'Try again';
      }
    } catch (e) {
      status.textContent = (e && e.message) || "Couldn't read that photo.";
      again.lastChild.textContent = 'Try again';
    } finally {
      again.disabled = false;
    }
  });
  pick.click(); // straight to the camera; the sheet stays for retries, pasting and status
  return s;
}
