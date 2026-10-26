// views/settings-data.js - backup / import / CSV / erase, and the About section.
import { h, button, toast, confirm, download, icon } from '../ui.js';
import { store } from '../store.js';
import { foodLogCsv, weightsCsv, dailyTotalsCsv } from '../backup.js';
import { today } from '../dates.js';
import { APP_VERSION } from '../version.js';
import { cloud } from '../cloud.js';
import { backupPicker } from '../import-file.js';

/** Data card body. */
export function dataSection() {
  const picker = backupPicker();
  const stamp = today();
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Everything lives on this device. A backup file is your insurance if you clear browser data or change phones.'),
    h('div', { class: 'btn-row left wrap' },
      button('Export backup (JSON)', async () => { download(`intake-backup-${stamp}.json`, JSON.stringify(await store.exportAll(), null, 1)); toast('Backup downloaded'); }, { variant: 'primary', ic: 'download' }),
      button('Import backup', picker.open, { variant: 'secondary', ic: 'upload' }), picker.input),
    h('div', { class: 'btn-row left wrap' },
      button('Food log (CSV)', async () => { const s = await store.getSettings(); download(`intake-food-log-${stamp}.csv`, foodLogCsv(await store.logsInRange('0000-01-01', '9999-12-31'), s.mealNames), 'text/csv'); }, { variant: 'secondary', ic: 'download' }),
      button('Weights (CSV)', async () => download(`intake-weights-${stamp}.csv`, weightsCsv(await store.allWeights()), 'text/csv'), { variant: 'secondary', ic: 'download' }),
      button('Daily totals (CSV)', async () => download(`intake-daily-${stamp}.csv`, dailyTotalsCsv(await store.logsInRange('0000-01-01', '9999-12-31'), await store.exerciseInRange('0000-01-01', '9999-12-31')), 'text/csv'), { variant: 'secondary', ic: 'download' })),
    h('div', { class: 'danger-zone' },
      h('div', null, h('strong', null, 'Erase all local data'), h('p', { class: 'muted small' }, 'Removes the diary, weights, foods and settings from this device.')),
      button('Erase…', async () => {
        const signed = cloud.status().signedIn;
        if (!(await confirm({ title: 'Erase everything on this device?', message: `This deletes your diary, weights, custom foods, recipes and settings from this device.${signed ? ' You are signed in, so data stored in your account will download again on the next sync.' : ' It cannot be undone.'} Export a backup first if you might want it back.`, confirmLabel: 'Continue', danger: true }))) return;
        if (!(await confirm({ title: 'Really erase it all?', message: 'Last chance. All local data will be removed now.', confirmLabel: 'Erase everything', danger: true }))) return;
        await store.eraseAll();
        toast('All local data erased');
        location.hash = '#/onboarding';
      }, { variant: 'danger' })));
}

/** About card body. */
export function aboutSection() {
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, text);
  return h('div', { class: 'stack' },
    h('p', null, 'Intake is a private, offline-first food diary. Your data stays on this device unless you turn on sync.'),
    h('ul', { class: 'plain' },
      h('li', null, 'Food data: ', a('https://fdc.nal.usda.gov/', 'USDA FoodData Central, SR Legacy'), ' (public domain).'),
      h('li', null, 'Packaged foods and barcodes: ', a('https://world.openfoodfacts.org/', 'Open Food Facts'), ' (Open Database License, ODbL).'),
      h('li', null, 'Exercise values: 2024 Adult Compendium of Physical Activities (Herrmann et al., J Sport Health Sci).')),
    h('p', { class: 'notice warn' }, icon('alert', 18), h('span', null, 'Not medical advice. Calorie and nutrient numbers are estimates. Talk to a doctor or dietitian before changing your diet, especially with a health condition, pregnancy, or a history of disordered eating.')),
    h('p', { class: 'muted small' }, `Intake ${APP_VERSION}`));
}
