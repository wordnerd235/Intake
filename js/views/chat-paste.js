// views/chat-paste.js - Quick add from a chat: paste the "Intake" block from a Claude answer, check the foods it lists,
// pick the meal and add them all at once (with Undo). Reading the text: chat-paste.js (pure).
import { h, sheet, button, iconButton, select, field, toast } from '../ui.js';
import { store } from '../store.js';
import { mealLabel, notice } from '../components.js';
import { fmtInt, trimNum } from '../units.js';
import { sumNutrients } from '../nutrition.js';
import { PROMPT, parseChatNutrition, chatEntry } from '../chat-paste.js';

const r0 = (v) => fmtInt(Math.round(v || 0));
const macroLine = (n) => `${r0(n.kcal)} kcal · P ${n.protein == null ? '—' : `${r0(n.protein)} g`} · C ${n.carbs == null ? '—' : `${r0(n.carbs)} g`} · F ${n.fat == null ? '—' : `${r0(n.fat)} g`}`;
const g1 = (v) => `${trimNum(v, 1)} g`;
/** "Total sugars 6 g · added 1 g", or "added sugars not listed". */
const sugarLine = (n) => [n.sugar != null ? `Total sugars ${g1(n.sugar)}` : null, n.addedSugar != null ? `added sugars ${g1(n.addedSugar)}` : 'added sugars not listed'].filter(Boolean).join(' · ');

/**
 * Open the paste sheet.
 * @param {{date:string, meal:number, onDone?:()=>void}} o
 */
export async function openChatPaste({ date, meal, onDone }) {
  const settings = await store.getSettings();
  let m = meal;
  const body = h('div', { class: 'cp' });
  /** Replace the sheet's content; optional parts passed as null are skipped (replaceChildren would print "null"). */
  const show = (...parts) => body.replaceChildren(...parts.filter(Boolean));
  const s = sheet({ title: 'Paste from a chat', size: 'md', content: body });
  const text = h('textarea', { class: 'input', id: 'cp-text', rows: 8, maxlength: 20000, 'aria-label': 'Nutrition from the chat', placeholder: 'Intake\nName: Chicken burrito bowl\nAmount: 1 bowl (450 g)\nCalories: 680\nProtein: 42 g\n…' });

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT);
      toast('Prompt copied. Paste it into your chat with Claude.');
    } catch {
      toast('Copying was blocked. Press and hold the prompt to select and copy it.');
    }
  };
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) { text.value = t; return read(); }
      start('The clipboard is empty. Copy the Intake block from the chat first, or paste it in the box.');
    } catch {
      start('Paste into the box (press and hold, then Paste).');
    }
  };

  function start(message) {
    show(
      message ? notice(message, 'warn') : null,
      h('p', null, 'Ask Claude about your food, then paste the Intake block from its answer here. Each food becomes a Quick add entry; you check them before they\'re added.'),
      h('details', { class: 'more cp-prompt' }, h('summary', null, 'The prompt to give Claude'),
        h('p', { class: 'muted small' }, 'Start your chat with this (or add it to a Claude project\'s instructions), so every answer ends with a block Intake can read.'),
        h('pre', { class: 'cp-prompt-text', tabindex: 0 }, PROMPT),
        h('div', { class: 'btn-row left' }, button('Copy prompt', copyPrompt, { variant: 'secondary', ic: 'copy' }))),
      field('Nutrition from the chat', text),
    );
    s.showFooter(h('div', { class: 'btn-row' },
      navigator.clipboard && navigator.clipboard.readText ? button('Paste', fromClipboard, { variant: 'ghost', ic: 'copy' }) : null,
      button('Read', read, { variant: 'primary', cls: 'grow' })));
  }

  function read() {
    const { items, problems } = parseChatNutrition(text.value);
    if (!items.length) return start(problems.join(' '));
    review(items, problems);
  }

  function review(items, problems) {
    const total = h('p', { class: 'mp-total' });
    const list = h('ul', { class: 'mp-list' });
    const rows = items.map((it) => {
      const li = h('li', { class: 'mp-item' },
        h('div', { class: 'mp-name' }, h('strong', null, it.name),
          it.amount && it.amount.label ? h('span', { class: 'muted small block' }, it.amount.grams && !/\d\s*g\b/.test(it.amount.label) ? `${it.amount.label} (${trimNum(it.amount.grams, 1)} g)` : it.amount.label) : null,
          h('span', { class: 'muted small block mp-macros' }, macroLine(it.per)),
          h('span', { class: 'muted small block cp-sugars' }, sugarLine(it.per))),
        iconButton('trash', `Remove ${it.name}`, () => { li.remove(); row.removed = true; update(); }));
      const row = { it, li, removed: false };
      list.append(li);
      return row;
    });
    const mealSel = select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(settings, i) })), m, (v) => { m = +v; update(); }, { id: 'cp-meal' });
    const add = button('Add', () => addAll(), { variant: 'primary', cls: 'grow' });
    function update() {
      const kept = rows.filter((r) => !r.removed);
      total.textContent = kept.length > 1 ? `Total: ${macroLine(sumNutrients(kept.map((r) => r.it.per)).total)}` : '';
      add.disabled = !kept.length;
      add.lastChild.textContent = `Add ${kept.length === 1 ? 'it' : `all ${kept.length}`} to ${mealLabel(settings, m)}`;
    }
    async function addAll() {
      const kept = rows.filter((r) => !r.removed);
      add.disabled = true;
      const ids = [];
      for (const r of kept) ids.push((await store.addLog({ ...chatEntry(r.it), date, meal: m })).id);
      s.close();
      toast(`Added ${ids.length} ${ids.length === 1 ? 'item' : 'items'} to ${mealLabel(settings, m)}`, { action: 'Undo', onAction: async () => { for (const id of ids) await store.deleteLog(id); } });
      if (onDone) onDone();
    }
    show(
      problems.length ? notice(`Some lines weren't used. ${problems.join(' ')}`, 'warn') : null,
      h('p', { class: 'muted small' }, 'Check the foods, remove any you didn\'t eat, then add. To change a number, fix it in the chat or the box and read it again.'),
      list, total, field('Meal', mealSel),
    );
    s.showFooter(h('div', { class: 'btn-row' }, button('Back', () => start(), { variant: 'ghost' }), add));
    update();
  }

  start();
  text.focus();
  return s;
}
