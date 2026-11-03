// label-scan.js - read a Nutrition Facts label. The live camera watches for a steady, sharp view of a whole label and
// takes the picture itself (like a bank app's check scanner); the photo is read on the phone by PaddleOCR (ppocr.js,
// downloaded the first time). A photo from the camera app, or text copied with the iPhone's own Live Text, also works.
// label-parse.js turns the text into nutrients; label-frame.js judges the frames. Nothing leaves the phone except the
// one-time reader download.
import { h, sheet, button, spinner } from './ui.js';
import { parseNutritionLabel } from './label-parse.js';
import { toGray, coarse, motion, sharpness, textLayout, judgeFrame, wholeLabel } from './label-frame.js';

/**
 * Recognize the text in a label photo, as lines.
 * @param {Blob|HTMLCanvasElement} file a photo, or a canvas holding a camera frame
 * @param {(msg:string)=>void} [onStatus]
 * @returns {Promise<string>}
 */
export async function readLabelText(file, onStatus = () => {}) {
  if (window.__intakeTestOcr) return window.__intakeTestOcr(file); // e2e stand-in for the 25 MB reader
  const { recognizeText } = await import('./ppocr.js');
  return recognizeText(file, onStatus);
}

/** Text boxes in a camera frame (the detector alone, fast). The e2e stand-in reports a label-like layout. */
async function frameText(frame) {
  if (window.__intakeTestOcr) return { lines: 20, textH: 0.03, span: 0.7 };
  const { findText } = await import('./ppocr.js');
  return textLayout(await findText(frame), frame.width, frame.height);
}

/** How often the live view is checked, and how many good checks in a row it takes to snap. */
const TICK_MS = 250;
const GOOD_IN_A_ROW = 2;
/** The focus check looks at the middle 30% of the frame (at least this many pixels), scaled to this size. */
const PATCH = 320;

/**
 * Scan a Nutrition Facts label and hand back what was found.
 * @param {{onRead:(r:{per:Object,label:string,grams:number|null,found:string[]})=>void, onManual:()=>void}} o
 */
