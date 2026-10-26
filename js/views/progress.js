// views/progress.js - weight trend, calorie and water charts, averages, weigh-in list.
import { h, icon, button, toast, emptyState, rafOnce } from '../ui.js';
import { bus } from '../bus.js';
import { store } from '../store.js';
import { card } from '../components.js';
import { autoChart, lineChart, barChart } from '../charts.js';
import { trendSeries, projectGoalDate, bmi, bmiCategory, calorieTarget, macroPercents, sumEntries } from '../nutrition.js';
import { today, addDays, monthsAgo, diffDays, range as dateRange, formatShort, formatDate, weekday } from '../dates.js';
import { fmtInt, formatWeight, weightToDisplay, mlToOz, formatHeight } from '../units.js';
import { openWeightSheet } from '../quick-sheets.js';

const RANGES = [['1M', 1], ['3M', 3], ['6M', 6], ['1Y', 12], ['All', 0]];
const LS = 'intake.progress.range';
const loadRange = () => { try { return localStorage.getItem(LS) || '3M'; } catch { return '3M'; } };
const saveRange = (v) => { try { localStorage.setItem(LS, v); } catch { /* storage unavailable */ } };

/** Group daily values into weekly averages (of days that have data) when the range is long. */
function bucket(days, perDay) {
  if (days.length <= 120) return days.map((d) => ({ label: formatShort(d), value: perDay.get(d) ?? null, title: `${formatShort(d)}: ${perDay.has(d) ? fmtInt(perDay.get(d)) : 'no data'}` }));
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    const vals = days.slice(i, i + 7).map((d) => perDay.get(d)).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    out.push({ label: formatShort(days[i]), value: avg, title: `Week of ${formatShort(days[i])}: ${avg == null ? 'no data' : `${fmtInt(avg)} avg`}` });
  }
  return out;
}

const stat = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-val num' }, value), sub ? h('div', { class: 'stat-sub muted small' }, sub) : null);

