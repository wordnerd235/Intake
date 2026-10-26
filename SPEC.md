# Intake — calorie & nutrition tracker (spec)

An original, MyNetDiary-style food diary for personal use. Do NOT use MyNetDiary's name, logo, copy text, colors or screen designs — build the same *functionality* with our own identity ("Intake").

## 1. Hard constraints

- **No build step, no npm.** Plain HTML + CSS + ES2022 modules (`<script type="module">`). The sandbox cannot reach npm; the app must be deployable by copying the folder to any static host (GitHub Pages under a sub-path like `/intake/`). **All URLs relative** (`./js/...`, `./data/...`). Hash routing (`#/today`, `#/diary/2026-10-23`).
- **Works fully offline and without any account.** Local-first: all data lives in IndexedDB. Cloud sync (Firebase) is optional and only activates when `js/firebase-config.js` exports a config. Anything loaded from a CDN (Firebase SDK, ZXing fallback) is dynamically imported only when needed and the app must degrade gracefully if it fails.
- **Responsive**: phone (≥ 360 px wide) through desktop. No horizontal page scroll at 360 px. Tap targets ≥ 44 px.
- **Security**: food names/brands from online APIs and user input are untrusted — never inject them via `innerHTML` unescaped. Use `textContent` or the `esc()` helper.
- **Dates**: a "day" is the user's *local* calendar date as `YYYY-MM-DD`. Never use `toISOString().slice(0,10)` (UTC bug). All date math in `js/dates.js`, DST-safe.
- Files small and focused (aim < 500 lines each). JSDoc on exported functions. Pure logic modules (`nutrition.js`, `dates.js`, `foods-search.js`, `normalize.js`, `sync-core.js`, `units.js`) must import in Node with no DOM so `node --test` can run them.

## 2. File layout

```
index.html               app shell, <noscript>, loads js/main.js
manifest.webmanifest     name "Intake", display standalone, start_url "./", scope "./"
sw.js                    service worker (see §9)
icons/                   icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png (generate PNGs with Playwright screenshots of the SVG)
css/app.css              tokens, light/dark themes, layout, components
js/
  main.js                boot: open DB, load settings, onboarding gate, router, SW registration + update toast
  router.js              hash router, route table, back handling
  ui.js                  h() element builder, esc(), toast(msg,{action}), sheet()/modal() with focus trap + Esc, confirm(), number/fraction input helper
  bus.js                 tiny pub/sub ('change:<collection>', 'sync:status', 'date:change')
  db.js                  IndexedDB wrapper: get/put/delete/all/byIndex per store; schema v1
  store.js               domain API (§4) on top of db.js; stamps updatedAt, marks _dirty, emits bus events
  sync-core.js           PURE merge/cursor logic (testable)
  sync.js                SyncEngine: wires store <-> Backend; FirebaseBackend (lazy) and MemoryBackend (tests)
  firebase-config.js     `export const firebaseConfig = null;` with commented example
  units.js               lb/kg, in/cm, oz/ml, kcal display, fraction parsing ("1 1/2", "1/3", ".5")
  dates.js               today(), addDays(), parse/format, weekday labels, range lists
  nutrition.js           nutrient keys, scale/sum, BMR/TDEE/targets, macros, exercise kcal, trend weight, BMI, projections
  foods-db.js            lazy-load data/foods.json, build index, getFood(key)
  foods-search.js        PURE tokenizer + ranking used by foods-db.js
  normalize.js           PURE: Open Food Facts / USDA FDC JSON -> internal Food shape (unit conversions!)
  online-foods.js        fetch wrappers for OFF + FDC (search, barcode), timeouts, errors
  barcode.js             camera scanner sheet: BarcodeDetector, else lazy ZXing from CDN, always manual entry
  charts.js              SVG: ring, line (with trend + goal line), bars (with target line), sparkline
  views/
    onboarding.js today.js diary.js add-food.js food-detail.js exercise.js
    progress.js foods.js food-editor.js recipe-editor.js settings.js account.js
data/foods.json, data/exercises.json      (built separately — see data/DATA_NOTES.md)
firestore.rules
tests/unit/*.test.js     node --test
tests/e2e/*.py           Python Playwright (installed), serves app with python http.server
README.md
```

## 3. Nutrients

