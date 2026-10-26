// import-file.js - choose a backup (.json) file and merge it into the local store. Shared by More and first-run setup.
import { h, toast } from './ui.js';
import { store } from './store.js';

/**
 * Create a hidden file input plus an `open()` that shows the picker. After a successful import `onDone(result)` runs.
 * Append `input` to the DOM next to the button that calls `open()`.
 * @param {(r:{imported:number, kept:number, skipped:number})=>void} [onDone]
 * @returns {{input:HTMLInputElement, open:()=>void}}
 */
export function backupPicker(onDone) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': 'Choose a backup file' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error('That file is too large to be an Intake backup.');
      const r = await store.importAll(JSON.parse(await f.text()), { mode: 'merge' });
      toast(`Imported ${r.imported} ${r.imported === 1 ? 'record' : 'records'}${r.kept ? `, kept ${r.kept} newer ones already here` : ''}${r.skipped ? `, skipped ${r.skipped} invalid` : ''}.`, { ms: 6000 });
      if (onDone) onDone(r);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message || 'Import failed.', { ms: 6000 });
    }
  });
  return { input, open: () => input.click() };
}
