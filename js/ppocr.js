// ppocr.js - on-device PaddleOCR (PP-OCRv5 text detector + PP-OCRv4 English recognizer) on ONNX Runtime Web.
// The runtime and models (~25 MB, Apache-2.0) come from unpkg the first time and are cached by the service worker.
// Pure post-processing lives in ppocr-core.js.
import { h } from './ui.js';
import { boxesFromMap, cropForRecognition, ctcDecode, toLines } from './ppocr-core.js';

const CDN = 'https://unpkg.com/';
const ORT = `${CDN}onnxruntime-web@1.30.0/dist/`;
const MODELS = {
  det: `${CDN}pdfmarkdown-ppocrv5-models@1.0.0/detection/PP-OCRv5_mobile_det_infer.ort`,
  rec: `${CDN}paddle-ocr-onnx-models@0.2.0/models/en_PP-OCRv4_rec.onnx`,
};
/** PaddleOCR's English character list (ppocr/utils/en_dict.txt, which ends in a space); the model adds a blank first and a space last. */
const EN_DICT = '0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~!"#$%&\'()*+,-./ ';
const KEYS = ['', ...EN_DICT, ' '];
/** Longest side the detector sees. Labels fill a phone photo; 1280 keeps small print without slowing older phones. */
const DET_SIDE = 1280;
/** Longest side of the image boxes are cut from (more pixels than the detector: recognition needs the detail). */
const SRC_SIDE = 2400;

let engine = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.ort) return resolve();
    const s = h('script', { src, crossorigin: 'anonymous' });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The label reader could not be downloaded. Check the connection and try again.'));
    document.head.append(s);
  });
}

async function fetchModel(url, onStatus) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error('The label reader could not be downloaded. Check the connection and try again.');
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const buf = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.set(value, got);
    got += value.length;
    onStatus(got);
  }
  return buf.subarray(0, got);
}

/** Load the runtime and both models once per page. */
async function load(onStatus) {
  if (engine) return engine;
  onStatus('Getting the label reader… (first time only)');
  await loadScript(`${ORT}ort.wasm.min.js`);
  const ort = window.ort;
  ort.env.wasm.wasmPaths = ORT;
  ort.env.wasm.numThreads = 1; // GitHub Pages can't enable the cross-origin isolation threads need
  let done = 0;
  const say = () => onStatus(`Getting the label reader… ${Math.round(done / 1e6)} MB (first time only)`);
  const parts = [0, 0];
  const [det, rec] = await Promise.all([MODELS.det, MODELS.rec].map((u, i) => fetchModel(u, (n) => { parts[i] = n; done = parts[0] + parts[1]; say(); })));
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  engine = { ort, det: await ort.InferenceSession.create(det, opt), rec: await ort.InferenceSession.create(rec, opt) };
  return engine;
}

/** Draw the photo onto a canvas no larger than `side` on its longest edge (or exactly `w` x `h`). */
function draw(bmp, side, w, h) {
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = w || Math.round(bmp.width * k);
  c.height = h || Math.round(bmp.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * Read all the text in a photo, as lines top to bottom.
 * @param {Blob} file
 * @param {(msg:string)=>void} [onStatus]
 * @returns {Promise<string>}
 */
export async function recognizeText(file, onStatus = () => {}) {
  const { ort, det, rec } = await load(onStatus);
  onStatus('Finding the text…');
  const bmp = await createImageBitmap(file);
  const src = draw(bmp, SRC_SIDE);
  const s = DET_SIDE / Math.max(bmp.width, bmp.height);
  const dw = Math.max(32, Math.round((bmp.width * s) / 32) * 32);
  const dh = Math.max(32, Math.round((bmp.height * s) / 32) * 32);
  const small = draw(bmp, Infinity, dw, dh);
  if (bmp.close) bmp.close();
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const x = new Float32Array(3 * dw * dh);
  for (let i = 0, p = 0; p < dw * dh; i += 4, p++) for (let ch = 0; ch < 3; ch++) x[ch * dw * dh + p] = (small.data[i + ch] / 255 - mean[ch]) / std[ch];
  const detOut = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, dh, dw]) });
  const map = detOut[det.outputNames[0]];
  const boxes = boxesFromMap(map.data, dw, dh, src.width / dw, src.height / dh);
  const items = [];
  for (let i = 0; i < boxes.length; i++) {
    if (i % 4 === 0) onStatus(`Reading the label… ${Math.round((i / boxes.length) * 100)}%`);
    const crop = cropForRecognition(src, boxes[i]);
    if (!crop) continue;
    const out = (await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', crop.data, [1, 3, crop.height, crop.width]) }))[rec.outputNames[0]];
    const [, T, C] = out.dims;
    const { text, conf } = ctcDecode(out.data, T, C, KEYS);
    if (text.trim() && conf > 0.5) items.push({ q: boxes[i], text });
  }
  return toLines(items);
}