`NUTRIENTS = ['kcal','protein','carbs','fat','fiber','sugar','satFat','transFat','cholesterol','sodium','potassium','calcium','iron','vitA','vitC','vitD']`
Units: kcal; g ×7 (protein..transFat); mg: cholesterol, sodium, potassium, calcium, iron, vitC; µg: vitA (RAE), vitD.
A nutrients object may omit keys or hold `null` (unknown). Sums treat unknown as 0 but track whether any contributor was unknown (show "—" or "≥" where useful; at minimum don't crash or show NaN).

## 4. Data model (IndexedDB `intake`, one object store per collection)

Every record: `id` (string), `updatedAt` (ms, client clock), `deleted` (bool tombstone, default false), local-only `_dirty` (0/1, index) — `_dirty` is never sent to the cloud. Store API never returns tombstones unless asked.

| collection | id | fields |
|---|---|---|
| settings | `"profile"` | see §6 |
| foodLogs | uuid | `date`, `meal` (0-3), `foodKey`, `name`, `brand`, `serving {label, grams|null}`, `qty`, `per` (nutrients for ONE serving unit, snapshot), `createdAt` — index `date` |
| exerciseLogs | uuid | `date`, `exerciseId|null`, `name`, `minutes|null`, `kcal`, `met|null` — index `date` |
| weights | date | `date`, `kg` |
| water | date | `date`, `ml` |
| notes | date | `date`, `text` |
| customFoods | uuid | Food fields (below) |
| recipes | uuid | `name`, `servings` (count), `cookedGrams|null`, `ingredients: [{foodKey,name,brand,serving,qty,per}]`, `note` |
| meals | uuid | saved meal template: `name`, `items: [{foodKey,name,brand,serving,qty,per}]` |
| foodMeta | foodKey | `favorite`, `useCount`, `lastUsed`, `lastServing {serving, qty}`, `food` (minimal Food snapshot so recents/favorites of online foods work offline) |

**Food shape** (search results, custom foods, online foods, recipes-as-food):
```
{ key: 'usda:167512'|'off:<barcode>'|'fdc:<fdcId>'|'custom:<id>'|'recipe:<id>'|'quick',
  name, brand?, source: 'usda'|'off'|'fdc'|'custom'|'recipe',
  per100g: {nutrients}|null,
  servings: [{label, grams|null, per?: {nutrients}}] }   // per required when grams is null
```
Rules: if `per100g` exists, the serving picker also offers `g` and `oz` units (`{label:'g',grams:1}`, `{label:'oz',grams:28.3495}`) and `per = per100g × grams/100`. Default serving = first listed. Log entry total = `per × qty`.

**store.js API** (all async, all emit `change:<collection>`):
`getSettings() / saveSettings(patch)`, `logsForDate(date)`, `logsInRange(from,to)`, `addLog(entry) / updateLog(id,patch) / deleteLog(id)` (delete = tombstone; return previous record for Undo), `restoreLog(rec)`, `exerciseForDate/addExercise/updateExercise/deleteExercise`, `getWeight(date)/setWeight(date,kg)/weightsInRange/allWeights/deleteWeight`, `getWater/setWater`, `getNote/setNote`, custom food / recipe / meal CRUD, `touchFoodMeta(food, serving, qty)`, `recentFoods(n)`, `frequentFoods(n)`, `favorites()`, `toggleFavorite(food)`, `copyMeal(fromDate, meal, toDate, toMeal)`, `copyDay(fromDate,toDate)`, `exportAll()`, `importAll(json,{mode:'merge'|'replace'})`, `eraseAll()`, `dirtyRecords()`, `applyRemote(collection, rec)` (no dirty mark, LWW), `clearDirty(collection,id,updatedAt)`.

## 5. Food sources & search

1. **Local USDA SR Legacy** (`data/foods.json`, ~7.7k foods, compact arrays; see data/DATA_NOTES.md for format). Lazy-load on first search; cached by SW.
2. **Custom foods, recipes, saved meals, recents/favorites** (foodMeta) — searched first and shown at top.
3. **Open Food Facts** (no key): branded/packaged foods + barcode lookup. Verify current endpoints with WebFetch on the OFF API docs before coding (product: `https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=...`; search: v2 `/api/v2/search` or `/cgi/search.pl?...&json=1`, whichever supports text search today). Request only needed `fields`. Normalize per-100g nutriments carefully: OFF stores sodium, cholesterol, potassium, calcium, iron, vitamin-c in **grams** → ×1000 for mg; vitamin-a, vitamin-d in **grams** → ×1e6 for µg; energy prefer `energy-kcal_100g`, else `energy_100g`(kJ)/4.184. Serving from `serving_quantity` (g) + `serving_size` label. Skip products with no energy. Show "Data: Open Food Facts (ODbL)" attribution under OFF results.
4. **USDA FoodData Central API** (Branded foods; optional): `https://api.nal.usda.gov/fdc/v1/foods/search` with `api_key` = user's key from Settings, else `DEMO_KEY` (very low rate limit — tell the user to get a free key at https://fdc.nal.usda.gov/api-key-signup). Use as a second online source and as barcode fallback (search by GTIN/UPC). Normalize `foodNutrients` (per 100 g for branded) + `servingSize`/`servingSizeUnit`/`householdServingFullText`.
5. **Quick add**: calories (+ optional P/C/F) with a name.

**Ranking** (`foods-search.js`, pure): lowercase, strip punctuation, simple plural folding (`bananas`→`banana`, `berries`→`berry`, `tomatoes`→`tomato`). Every query token must prefix-match some name token. Score: +large if all tokens are in the first comma-segment; +common flag; +exact first-token match; −name length; small bonus for "raw" when query has no prep word, for "cooked/roasted/baked" for meats/grains. Tests must assert: "banana" → "Bananas, raw" #1; "egg" → whole egg (raw or hard-boiled/scrambled) in top 3; "chicken breast" → a cooked chicken breast in top 3; "white rice" → cooked white rice in top 3; "2% milk" or "milk 2%" → reduced fat 2% milk top 3.

**Online search UX**: local results appear instantly while typing (debounce 150 ms). Online results load after 400 ms debounce into a separate "Online (branded)" section with spinner; failures show a small inline message, never block.

## 6. Settings & goal math (`nutrition.js`)

Settings `profile`: `units {weight:'lb'|'kg', height:'ftin'|'cm', water:'oz'|'ml'}`, `sex 'male'|'female'`, `birthYear`, `heightCm`, `activity 'sedentary'|'light'|'moderate'|'active'|'very'`, `goalType 'lose'|'maintain'|'gain'`, `goalWeightKg`, `weeklyRateKg` (≥0), `calorieOverride|null`, `macroPct {protein:25,carbs:45,fat:30}`, `nutrientTargets` (overrides), `waterGoalMl` (2000), `mealNames ['Breakfast','Lunch','Dinner','Snacks']`, `addExerciseCalories` (true), `theme 'system'|'light'|'dark'`, `fdcApiKey ''`, `onboarded`, `startWeightKg`, `startDate`.

- BMR Mifflin-St Jeor: `10·kg + 6.25·cm − 5·age + (male ? 5 : −161)`; age from birthYear.
- TDEE = BMR × {1.2, 1.375, 1.55, 1.725, 1.9}.
- Target = TDEE ∓ `weeklyRateKg × 7700 / 7` (lose −, gain +, maintain 0). Floor 1200 (female) / 1500 (male) — clamp and show a warning. `calorieOverride` wins if set. Uses latest logged weight (fall back to startWeightKg).
- Pace choices in UI: 0.25/0.5/0.75/1 kg or 0.5/1/1.5/2 lb per week.
- Daily budget = target + (addExerciseCalories ? exercise kcal : 0). Remaining = budget − food kcal.
- Macro grams = target × pct / {4,4,9}; percentages must sum to 100 (UI enforces).
- Default nutrient targets: fiber 14 g per 1000 kcal; sodium ≤ 2300 mg; satFat ≤ 10% kcal /9; sugar shown informational (no target); cholesterol ≤ 300 mg; potassium 3400 (m)/2600 (f); calcium 1000; iron 8 (m)/18 (f); vitA 900/700 µg; vitC 90/75 mg; vitD 15 µg. "≤" targets are limits (over = warning color); others are goals.
- Exercise kcal = `MET × kg × minutes/60`, rounded; user may override.
- Trend weight: exponential moving average, α = 0.1, over daily weigh-ins (carry forward across gaps). BMI = kg / m². Projection: goal date from trend slope over last 4 weeks (only if moving toward goal), else "—".

## 7. Screens

**Navigation**: phone — bottom tab bar (Today, Diary, Progress, Foods, More) + floating "+" (adds food to the meal that fits the clock: <10:30 Breakfast, <15:00 Lunch, <20:30 Dinner, else Snacks). Desktop ≥ 900 px — left sidebar nav, content max-width ~1100 px; Today and Diary use two columns (log left, summary/nutrients right). Date navigator (‹ date › + "Today" + native date picker) shared by Today/Diary; selected date persists across tabs.

- **Onboarding** (first run, skippable): units → sex, birth year, height, weight → goal weight + pace + activity → shows resulting daily calorie budget with a one-line explanation → optional "Sign in to sync" (only if Firebase configured).
- **Today**: calorie ring (budget / eaten / exercise / remaining, red when over), macro bars (g vs target, P/C/F colors), water card (tap +1 glass = 8 oz or 250 ml, long-press/menu to set exact; progress), weight card (enter today's weight; sparkline of trend 30 d), meal summary rows (kcal per meal → tap goes to Diary), streak ("N days logged"), note preview.
- **Diary**: meal sections (custom names) with entries: name, brand (muted), "1.5 × 1 cup" serving text, kcal. Tap entry → edit sheet (qty, unit, meal, delete). Per-meal: subtotal kcal + P/C/F, "+ Add food", overflow menu: copy from yesterday, copy to date…, save as meal, clear. Exercise section ("+ Add exercise"). Water + note. Footer: day totals and **Nutrients** sheet — full table for all 16 nutrients: amount, target, % bar, limit/goal styling.
- **Add food sheet** (full-screen on phone, large modal on desktop): search box (autofocus), barcode button, tabs/chips: All · Recent · Frequent · Favorites · My foods · Recipes · Meals. Bottom actions: Quick add, Create food. Tapping a result → **Food detail**: amount input (fractions OK) + unit select, meal select, date shown, live nutrition-facts panel (kcal, P/C/F, then rest), favorite star, "Add" button. After add: toast "Added to Lunch · Undo", sheet stays open for the next item (search cleared), close returns to Diary. Saved meal → adds all its items. Recipe → logs servings of the recipe.
- **Exercise sheet**: search exercises.json + recents; minutes input; computed kcal shown live (editable); custom exercise (name + kcal).
- **Progress**: range chips 1M · 3M · 6M · 1Y · All. Weight chart (dots for weigh-ins, line for trend, dashed goal line, axis labels in user units), stats (start, current trend, change, to goal, BMI, projected goal date), weigh-in list with edit/delete. Calories chart: daily intake bars vs target line (days with no logs blank). Averages for range: kcal, P/C/F grams and % of kcal, fiber, sodium. Water chart.
- **Foods**: tabs My foods · Recipes · Meals · Favorites. Food editor: name, brand, serving label, serving grams (optional), all nutrients per serving (kcal required). Recipe editor: name, number of servings, optional cooked weight (g), ingredients added via the same search component in "pick" mode (with amount/unit), live per-serving nutrition, note. Meal editor: rename, remove items.
- **More / Settings**: Profile & goal (recalculates, shows BMR/TDEE/target breakdown), calorie override, macro % (three linked inputs/sliders, must total 100), nutrient targets, units, meal names, water goal, add-exercise-calories toggle, theme, FDC API key (with signup link), **Account & sync** (§8 status, sign in/up/out, sync now, last synced), **Data**: export backup (JSON), export CSV (food log; weights), import backup (merge), erase all local data (double confirm). About: data sources & attributions (USDA public domain; Open Food Facts ODbL), "Not medical advice", version.

## 8. Cloud sync (Firebase, free Spark plan)

- Firestore path: `users/{uid}/{collection}/{id}`; doc = record without `_dirty`, plus `serverUpdatedAt: serverTimestamp()`.
- `firestore.rules`: only `request.auth.uid == uid` may read/write under `users/{uid}/**`; deny everything else.
- Auth: email+password (sign up, sign in, password reset) and Google (`signInWithPopup`; if popup blocked/unsupported, fall back to `signInWithRedirect`). Initialize Firestore with the default memory cache — our IndexedDB is the source of truth.
- **SyncEngine** (backend-agnostic; `Backend` interface: `push(collection, records[])`, `subscribe(collection, sinceCursor, onDocs)`, `unsubscribeAll()`):
  - Push: whenever online + signed in, debounce 1 s after local changes, push `dirtyRecords()` in batches ≤ 400; on success `clearDirty(collection,id,updatedAt)` only if the local `updatedAt` is unchanged. Retry with backoff on failure; also on `online` event and app start.
  - Pull: per collection, realtime subscribe to docs with `serverUpdatedAt > cursor`; apply with LWW on `updatedAt` (remote wins only if `remote.updatedAt > local.updatedAt`; a local dirty record that is newer is kept and will be pushed). Persist cursor (max serverUpdatedAt seen) per uid+collection in a local `meta` store.
  - Records created while signed out are dirty, so first sign-in uploads them. If a *different* uid signs in and local data exists, ask: "Merge this device's data into this account" or "Erase this device's data first".
  - Sign out: keep local data by default; offer "Sign out and remove data from this device".
  - Status in UI: Off (no config) · Signed out · Syncing… · Synced (time) · Offline (N pending) · Error (message).
- `sync-core.js` holds pure functions (`shouldApplyRemote`, `nextCursor`, `batch`), unit-tested; `MemoryBackend` lets tests run two store instances ("two devices") through a shared backend: create on A appears on B; concurrent edits resolve LWW; delete propagates; offline queue flushes later.
- Firebase SDK: dynamic import from `https://www.gstatic.com/firebasejs/<ver>/firebase-{app,auth,firestore}.js`. Use the current release (13.1.0 per https://firebase.google.com/support/releases on 2026-10-21); confirm the modular API names you use against the official docs with WebFetch since you cannot install the package. Isolate all Firebase calls in `FirebaseBackend` + `account.js`.

## 9. PWA / offline

- Service worker `sw.js`: precache app shell (html, css, js, icons, manifest, data/exercises.json) with a versioned cache name (`intake-v<N>`); `data/foods.json` stale-while-revalidate; never cache API calls (OFF, FDC, Firebase, gstatic is fine to runtime-cache). Navigation requests → cached `index.html` when offline.
- On a waiting SW, show toast "Update available · Reload" (skipWaiting on accept).
- `manifest.webmanifest` + `apple-touch-icon`, `theme-color` meta for light/dark. iOS: `apple-mobile-web-app-capable`, safe-area insets (`env(safe-area-inset-bottom)`) for the tab bar.

## 10. Visual design

Own identity: calm, precise, data-forward — a lab notebook, not a gym poster.
- Tokens on `:root` with dark-mode overrides under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, plus `:root[data-theme="dark"]`. Explicit `body` background.
- Neutrals: warm paper light theme (`--bg #F7F6F2`, `--surface #FFFFFF`, `--ink #1B1D21`, `--muted #6B6F76`, `--line #E4E2DC`); dark (`--bg #121416`, `--surface #1B1E22`, `--ink #ECEDEE`, `--muted #9AA0A6`, `--line #2A2E33`).
- Accent `--accent #3559E0` (dark: `#7D98FF`). Status: `--good #1F9D6B`, `--warn #D98A1C`, `--over #D64545`. Macros: protein `#C2417A`, carbs `#D99A1C`, fat `#2E9C8A` (lighten ~15% in dark).
- System font stack; numbers use `font-variant-numeric: tabular-nums`. Big numerals for the ring center. 8 px spacing grid, 12 px radius cards with 1 px `--line` border, no heavy shadows. Sheets slide up on phone.
- Icons: inline SVG (simple strokes), no icon fonts or external assets.
- Focus-visible rings; `prefers-reduced-motion` respected; color never the only signal (over-budget also says "over").

## 11. Testing (must pass before handoff)

- `node --test tests/unit` — nutrition math (BMR/TDEE/target known values, floor clamp, macro grams, exercise kcal), units & fraction parsing, dates (incl. DST transitions, month ends), serving scaling, OFF/FDC normalization (sodium g→mg etc., kJ fallback), recipe per-serving & per-100g math, search ranking assertions (§5, using the real data/foods.json), sync-core + two-device MemoryBackend scenarios, export→import round trip (pure parts).
- `python3 tests/e2e/run.py` — serves the folder with `python3 -m http.server` and runs Playwright Chromium at **390×844 (mobile, touch)** and **1366×900 (desktop)**: onboarding; search "banana" → add 1 medium → totals 105 kcal; edit qty → totals update; delete + Undo; quick add; create custom food & log it; create recipe & log 1 serving; add exercise → remaining increases; water + weight; date navigation; copy meal from yesterday; Progress charts render with data; export JSON → import into a fresh browser context restores data; reload persists; no console errors; no horizontal overflow at 360 and 390 px; offline reload after first load works (SW). Mock OFF/FDC responses with `page.route` to test online search + barcode manual entry. Save screenshots of every main screen at both sizes to `tests/screenshots/`.