export function scanLabel({ onRead, onManual }) {
  const video = h('video', { class: 'scan-video', playsinline: true, autoplay: true, 'aria-label': 'Camera preview. Tap to take the picture now.' });
  video.muted = true;
  const stage = h('div', { class: 'scan-stage label', hidden: true }, video, h('div', { class: 'scan-frame label', 'aria-hidden': 'true' }));
  const status = h('p', { class: 'muted scan-status', role: 'status' }, spinner('Starting camera'), ' Starting camera…');
  const pick = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'ls-file', hidden: true });
  const photo = button('Take photo', () => pick.click(), { variant: 'secondary', cls: 'grow' });
  const partial = h('div', { class: 'btn-row left', hidden: true });
  // Apple's Live Text reads labels very well: copy with it in the Camera or Photos app, then paste here in one tap.
  const pasted = h('textarea', { class: 'input', id: 'ls-text', rows: 5, maxlength: 5000, 'aria-label': 'Label text', placeholder: 'Calories 230\nTotal Fat 8g\n…' });
  const say = (t) => { status.textContent = t; };
  const busySay = (t) => status.replaceChildren(spinner('Reading'), ` ${t}`);
  const useText = (t) => { if (!use(parseNutritionLabel(t))) say("Couldn't find nutrition numbers in that text. Check it has lines like \"Calories 230\" and \"Total Fat 8g\"."); };
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) { pasted.value = t; useText(t); return; }
      say('The clipboard is empty. Copy the label text first, or paste it in the box below.');
    } catch {
      say('Paste into the box below (press and hold, then Paste).');
    }
    paste.open = true;
    pasted.focus();
  };
  const paste = h('details', { class: 'more ls-paste' }, h('summary', null, 'Paste the label text instead'),
    h('p', { class: 'muted small' }, "Most accurate on iPhone: in the Camera app point at the label, tap the text button, then Copy All (or press and hold the text in a photo, Select All, Copy). Then paste here."),
    pasted, h('div', { class: 'btn-row left' }, button('Use this text', () => useText(pasted.value), { variant: 'secondary' })));

  let closed = false;
  let stream = null;
  let timer = null;
  /** Hand over a parse that found something; false when it found too little to be a label. */
  const use = (r) => {
    if (r.per.kcal == null && r.found.length < 2) return false;
    s.close();
    onRead(r);
    return true;
  };
  const stop = () => {
    closed = true;
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const s = sheet({
    title: 'Scan a nutrition label', size: 'md', onClose: stop,
    content: [stage, status, partial, navigator.clipboard && navigator.clipboard.readText ? h('div', { class: 'btn-row left' }, button('Paste copied label text', fromClipboard, { variant: 'secondary', ic: 'copy' })) : null, paste, pick],
    footer: h('div', { class: 'btn-row' }, button('Type it in', () => { s.close(); onManual(); }, { variant: 'ghost' }), photo),
  });

  /** Read a photo or frame. `auto`: only a whole label counts; a partial read is offered as a button instead. */
  let reading = false;
  const read = async (img, auto) => {
    reading = true;
    photo.disabled = true;
    try {
      const r = parseNutritionLabel(await readLabelText(img, busySay));
      if (auto ? wholeLabel(r) && use(r) : use(r)) return true;
      if (r.found.length) {
        partial.replaceChildren(button(`Use what it read (${r.found.length} ${r.found.length === 1 ? 'value' : 'values'})`, () => use(r), { variant: 'secondary' }));
        partial.hidden = false;
      }
      say(stream ? "Couldn't read the whole label yet. Hold it flat and straight on, with the whole panel in the frame." : "Couldn't read that label. Try again closer, straight on and in good light, or paste text copied with Live Text.");
      photo.lastChild.textContent = 'Try again';
      return false;
    } catch (e) {
      say((e && e.message) || "Couldn't read that photo.");
      return false;
    } finally {
      reading = false;
      photo.disabled = false;
    }
  };
  pick.addEventListener('change', async () => {
    const file = pick.files && pick.files[0];
    pick.value = '';
    if (file) await read(file, false);
  });

  // ---- live camera ----
  const frame = document.createElement('canvas');
  const thumb = document.createElement('canvas');
  const patch = Object.assign(document.createElement('canvas'), { width: PATCH, height: PATCH });
  const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
  let prev = null;
  let good = 0;
  let ready = !!window.__intakeTestOcr; // the reader is downloaded and started
  let pauseUntil = 0;
  let autoFails = 0;
  let since = 0; // when the reader was ready and checks began (reset after each try)
  /** Without a shot for this long, the steadiness and focus checks loosen (FRAME.relaxed). */
  const RELAX_MS = 6000;
  /** Automatic tries before it stops and leaves the shot to the person (a low-resolution camera never gets every line). */
  const MAX_AUTO = 3;
  /** Copy the current video frame at full resolution. */
  const grab = () => {
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    ctx2d(frame).drawImage(video, 0, 0);
    return frame;
  };
  const snap = async (auto) => {
    clearInterval(timer);
    const img = grab();
    video.pause();
    if (navigator.vibrate) navigator.vibrate(30);
    stage.classList.add('flash');
    setTimeout(() => stage.classList.remove('flash'), 200);
    const ok = await read(img, auto);
    if (ok || closed) return;
    video.play().catch(() => {});
    if (auto && ++autoFails >= MAX_AUTO) {
      say("Couldn't read the whole label. Tap the picture to try again, use what it read, or paste text copied with Live Text.");
      return;
    }
    prev = null;
    good = 0;
    since = 0;
    pauseUntil = Date.now() + 1500; // let the person adjust before the next try
    timer = setInterval(tick, TICK_MS);
  };
  const tick = async () => {
    if (closed || reading || !ready || !video.videoWidth || Date.now() < pauseUntil) return; // (download progress shows until ready)
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    thumb.width = 96;
    thumb.height = Math.round((96 * vh) / vw);
    ctx2d(thumb).drawImage(video, 0, 0, thumb.width, thumb.height);
    const gray = coarse(toGray(ctx2d(thumb).getImageData(0, 0, thumb.width, thumb.height).data), thumb.width, thumb.height);
    const mo = motion(gray, prev);
    prev = gray;
    const p = Math.max(Math.min(vw, vh) * 0.3, Math.min(PATCH, vw, vh)); // never enlarged: that would soften it
    ctx2d(patch).drawImage(video, (vw - p) / 2, (vh - p) / 2, p, p, 0, 0, PATCH, PATCH);
    const sharp = sharpness(toGray(ctx2d(patch).getImageData(0, 0, PATCH, PATCH).data), PATCH, PATCH);
    if (!since) since = Date.now();
    const relaxed = Date.now() - since > RELAX_MS;
    let j = judgeFrame({ motion: mo, sharp, text: null, relaxed });
    if (j.hint === 'Looking for the label…') {
      reading = true;
      try { j = judgeFrame({ motion: mo, sharp, text: await frameText(grab()), relaxed }); } catch { j = { ready: false, hint: 'Looking for the label…' }; } finally { reading = false; }
    }
    if (closed) return;
    good = j.ready ? good + 1 : 0;
    say(j.hint);
    if (good >= GOOD_IN_A_ROW) snap(true);
  };
  video.addEventListener('click', () => { if (!reading && video.videoWidth) snap(false); });

  (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('The live camera is not available here. Take a photo of the Nutrition Facts panel instead.');
      return;
    }
    try {
      // The most pixels the camera offers: a dense label needs about 1920 on the long side to read every line.
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
      if (closed) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
      stage.hidden = false;
      say('Point the camera at the Nutrition Facts panel. It takes the picture when the label is steady and sharp.');
      timer = setInterval(tick, TICK_MS);
      if (!ready) {
        const { warmUp } = await import('./ppocr.js');
        await warmUp((t) => { if (!closed && !reading) busySay(t); });
        ready = true;
      }
    } catch (e) {
      if (closed) return;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      if (stream) { say((e && e.message) || "Couldn't start the label reader."); return; }
      stage.hidden = true;
      say(denied ? 'Camera permission was denied. Take a photo instead, or allow the camera in your browser settings.' : "Couldn't start the camera. Take a photo of the Nutrition Facts panel instead.");
    }
  })();
  return s;
}
