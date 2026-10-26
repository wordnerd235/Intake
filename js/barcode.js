// barcode.js - barcode scanner sheet: native BarcodeDetector, else ZXing loaded from a CDN on demand; manual entry always works.
import { h, sheet, field, button, spinner } from './ui.js';
import { isBarcode } from './online-foods.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];
const ZXING_URL = 'https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.ZXingBrowser) return resolve();
    const s = h('script', { src, crossorigin: 'anonymous' });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('scanner library unavailable'));
    document.head.append(s);
  });
}

/**
 * Open the scanner. Calls onCode(code) once with digits only, then closes.
 * @param {{onCode:(code:string)=>void}} o
 */
export function openBarcodeSheet({ onCode }) {
  const video = h('video', { class: 'scan-video', playsinline: true, autoplay: true, 'aria-label': 'Camera preview' });
  video.muted = true;
  const status = h('p', { class: 'muted scan-status', role: 'status' }, spinner('Starting camera'), ' Starting camera…');
  const stage = h('div', { class: 'scan-stage', hidden: true }, video, h('div', { class: 'scan-frame', 'aria-hidden': 'true' }));
  const input = h('input', { type: 'text', class: 'input', inputmode: 'numeric', autocomplete: 'off', id: 'bc-manual', placeholder: 'e.g. 0123456789012', 'aria-describedby': 'bc-err' });
  const err = h('div', { class: 'field-error', id: 'bc-err', role: 'alert' });
  let stream = null;
  let stopFn = null;
  let done = false;
  let timer = null;

  const finish = (code) => {
    if (done) return;
    done = true;
    s.close();
    onCode(code);
  };
  const submit = () => {
    const code = input.value.replace(/\s|-/g, '');
    if (!isBarcode(code)) {
      err.textContent = 'Enter the 6 to 14 digits printed under the barcode.';
      input.focus();
      return;
    }
    finish(code);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  const stop = () => {
    clearInterval(timer);
    if (stopFn) { try { stopFn(); } catch { /* ignore */ } }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = stopFn = null;
  };
  const s = sheet({
    title: 'Scan a barcode', size: 'md', onClose: stop,
    content: [stage, status, field('Or type the number', input), err],
    footer: h('div', { class: 'btn-row' }, button('Look up', submit, { variant: 'primary' })),
  });
  const say = (t) => { status.textContent = t; };

  (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say('The camera is not available here (it needs https). Type the number below instead.');
    try {
      if ('BarcodeDetector' in window) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (done) return stop();
        video.srcObject = stream;
        await video.play().catch(() => {});
        stage.hidden = false;
        say('Point the camera at the barcode.');
        const det = new window.BarcodeDetector({ formats: FORMATS });
        timer = setInterval(async () => {
          try {
            const found = await det.detect(video);
            if (found.length && isBarcode(found[0].rawValue)) finish(found[0].rawValue);
          } catch { /* frame not ready */ }
        }, 250);
        return;
      }
      await loadScript(ZXING_URL);
      const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      stage.hidden = false;
      say('Point the camera at the barcode.');
      const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (result) => {
        if (result && isBarcode(result.getText())) finish(result.getText());
      });
      stopFn = () => controls.stop();
      if (done) stop();
    } catch (e) {
      stage.hidden = true;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      say(denied ? 'Camera permission was denied. Allow it in your browser settings, or type the number below.' : "Couldn't start the camera. Type the number below instead.");
    }
  })();
  return s;
}