/** @param {HTMLElement} root */
export async function mount(root) {
  let alive = true;
  let rng = RANGES.some(([k]) => k === loadRange()) ? loadRange() : '3M';
  const stops = [];
  const chips = h('div', { class: 'tabs-row', role: 'radiogroup', 'aria-label': 'Date range' });
  const body = h('div', { class: 'cols prog-cols' });
  root.append(h('div', { class: 'page wide' }, h('header', { class: 'page-head' }, h('h1', null, 'Progress'), chips), body));
  const drawChips = () => chips.replaceChildren(...RANGES.map(([k]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === rng), class: `chip${k === rng ? ' on' : ''}`, onclick: () => { rng = k; saveRange(k); drawChips(); draw(); } }, k)));

  async function draw() {
    const [settings, weights] = await Promise.all([store.getSettings(), store.allWeights()]);
    const t = today();
    const first = weights[0] ? weights[0].date : t;
    const months = RANGES.find(([k]) => k === rng)[1];
    let from = months ? monthsAgo(t, months) : first;
    if (!months) { const logs = await store.logsInRange('2000-01-01', t); if (logs.length && logs[0].date < from) from = logs[0].date; }
    if (diffDays(from, t) < 6) from = addDays(t, -6);
    const [logs, water, exercise] = await Promise.all([store.logsInRange(from, t), store.waterInRange(from, t), store.exerciseInRange(from, t)]);
    if (!alive) return;
    const unit = settings.units.weight;
    const series = trendSeries(weights.map((w) => ({ date: w.date, kg: w.kg })), { to: t });
    const conv = (kg) => weightToDisplay(kg, unit);
    const inRange = weights.filter((w) => w.date >= from);
    const trendNow = series.length ? series[series.length - 1].trend : null;
    const startKg = settings.startWeightKg || (weights[0] && weights[0].kg) || null;
    const goalKg = settings.goalWeightKg;
    const proj = projectGoalDate(series, goalKg, t);
    const latest = weights.length ? weights[weights.length - 1].kg : null;
    const b = bmi(latest, settings.heightCm);

    // ---- weight card
    const wHost = h('div', { class: 'chart-host' });
    const stats = h('div', { class: 'stats' },
      stat('Start', startKg ? formatWeight(startKg, unit) : '—'),
      stat('Trend now', trendNow != null ? formatWeight(trendNow, unit) : '—'),
      stat('Change', trendNow != null && startKg ? `${trendNow - startKg > 0 ? '+' : trendNow - startKg < 0 ? '−' : ''}${Math.abs(conv(trendNow) - conv(startKg)).toFixed(1)} ${unit}` : '—', 'since start'),
      stat('To goal', trendNow != null && goalKg ? `${Math.abs(conv(trendNow) - conv(goalKg)).toFixed(1)} ${unit}` : '—', goalKg ? `goal ${formatWeight(goalKg, unit)}` : 'set a goal in More'),
      stat('BMI', b ? b.toFixed(1) : '—', b ? bmiCategory(b) : settings.heightCm ? '' : 'add height in More'),
      stat('Projected goal', proj ? (proj.days === 0 ? 'Reached' : formatShort(proj.date, t)) : '—', proj ? (proj.days ? `in about ${proj.days} days` : '') : 'needs a few weeks of data'));
    const weightCard = card('Weight', weights.length
      ? [wHost, stats]
      : emptyState('No weigh-ins yet', 'Log your weight on Today. Intake draws each weigh-in and a smoothed trend line so daily noise does not discourage you.', button('Log weight', () => openWeightSheet(t), { variant: 'primary' })));

    // ---- weigh-in list
    const list = card('Weigh-ins', inRange.length ? h('ul', { class: 'rows' }, inRange.slice().reverse().slice(0, 40).map((w) => h('li', null,
      h('div', { class: 'row-link static' }, h('span', { class: 'row-name' }, formatDate(w.date, t)), h('span', { class: 'row-val num' }, formatWeight(w.kg, unit)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit weigh-in on ${w.date}`, onclick: () => openWeightSheet(w.date) }, icon('edit', 18)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete weigh-in on ${w.date}`, onclick: async () => { const kg = w.kg; await store.deleteWeight(w.date); toast('Weigh-in deleted', { action: 'Undo', onAction: () => store.setWeight(w.date, kg) }); } }, icon('trash', 18)))))) : h('p', { class: 'muted' }, 'No weigh-ins in this range.'));

    // ---- calories
    const days = dateRange(from, t);
    const perDay = new Map();
    const byDate = new Map();
    for (const l of logs) { if (!byDate.has(l.date)) byDate.set(l.date, []); byDate.get(l.date).push(l); }
    const dayTotals = [];
    const unknownDays = {};
    for (const [d, rows] of byDate) {
      const sum = sumEntries(rows);
      perDay.set(d, Math.round(sum.total.kcal));
      dayTotals.push(sum.total);
      for (const k of Object.keys(sum.unknown || {})) if (sum.unknown[k]) unknownDays[k] = (unknownDays[k] || 0) + 1;
    }
    const target = calorieTarget(settings, latest).target;
    const cHost = h('div', { class: 'chart-host' });
    const n = dayTotals.length;
    const avg = (k) => (n ? dayTotals.reduce((a, s) => a + (s[k] || 0), 0) / n : 0);
    const mp = macroPercents({ protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') });
    const avgs = h('div', { class: 'stats' },
      stat('Calories', n ? fmtInt(avg('kcal')) : '—', n ? `avg of ${n} logged ${n === 1 ? 'day' : 'days'}` : ''),
      stat('Protein', n ? `${Math.round(avg('protein'))} g` : '—', n ? `${Math.round(mp.protein)}% of kcal` : ''),
      stat('Carbs', n ? `${Math.round(avg('carbs'))} g` : '—', n ? `${Math.round(mp.carbs)}% of kcal` : ''),
      stat('Fat', n ? `${Math.round(avg('fat'))} g` : '—', n ? `${Math.round(mp.fat)}% of kcal` : ''),
      stat('Fiber', n && unknownDays.fiber !== n ? `${Math.round(avg('fiber'))} g` : '—', 'daily avg'),
      stat('Sodium', n && unknownDays.sodium !== n ? `${fmtInt(avg('sodium'))} mg` : '—', 'daily avg'));
    const calCard = card('Calories', n ? [h('p', { class: 'muted small' }, `Daily intake against your ${fmtInt(target)} kcal goal${days.length > 120 ? ' (weekly averages)' : ''}. Days without logs are left blank.`), cHost, avgs]
      : emptyState('No meals logged in this range', 'Log food in the Diary and your intake shows up here.'));

    // ---- water
    const wPer = new Map(water.map((w) => [w.date, unit && settings.units.water === 'oz' ? mlToOz(w.ml) : w.ml]));
    const wu = settings.units.water;
    const wGoal = wu === 'oz' ? mlToOz(settings.waterGoalMl) : settings.waterGoalMl;
    const wtHost = h('div', { class: 'chart-host' });
    const waterCard = card('Water', water.length ? [h('p', { class: 'muted small' }, `Daily total in ${wu}, goal ${fmtInt(wGoal)} ${wu}.`), wtHost] : emptyState('No water logged in this range', 'Tap the water button on Today to start.'));

    body.replaceChildren(h('div', { class: 'col' }, weightCard, calCard), h('div', { class: 'col' }, waterCard, list));
    stops.splice(0).forEach((f) => f());
    if (weights.length) stops.push(autoChart(wHost, (w) => lineChart({ from, to: t, width: w, unit, goal: goalKg ? conv(goalKg) : null, points: inRange.map((x) => ({ date: x.date, v: conv(x.kg) })), trend: series.map((p) => ({ date: p.date, v: conv(p.trend) })) })));
    if (n) stops.push(autoChart(cHost, (w) => barChart({ bars: bucket(days, perDay), target, width: w, name: 'Daily calories', unit: 'kcal' })));
    if (water.length) stops.push(autoChart(wtHost, (w) => barChart({ bars: bucket(days, wPer), target: wGoal, width: w, name: 'Daily water', unit: wu })));
  }
  const redraw = rafOnce(draw);
  const off = bus.on('change:*', redraw);
  drawChips();
  await draw();
  return () => { alive = false; off(); stops.forEach((f) => f()); };
}
